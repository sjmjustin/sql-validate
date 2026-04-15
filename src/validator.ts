import {
  SchemaCatalog,
  ExtractedQuery,
  ValidationError,
  ErrorType,
  ContextLine,
  SchemaTable,
} from "./types";
import { findClosestMatches } from "./schema-parser";

/**
 * Validate extracted SQL queries against a schema catalog.
 */
export function validateQueries(
  queries: ExtractedQuery[],
  catalog: SchemaCatalog
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const query of queries) {
    const queryErrors = validateSingleQuery(query, catalog);
    errors.push(...queryErrors);
  }

  return errors;
}

function validateSingleQuery(
  query: ExtractedQuery,
  catalog: SchemaCatalog
): ValidationError[] {
  const errors: ValidationError[] = [];
  const sql = query.sql;

  // Skip queries that are clearly DDL (CREATE, ALTER, DROP) — those define schema, not consume it
  if (/^\s*(CREATE|ALTER|DROP|GRANT|DENY|REVOKE)\b/i.test(sql)) {
    return errors;
  }

  // Build alias map: alias -> table fqn
  const aliasMap = buildAliasMap(sql, catalog);

  // Validate table references
  errors.push(...validateTableRefs(query, catalog, aliasMap));

  // Validate column references
  errors.push(...validateColumnRefs(query, catalog, aliasMap));

  // Validate function/procedure calls
  errors.push(...validateFunctionRefs(query, catalog));

  // Validate index hints
  errors.push(...validateIndexHints(query, catalog, aliasMap));

  return errors;
}

// ── Alias Resolution ──

interface AliasMap {
  /** alias (lowercase) -> { schema, table, fqn } */
  aliases: Map<string, { schema: string; table: string; fqn: string }>;
  /** All table fqns referenced in this query */
  referencedTables: Set<string>;
}

function buildAliasMap(sql: string, catalog: SchemaCatalog): AliasMap {
  const aliases = new Map<string, { schema: string; table: string; fqn: string }>();
  const referencedTables = new Set<string>();

  function registerTable(rawTable: string, rawAlias?: string): void {
    const { schema, name } = parseSimpleQualifiedName(rawTable);
    // Skip if the table name is a SQL keyword (parser noise like "FROM dbo.SELECT")
    if (isSqlKeyword(name)) return;
    const fqn = `${schema.toLowerCase()}.${name.toLowerCase()}`;
    referencedTables.add(fqn);

    if (rawAlias) {
      const alias = stripBrackets(rawAlias).toLowerCase();
      if (!isSqlKeyword(alias)) {
        aliases.set(alias, { schema, table: name, fqn });
      }
    }
    // Also register the table name itself as an implicit alias
    aliases.set(name.toLowerCase(), { schema, table: name, fqn });
  }

  // Match explicit JOIN clauses (these are unambiguous)
  const joinRegex =
    /(?:INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|FULL\s+(?:OUTER\s+)?JOIN|(?<!INNER\s|LEFT\s|RIGHT\s|CROSS\s|FULL\s)JOIN)\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))(?:\s+(?:AS\s+)?(\[?[\w]+\]?))?/gi;

  let match: RegExpExecArray | null;
  while ((match = joinRegex.exec(sql)) !== null) {
    const rawAlias = match[2];
    // Skip if "alias" is a keyword like ON, WHERE, etc.
    if (rawAlias && isSqlKeyword(stripBrackets(rawAlias))) {
      registerTable(match[1]);
    } else {
      registerTable(match[1], rawAlias);
    }
  }

  // Match FROM clause — may contain comma-separated tables
  // Capture everything between FROM and the next clause keyword
  const fromRegex =
    /\bFROM\s+([\s\S]*?)(?=\bWHERE\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bUNION\b|\bINNER\b|\bLEFT\b|\bRIGHT\b|\bCROSS\b|\bFULL\b|\bJOIN\b|\bON\b|\bSET\b|\bOUTPUT\b|$)/gi;

  while ((match = fromRegex.exec(sql)) !== null) {
    const fromClause = match[1].trim();
    // Split on commas to handle "FROM t1 a, t2 b" syntax
    const parts = fromClause.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Match: [schema].[table] [AS] alias
      const tableMatch = trimmed.match(
        /^((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))(?:\s+(?:AS\s+)?(\[?[\w]+\]?))?/i
      );
      if (tableMatch) {
        const rawAlias = tableMatch[2];
        if (rawAlias && isSqlKeyword(stripBrackets(rawAlias))) {
          registerTable(tableMatch[1]);
        } else {
          registerTable(tableMatch[1], rawAlias);
        }
      }
    }
  }

  // UPDATE table
  const updateMatch = sql.match(
    /\bUPDATE\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))/i
  );
  if (updateMatch) {
    registerTable(updateMatch[1]);
  }

  // INSERT INTO table
  const insertMatch = sql.match(
    /\bINSERT\s+INTO\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))/i
  );
  if (insertMatch) {
    registerTable(insertMatch[1]);
  }

  // DELETE FROM table
  const deleteMatch = sql.match(
    /\bDELETE\s+(?:FROM\s+)?((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))/i
  );
  if (deleteMatch) {
    registerTable(deleteMatch[1]);
  }

  // MERGE INTO table
  const mergeMatch = sql.match(
    /\bMERGE\s+(?:INTO\s+)?((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))(?:\s+(?:AS\s+)?(\[?[\w]+\]?))?/i
  );
  if (mergeMatch) {
    registerTable(mergeMatch[1], mergeMatch[2]);
  }

  return { aliases, referencedTables };
}

// ── Table Validation ──

function validateTableRefs(
  query: ExtractedQuery,
  catalog: SchemaCatalog,
  aliasMap: AliasMap
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const fqn of aliasMap.referencedTables) {
    if (!catalog.tables.has(fqn)) {
      // Try without schema prefix (bare name lookup)
      const bareName = fqn.split(".")[1];
      const found = findTableByBareName(bareName, catalog);
      if (found) continue;

      // Find the line where this table is referenced
      const tableName = fqn.split(".").pop() || fqn;
      const location = findInSource(query, new RegExp(`\\b${escapeRegex(tableName)}\\b`, "i"));

      const allTableNames = Array.from(catalog.tables.values()).map(
        (t) => `${t.schema}.${t.name}`
      );
      const suggestions = findClosestMatches(tableName, allTableNames);

      const schemaFile = catalog.sourceFiles[0] || "unknown";

      errors.push({
        type: "INVALID_TABLE",
        severity: "error",
        file: query.file,
        lineStart: location?.line || query.lineStart,
        lineEnd: location?.line || query.lineEnd,
        schemaFile,
        message: `Table or view "${fqn}" does not exist in the schema.${
          suggestions.length > 0
            ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`
            : ""
        }`,
        suggestion: suggestions[0],
        contextLines: buildContextLines(query, location?.line || query.lineStart),
      });
    }
  }

  return errors;
}

// ── Column Validation ──

function validateColumnRefs(
  query: ExtractedQuery,
  catalog: SchemaCatalog,
  aliasMap: AliasMap
): ValidationError[] {
  const errors: ValidationError[] = [];
  const sql = query.sql;

  // Match column references: alias.column or table.column
  const qualifiedColRegex =
    /(\[?[\w]+\]?)\s*\.\s*(\[?[\w]+\]?)(?!\s*\.\s*\[?[\w]+\]?)(?!\s*\()/g;

  let match: RegExpExecArray | null;
  while ((match = qualifiedColRegex.exec(sql)) !== null) {
    const qualifier = stripBrackets(match[1]).toLowerCase();
    const colName = stripBrackets(match[2]);
    const colNameLower = colName.toLowerCase();

    // Look up the qualifier in the alias map
    const tableRef = aliasMap.aliases.get(qualifier);
    if (!tableRef) continue; // Unknown qualifier — may be a schema prefix, skip

    const table = catalog.tables.get(tableRef.fqn);
    if (!table) continue; // Table doesn't exist — already caught by table validation

    // Skip if the table has no columns defined (e.g., views without column list)
    if (table.columns.size === 0) continue;

    if (!table.columns.has(colNameLower)) {
      // Check if it's a * (wildcard)
      if (colName === "*") continue;

      const location = findInSource(query, new RegExp(
        `\\b${escapeRegex(qualifier)}\\s*\\.\\s*${escapeRegex(colName)}\\b`,
        "i"
      ));

      const allColNames = Array.from(table.columns.values()).map((c) => c.name);
      const suggestions = findClosestMatches(colName, allColNames);

      errors.push({
        type: "INVALID_COLUMN",
        severity: "error",
        file: query.file,
        lineStart: location?.line || query.lineStart,
        lineEnd: location?.line || query.lineEnd,
        schemaFile: catalog.sourceFiles[0] || "unknown",
        message: `Column "${colName}" does not exist on table "${tableRef.schema}.${tableRef.table}".${
          suggestions.length > 0
            ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`
            : ""
        }`,
        suggestion: suggestions[0],
        contextLines: buildContextLines(query, location?.line || query.lineStart),
      });
    }
  }

  // Also validate unqualified column references in SELECT if there's only one table
  if (aliasMap.referencedTables.size === 1) {
    const tableFqn = Array.from(aliasMap.referencedTables)[0];
    const table = catalog.tables.get(tableFqn);
    if (table && table.columns.size > 0) {
      errors.push(
        ...validateUnqualifiedColumns(query, table, aliasMap, catalog)
      );
    }
  }

  return errors;
}

function validateUnqualifiedColumns(
  query: ExtractedQuery,
  table: SchemaTable,
  aliasMap: AliasMap,
  catalog: SchemaCatalog
): ValidationError[] {
  const errors: ValidationError[] = [];
  const sql = query.sql;

  // Extract SELECT column list
  const selectMatch = sql.match(/SELECT\s+(?:TOP\s+\d+\s+)?(?:DISTINCT\s+)?([\s\S]*?)\bFROM\b/i);
  if (!selectMatch) return errors;

  const selectList = selectMatch[1];
  // Split on commas but respect parentheses
  const columns = splitRespectingParens(selectList);

  for (const colExpr of columns) {
    const trimmed = colExpr.trim();
    // Skip * wildcard, expressions, function calls, literals, qualified refs
    if (trimmed === "*") continue;
    if (/\(/.test(trimmed)) continue;          // function call or expression
    if (/\./.test(trimmed)) continue;          // qualified reference
    if (/^['"]/.test(trimmed)) continue;       // string literal
    if (/^\d/.test(trimmed)) continue;         // numeric literal
    if (/\bAS\b/i.test(trimmed)) {
      // Has alias — check the part before AS
      const beforeAs = trimmed.replace(/\s+AS\s+.*$/i, "").trim();
      if (/[.(]/.test(beforeAs)) continue;
      checkUnqualifiedColumn(beforeAs, query, table, aliasMap, catalog, errors);
    } else {
      checkUnqualifiedColumn(trimmed, query, table, aliasMap, catalog, errors);
    }
  }

  return errors;
}

function checkUnqualifiedColumn(
  colName: string,
  query: ExtractedQuery,
  table: SchemaTable,
  aliasMap: AliasMap,
  catalog: SchemaCatalog,
  errors: ValidationError[]
): void {
  const cleaned = stripBrackets(colName.trim());
  if (!cleaned || isSqlKeyword(cleaned)) return;

  const colNameLower = cleaned.toLowerCase();
  if (!table.columns.has(colNameLower)) {
    // Make sure it's not an alias name
    if (aliasMap.aliases.has(colNameLower)) return;

    const location = findInSource(query, new RegExp(`\\b${escapeRegex(cleaned)}\\b`, "i"));
    const allColNames = Array.from(table.columns.values()).map((c) => c.name);
    const suggestions = findClosestMatches(cleaned, allColNames);

    errors.push({
      type: "INVALID_COLUMN",
      severity: "error",
      file: query.file,
      lineStart: location?.line || query.lineStart,
      lineEnd: location?.line || query.lineEnd,
      schemaFile: catalog.sourceFiles[0] || "unknown",
      message: `Column "${cleaned}" does not exist on table "${table.schema}.${table.name}".${
        suggestions.length > 0
          ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`
          : ""
      }`,
      suggestion: suggestions[0],
      contextLines: buildContextLines(query, location?.line || query.lineStart),
    });
  }
}

// ── Function Validation ──

function validateFunctionRefs(
  query: ExtractedQuery,
  catalog: SchemaCatalog
): ValidationError[] {
  const errors: ValidationError[] = [];
  const sql = query.sql;

  // Match schema-qualified function calls: [schema].[funcName](...)
  const funcRegex =
    /(\[?[\w]+\]?)\s*\.\s*(\[?[\w]+\]?)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(sql)) !== null) {
    const schemaPart = stripBrackets(match[1]).toLowerCase();
    const funcName = stripBrackets(match[2]).toLowerCase();

    // Skip single-char names (likely regex noise)
    if (funcName.length <= 1) continue;

    // Skip if the schema part matches a known table alias (it's a column access, not a function)
    // Also skip built-in schemas like sys, INFORMATION_SCHEMA
    if (isBuiltinSchema(schemaPart)) continue;

    // Skip if this is a table reference, not a function call
    // e.g., INSERT INTO dbo.TableName(...) or FROM dbo.TableName(...)
    const preceding = sql.substring(0, match.index);
    if (/(?:INSERT\s+INTO|FROM|JOIN|UPDATE)\s*$/i.test(preceding.trimEnd())) continue;

    // Skip if the matched name is a known table (handles INSERT INTO dbo.Table (cols))
    const candidateFqn = `${schemaPart}.${funcName}`;
    if (catalog.tables.has(candidateFqn)) continue;

    const fqn = `${schemaPart}.${funcName}`;

    // Check if it's a known function
    if (!catalog.routines.has(fqn)) {
      // Skip if it looks like a built-in function (e.g., dbo.fn_ pattern but not in catalog)
      // Only flag if the schema is one we know about
      const schemaExists = Array.from(catalog.tables.keys()).some(
        (k) => k.startsWith(schemaPart + ".")
      ) || Array.from(catalog.routines.keys()).some(
        (k) => k.startsWith(schemaPart + ".")
      );

      if (!schemaExists) continue;

      const location = findInSource(query, new RegExp(
        `\\b${escapeRegex(schemaPart)}\\s*\\.\\s*${escapeRegex(funcName)}\\s*\\(`,
        "i"
      ));

      const allRoutineNames = Array.from(catalog.routines.values()).map(
        (r) => `${r.schema}.${r.name}`
      );
      const suggestions = findClosestMatches(
        `${schemaPart}.${funcName}`,
        allRoutineNames
      );

      errors.push({
        type: "INVALID_FUNCTION",
        severity: "error",
        file: query.file,
        lineStart: location?.line || query.lineStart,
        lineEnd: location?.line || query.lineEnd,
        schemaFile: catalog.sourceFiles[0] || "unknown",
        message: `Function or procedure "${schemaPart}.${funcName}" does not exist in the schema.${
          suggestions.length > 0
            ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`
            : ""
        }`,
        suggestion: suggestions[0],
        contextLines: buildContextLines(query, location?.line || query.lineStart),
      });
    }
  }

  // Also check EXEC/EXECUTE calls
  const execRegex =
    /\b(?:EXEC|EXECUTE)\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))/gi;

  while ((match = execRegex.exec(sql)) !== null) {
    const { schema, name } = parseSimpleQualifiedName(match[1]);
    const fqn = `${schema.toLowerCase()}.${name.toLowerCase()}`;

    if (!catalog.routines.has(fqn)) {
      // Skip system procedures (sp_*)
      if (name.toLowerCase().startsWith("sp_")) continue;

      const schemaExists = Array.from(catalog.routines.keys()).some(
        (k) => k.startsWith(schema.toLowerCase() + ".")
      );
      if (!schemaExists) continue;

      const location = findInSource(query, new RegExp(
        `\\b(?:EXEC|EXECUTE)\\s+${escapeRegex(match[1])}`,
        "i"
      ));

      const allRoutineNames = Array.from(catalog.routines.values()).map(
        (r) => `${r.schema}.${r.name}`
      );
      const suggestions = findClosestMatches(`${schema}.${name}`, allRoutineNames);

      errors.push({
        type: "INVALID_FUNCTION",
        severity: "error",
        file: query.file,
        lineStart: location?.line || query.lineStart,
        lineEnd: location?.line || query.lineEnd,
        schemaFile: catalog.sourceFiles[0] || "unknown",
        message: `Procedure "${schema}.${name}" does not exist in the schema.${
          suggestions.length > 0
            ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`
            : ""
        }`,
        suggestion: suggestions[0],
        contextLines: buildContextLines(query, location?.line || query.lineStart),
      });
    }
  }

  return errors;
}

// ── Index Hint Validation ──

function validateIndexHints(
  query: ExtractedQuery,
  catalog: SchemaCatalog,
  aliasMap: AliasMap
): ValidationError[] {
  const errors: ValidationError[] = [];
  const sql = query.sql;

  // Match WITH (INDEX(...)) hints
  const indexHintRegex =
    /(\[?[\w]+\]?)\s+WITH\s*\(\s*INDEX\s*\(\s*(\[?[\w]+\]?)\s*\)\s*\)/gi;

  let match: RegExpExecArray | null;
  while ((match = indexHintRegex.exec(sql)) !== null) {
    const tableOrAlias = stripBrackets(match[1]).toLowerCase();
    const indexName = stripBrackets(match[2]).toLowerCase();

    // Resolve table from alias
    const tableRef = aliasMap.aliases.get(tableOrAlias);
    if (!tableRef) continue;

    const table = catalog.tables.get(tableRef.fqn);
    if (!table) continue;

    if (!table.indexes.has(indexName)) {
      const location = findInSource(query, new RegExp(
        `INDEX\\s*\\(\\s*${escapeRegex(match[2])}`,
        "i"
      ));

      const allIndexNames = Array.from(table.indexes.values()).map((i) => i.name);
      const suggestions = findClosestMatches(match[2], allIndexNames);

      errors.push({
        type: "INVALID_INDEX",
        severity: "error",
        file: query.file,
        lineStart: location?.line || query.lineStart,
        lineEnd: location?.line || query.lineEnd,
        schemaFile: catalog.sourceFiles[0] || "unknown",
        message: `Index "${match[2]}" does not exist on table "${tableRef.schema}.${tableRef.table}".${
          suggestions.length > 0
            ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?`
            : ""
        }`,
        suggestion: suggestions[0],
        contextLines: buildContextLines(query, location?.line || query.lineStart),
      });
    }
  }

  return errors;
}

// ── Helpers ──

function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, "").replace(/^"|"$/g, "");
}

function parseSimpleQualifiedName(raw: string): { schema: string; name: string } {
  const parts = raw.split(".");
  if (parts.length >= 2) {
    return {
      schema: stripBrackets(parts[parts.length - 2]),
      name: stripBrackets(parts[parts.length - 1]),
    };
  }
  return { schema: "dbo", name: stripBrackets(parts[0]) };
}

function findTableByBareName(
  bareName: string,
  catalog: SchemaCatalog
): SchemaTable | undefined {
  for (const [, table] of catalog.tables) {
    if (table.name.toLowerCase() === bareName) return table;
  }
  return undefined;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findInSource(
  query: ExtractedQuery,
  pattern: RegExp
): { line: number; col: number } | null {
  const lines = query.sql.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (match) {
      return {
        line: query.lineStart + i,
        col: match.index || 0,
      };
    }
  }
  return null;
}

function buildContextLines(
  query: ExtractedQuery,
  errorLine: number
): ContextLine[] {
  const result: ContextLine[] = [];
  const contextRadius = 2;

  for (let i = 0; i < query.sourceLines.length; i++) {
    const lineNum = query.lineStart - 2 + i; // account for context lines
    const actualLineNum = Math.max(1, lineNum);
    result.push({
      lineNumber: actualLineNum,
      text: query.sourceLines[i],
      isError: actualLineNum === errorLine,
    });
  }

  // If we don't have source lines, create minimal context from the SQL itself
  if (result.length === 0) {
    const sqlLines = query.sql.split("\n");
    const errorIdx = errorLine - query.lineStart;
    const start = Math.max(0, errorIdx - contextRadius);
    const end = Math.min(sqlLines.length, errorIdx + contextRadius + 1);

    for (let i = start; i < end; i++) {
      result.push({
        lineNumber: query.lineStart + i,
        text: sqlLines[i],
        isError: query.lineStart + i === errorLine,
      });
    }
  }

  return result;
}

function splitRespectingParens(input: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) result.push(current);
  return result;
}

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "and", "or", "not", "in", "on", "as",
  "join", "inner", "left", "right", "outer", "cross", "full",
  "group", "by", "order", "having", "union", "all", "distinct",
  "top", "into", "values", "set", "update", "delete", "insert",
  "create", "alter", "drop", "table", "view", "index", "function",
  "procedure", "exec", "execute", "declare", "begin", "end",
  "if", "else", "while", "return", "with", "case", "when", "then",
  "null", "is", "like", "between", "exists", "asc", "desc",
  "primary", "key", "foreign", "references", "constraint",
  "default", "identity", "clustered", "nonclustered",
  "nolock", "rowlock", "updlock", "holdlock", "readpast",
  "merge", "using", "matched", "output", "inserted", "deleted",
]);

function isSqlKeyword(word: string): boolean {
  return SQL_KEYWORDS.has(word.toLowerCase());
}

function isBuiltinSchema(schema: string): boolean {
  const builtins = new Set([
    "sys", "information_schema", "guest", "db_owner",
    "db_accessadmin", "db_securityadmin", "db_ddladmin",
  ]);
  return builtins.has(schema.toLowerCase());
}
