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

  // Pre-scan for CTE names so FROM-clause resolution can route aliases
  // that reference a CTE (e.g., FROM DailyVolume dv) to the CTE scope
  // instead of treating DailyVolume as a missing table.
  const cteNames = collectCteNames(sql);

  function registerTable(rawTable: string, rawAlias?: string): void {
    const { schema, name } = parseSimpleQualifiedName(rawTable);
    // Skip if the table name is a SQL keyword (parser noise like "FROM dbo.SELECT")
    if (isSqlKeyword(name)) return;
    // Skip built-in schemas (sys, information_schema) and system databases
    if (isBuiltinSchema(schema) || isSystemDatabase(schema)) return;
    // Skip T-SQL built-in functions used as table sources (e.g., FROM STRING_SPLIT(...))
    if (isBuiltinFunction(name)) return;
    // Skip names that are clearly not identifiers (contain spaces, operators, etc.)
    if (/[^a-zA-Z0-9_#@]/.test(name)) return;

    const nameLower = name.toLowerCase();
    // If this "table" is actually a CTE defined in the same query, route
    // its alias to the CTE scope instead of the schema scope.
    if (cteNames.has(nameLower)) {
      const cteFqn = `__cte__.${nameLower}`;
      if (rawAlias) {
        const alias = stripBrackets(rawAlias).toLowerCase();
        if (!isSqlKeyword(alias)) {
          aliases.set(alias, { schema: "__cte__", table: name, fqn: cteFqn });
        }
      }
      aliases.set(nameLower, { schema: "__cte__", table: name, fqn: cteFqn });
      return;
    }

    const fqn = `${schema.toLowerCase()}.${nameLower}`;
    referencedTables.add(fqn);

    if (rawAlias) {
      const alias = stripBrackets(rawAlias).toLowerCase();
      if (!isSqlKeyword(alias)) {
        aliases.set(alias, { schema, table: name, fqn });
      }
    }
    // Also register the table name itself as an implicit alias
    aliases.set(nameLower, { schema, table: name, fqn });
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
  // Capture everything between FROM and the next clause keyword.
  // Also stop at ) or another SELECT to avoid bleeding out of subqueries/CTEs.
  const fromRegex =
    /\bFROM\s+([\s\S]*?)(?=\bWHERE\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bUNION\b|\bINNER\b|\bLEFT\b|\bRIGHT\b|\bCROSS\b|\bFULL\b|\bJOIN\b|\bON\b|\bSET\b|\bOUTPUT\b|\bSELECT\b|\)|$)/gi;

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

  // Register all CTE names collected earlier as aliases in the CTE scope.
  for (const cteName of cteNames) {
    aliases.set(cteName, { schema: "__cte__", table: cteName, fqn: `__cte__.${cteName}` });
  }

  // Detect TVF usage in FROM clause: FROM STRING_SPLIT(...) AS alias
  // Register the alias with the TVF's known output columns as a virtual table.
  const tvfRegex = /\b(?:FROM|JOIN|APPLY)\s+(\w+)\s*\([^)]*\)\s+(?:AS\s+)?(\[?[\w]+\]?)/gi;
  let tvfMatch: RegExpExecArray | null;
  while ((tvfMatch = tvfRegex.exec(sql)) !== null) {
    const funcName = tvfMatch[1].toLowerCase();
    const aliasName = stripBrackets(tvfMatch[2]).toLowerCase();
    if (TVF_COLUMNS[funcName] && !isSqlKeyword(aliasName)) {
      // Register as a CTE-style alias (columns checked against TVF_COLUMNS)
      aliases.set(aliasName, {
        schema: "__tvf__",
        table: funcName,
        fqn: `__tvf__.${funcName}`,
      });
    }
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
    // Skip CTE references (registered by buildAliasMap)
    if (fqn.startsWith("__cte__.")) continue;

    if (!catalog.tables.has(fqn)) {
      // Try without schema prefix (bare name lookup)
      const bareName = fqn.split(".")[1];
      const found = findTableByBareName(bareName, catalog);
      if (found) continue;

      // Skip if the bare name is a CTE alias (not just the table's own self-registration)
      const aliasEntry = aliasMap.aliases.get(bareName);
      if (aliasEntry && aliasEntry.fqn.startsWith("__cte__.")) continue;

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

    // Skip if this looks like an expression, not a column name
    // (CASE, string concat, interpolation, etc.)
    if (looksLikeExpression(colName)) continue;

    // Look up the qualifier in the alias map
    const tableRef = aliasMap.aliases.get(qualifier);
    if (!tableRef) continue; // Unknown qualifier — may be a schema prefix, skip

    // Skip CTE columns (we don't know their column lists)
    if (tableRef.fqn.startsWith("__cte__.")) continue;

    // Validate TVF output columns against the known column set
    if (tableRef.fqn.startsWith("__tvf__.")) {
      const tvfName = tableRef.fqn.substring("__tvf__.".length);
      const known = TVF_COLUMNS[tvfName];
      if (known && !known.has(colNameLower)) {
        // The column isn't one of the known TVF outputs — but we skip
        // flagging since the TVF set may not be complete; better to
        // avoid false positives here.
      }
      continue;
    }

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

  // Extract SELECT column list (strip TOP N, TOP (N), TOP {param}, DISTINCT)
  const selectMatch = sql.match(/SELECT\s+(?:TOP\s+(?:\d+|\([^)]*\)|\{[^}]*\})\s+)?(?:DISTINCT\s+)?([\s\S]*?)\bFROM\b/i);
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
    if (looksLikeExpression(trimmed)) continue; // CASE, concat, interpolation
    if (/\bAS\b/i.test(trimmed)) {
      // Has alias — check the part before AS
      const beforeAs = trimmed.replace(/\s+AS\s+.*$/i, "").trim();
      if (/[.(]/.test(beforeAs)) continue;
      if (looksLikeExpression(beforeAs)) continue;
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
  if (looksLikeExpression(cleaned)) return;

  const colNameLower = cleaned.toLowerCase();
  if (!table.columns.has(colNameLower)) {
    // Make sure it's not an alias name
    if (aliasMap.aliases.has(colNameLower)) return;

    // Skip if it's a known TVF output column (e.g., SELECT value FROM STRING_SPLIT)
    for (const [, alias] of aliasMap.aliases) {
      if (alias.fqn.startsWith("__tvf__.")) {
        const tvfName = alias.fqn.substring("__tvf__.".length);
        if (TVF_COLUMNS[tvfName]?.has(colNameLower)) return;
      }
    }
    // Also check if the column appears in any TVF's output even without an
    // explicit alias (e.g., FROM STRING_SPLIT(...) with no alias)
    if (isTvfOutputColumn(colNameLower, query.sql)) return;

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

    // Skip T-SQL built-in functions (DATEDIFF, CAST, STRING_SPLIT, etc.)
    if (isBuiltinFunction(funcName)) continue;

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

/** Known output columns for T-SQL table-valued functions */
const TVF_COLUMNS: Record<string, Set<string>> = {
  string_split: new Set(["value", "ordinal"]),
  openjson: new Set(["key", "value", "type"]),
  generate_series: new Set(["value"]),
};

/** T-SQL built-in functions (scalar + table-valued) that should not be flagged */
const TSQL_BUILTIN_FUNCTIONS = new Set([
  // Scalar functions
  "getdate", "getutcdate", "sysdatetime", "sysutcdatetime", "sysdatetimeoffset",
  "datediff", "dateadd", "datepart", "datename", "year", "month", "day",
  "cast", "convert", "try_cast", "try_convert", "parse", "try_parse",
  "isnull", "coalesce", "nullif", "iif", "choose",
  "len", "datalength", "left", "right", "substring", "charindex", "patindex",
  "replace", "stuff", "reverse", "replicate", "space", "trim", "ltrim", "rtrim",
  "upper", "lower", "format", "concat", "concat_ws", "string_agg",
  "abs", "ceiling", "floor", "round", "power", "sqrt", "sign", "rand",
  "newid", "newsequentialid", "checksum", "binary_checksum", "hashbytes",
  "row_number", "rank", "dense_rank", "ntile", "lag", "lead",
  "first_value", "last_value", "percent_rank", "cume_dist",
  "count", "sum", "avg", "min", "max", "stdev", "stdevp", "var", "varp",
  "object_id", "object_name", "db_id", "db_name", "schema_id", "schema_name",
  "type_id", "type_name", "col_name", "col_length",
  "scope_identity", "ident_current", "identity",
  "error_message", "error_number", "error_severity", "error_state", "error_line", "error_procedure",
  "host_name", "app_name", "suser_sname", "suser_sid", "user_name", "user_id",
  "json_value", "json_query", "json_modify", "isjson", "openjson",
  "greatest", "least",
  // Table-valued functions
  "string_split", "openjson", "openxml", "openrowset", "openquery",
  "generate_series", "nodes",
]);

function isBuiltinFunction(name: string): boolean {
  return TSQL_BUILTIN_FUNCTIONS.has(name.toLowerCase());
}

/**
 * Collect all CTE names defined in a query: WITH name AS (...), name2 AS (...), ...
 * Uses paren-depth tracking to only pick up top-level CTE names, not names
 * that appear inside the CTE bodies themselves.
 */
function collectCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  // SQL allows only one WITH clause per statement — find the first one
  const withMatch = /\bWITH\s+/i.exec(sql);
  if (!withMatch) return names;

  const startPos = withMatch.index + withMatch[0].length;
  const remaining = sql.substring(startPos);
  const cteItemRegex = /(\[?[\w]+\]?)(?:\s*\([^)]*\))?\s+AS\s*\(/gi;
  let depth = 0;
  let lastEnd = 0;
  let ctem: RegExpExecArray | null;
  while ((ctem = cteItemRegex.exec(remaining)) !== null) {
    const between = remaining.substring(lastEnd, ctem.index);
    for (const ch of between) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (depth !== 0) {
      lastEnd = ctem.index + ctem[0].length;
      continue;
    }
    const cteName = stripBrackets(ctem[1]).toLowerCase();
    if (!isSqlKeyword(cteName)) names.add(cteName);
    depth++;
    lastEnd = ctem.index + ctem[0].length;
  }
  return names;
}

/**
 * Check if `colName` is a known output column of any TVF referenced in `sql`.
 * Catches unqualified references like SELECT value FROM STRING_SPLIT(...)
 * even when the TVF has no explicit alias.
 */
function isTvfOutputColumn(colName: string, sql: string): boolean {
  for (const [tvfName, cols] of Object.entries(TVF_COLUMNS)) {
    if (!cols.has(colName)) continue;
    // Is this TVF used in the SQL?
    const tvfRegex = new RegExp(`\\b${tvfName}\\s*\\(`, "i");
    if (tvfRegex.test(sql)) return true;
  }
  return false;
}

function isBuiltinSchema(schema: string): boolean {
  const builtins = new Set([
    "sys", "information_schema", "guest", "db_owner",
    "db_accessadmin", "db_securityadmin", "db_ddladmin",
    "db_datareader", "db_datawriter", "db_backupoperator",
  ]);
  return builtins.has(schema.toLowerCase());
}

/** SQL Server system databases that should be skipped */
function isSystemDatabase(name: string): boolean {
  const systemDbs = new Set([
    "master", "msdb", "tempdb", "model", "resource",
  ]);
  return systemDbs.has(name.toLowerCase());
}

/**
 * Heuristic: does this "column name" look like an expression rather than
 * an identifier? Catches CASE expressions, string concatenation,
 * interpolation artifacts, TOP clauses, etc.
 */
function looksLikeExpression(name: string): boolean {
  // Contains spaces (real column names don't, but CASE WHEN ... does)
  if (/\s/.test(name)) return true;
  // Contains operators: +, -, *, /, =, <, >, etc.
  if (/[+\-*/<>=!|&]/.test(name)) return true;
  // Contains interpolation markers: {, }, $
  if (/[{}$]/.test(name)) return true;
  // Contains string delimiters
  if (/['"]/.test(name)) return true;
  // Starts with a number
  if (/^\d/.test(name)) return true;
  return false;
}
