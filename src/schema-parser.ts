import * as fs from "fs";
import * as path from "path";
import { readFileAutoEncoding } from "./file-reader";
import {
  SchemaCatalog,
  SchemaTable,
  SchemaColumn,
  SchemaIndex,
  SchemaRoutine,
  SchemaType,
} from "./types";

/**
 * Parse one or more SSMS-exported schema SQL files into a SchemaCatalog.
 * Handles CREATE TABLE, CREATE VIEW, CREATE INDEX, CREATE FUNCTION,
 * CREATE PROCEDURE, CREATE TYPE, and ALTER TABLE ADD statements.
 */
export function parseSchemaFiles(filePaths: string[]): SchemaCatalog {
  const catalog: SchemaCatalog = {
    tables: new Map(),
    routines: new Map(),
    types: new Map(),
    sourceFiles: [],
  };

  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    catalog.sourceFiles.push(resolved);
    const content = readFileAutoEncoding(resolved);
    parseSchemaContent(content, resolved, catalog);
  }

  return catalog;
}

function parseSchemaContent(
  content: string,
  sourceFile: string,
  catalog: SchemaCatalog
): void {
  // Normalize line endings
  const normalized = content.replace(/\r\n/g, "\n");

  parseCreateTables(normalized, sourceFile, catalog);
  parseCreateViews(normalized, sourceFile, catalog);
  parseCreateIndexes(normalized, catalog);
  parseCreateFunctions(normalized, sourceFile, catalog);
  parseCreateProcedures(normalized, sourceFile, catalog);
  parseCreateTypes(normalized, sourceFile, catalog);
  parseAlterTableAddColumns(normalized, catalog);
}

// ── Name helpers ──

/** Strip square brackets and quotes from an identifier */
function stripQuotes(name: string): string {
  return name.replace(/^\[|\]$/g, "").replace(/^"|"$/g, "");
}

/**
 * Parse a possibly schema-qualified name like [dbo].[Users] or dbo.Users
 * Returns { schema, name } with defaults to "dbo" if no schema prefix.
 */
function parseQualifiedName(raw: string): { schema: string; name: string } {
  // Match patterns: [schema].[name], schema.[name], [schema].name, schema.name
  const match = raw.match(
    /(?:(\[?[^\].\s]+\]?)\.)?(\[?[^\].\s]+\]?)/
  );
  if (!match) return { schema: "dbo", name: stripQuotes(raw) };

  const schemaPart = match[1] ? stripQuotes(match[1]) : "dbo";
  const namePart = stripQuotes(match[2]);
  return { schema: schemaPart, name: namePart };
}

function makeFqn(schema: string, name: string): string {
  return `${schema.toLowerCase()}.${name.toLowerCase()}`;
}

// ── CREATE TABLE ──

function parseCreateTables(
  content: string,
  sourceFile: string,
  catalog: SchemaCatalog
): void {
  // Match CREATE TABLE [schema].[name] ( ... )
  // Use a regex that finds CREATE TABLE then captures the column block
  const tableRegex =
    /CREATE\s+TABLE\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s*\(([\s\S]*?)\n\)/gi;

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);
    const columnsBlock = match[2];

    const table: SchemaTable = {
      schema,
      name,
      fqnLower,
      columns: new Map(),
      indexes: new Map(),
      type: "TABLE",
    };

    parseColumnsBlock(columnsBlock, table);

    catalog.tables.set(fqnLower, table);
  }
}

function parseColumnsBlock(block: string, table: SchemaTable): void {
  const lines = block.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, constraint lines, index lines
    if (!trimmed) continue;
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|INDEX|CHECK|FOREIGN\s+KEY)/i.test(trimmed)) continue;
    if (/^(GO|;|\))/i.test(trimmed)) continue;

    // Match: [ColumnName] [datatype](size) or ColumnName datatype(size)
    // SSMS wraps both names and types in brackets, e.g. [Email] [nvarchar](255)
    const colMatch = trimmed.match(
      /^(\[?[\w]+\]?)\s+(\[?[\w]+\]?(?:\s*\([^)]*\))?)/
    );
    if (!colMatch) continue;

    const colName = stripQuotes(colMatch[1]);
    const dataType = colMatch[2].trim();
    const isNullable = !/NOT\s+NULL/i.test(trimmed);

    const column: SchemaColumn = {
      name: colName,
      nameLower: colName.toLowerCase(),
      dataType,
      isNullable,
    };
    table.columns.set(column.nameLower, column);
  }
}

// ── CREATE VIEW ──

function parseCreateViews(
  content: string,
  sourceFile: string,
  catalog: SchemaCatalog
): void {
  // Views: we capture the name but don't deeply parse the SELECT
  // We store them as tables so column refs against views can at least validate the view exists
  const viewRegex =
    /CREATE\s+VIEW\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s*(?:\(([^)]*)\))?\s*AS\b/gi;

  let match: RegExpExecArray | null;
  while ((match = viewRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);

    const table: SchemaTable = {
      schema,
      name,
      fqnLower,
      columns: new Map(),
      indexes: new Map(),
      type: "VIEW",
    };

    // If the view has an explicit column list in parens, parse those
    if (match[2]) {
      const colNames = match[2].split(",").map((c) => c.trim());
      for (const cn of colNames) {
        const cleaned = stripQuotes(cn);
        table.columns.set(cleaned.toLowerCase(), {
          name: cleaned,
          nameLower: cleaned.toLowerCase(),
          dataType: "unknown",
          isNullable: true,
        });
      }
    }

    catalog.tables.set(fqnLower, table);
  }
}

// ── CREATE INDEX ──

function parseCreateIndexes(
  content: string,
  catalog: SchemaCatalog
): void {
  const indexRegex =
    /CREATE\s+(?:UNIQUE\s+)?(?:CLUSTERED\s+|NONCLUSTERED\s+)?INDEX\s+(\[?[\w]+\]?)\s+ON\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s*\(([^)]*)\)/gi;

  let match: RegExpExecArray | null;
  while ((match = indexRegex.exec(content)) !== null) {
    const indexName = stripQuotes(match[1]);
    const { schema, name: tableName } = parseQualifiedName(match[2]);
    const tableFqn = makeFqn(schema, tableName);
    const columns = match[3]
      .split(",")
      .map((c) => stripQuotes(c.trim().replace(/\s+(ASC|DESC)$/i, "")));

    const index: SchemaIndex = {
      name: indexName,
      nameLower: indexName.toLowerCase(),
      tableFqn,
      columns,
    };

    // Attach to the table if it exists
    const table = catalog.tables.get(tableFqn);
    if (table) {
      table.indexes.set(index.nameLower, index);
    }
  }
}

// ── CREATE FUNCTION ──

function parseCreateFunctions(
  content: string,
  sourceFile: string,
  catalog: SchemaCatalog
): void {
  const funcRegex =
    /CREATE\s+FUNCTION\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s*\(([^)]*)\)/gi;

  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);
    const params = match[2]
      ? match[2]
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];

    const routine: SchemaRoutine = {
      schema,
      name,
      fqnLower,
      type: "FUNCTION",
      parameters: params,
    };
    catalog.routines.set(fqnLower, routine);
  }
}

// ── CREATE PROCEDURE ──

function parseCreateProcedures(
  content: string,
  sourceFile: string,
  catalog: SchemaCatalog
): void {
  // Proc params can be in parens or just listed before AS (SSMS style)
  const procRegex =
    /CREATE\s+PROC(?:EDURE)?\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s*(?:\(([^)]*)\)|([\s\S]*?))(?=\bAS\b)/gi;

  let match: RegExpExecArray | null;
  while ((match = procRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);
    const paramBlock = match[2] || match[3] || "";
    const params = paramBlock
      ? paramBlock
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];

    const routine: SchemaRoutine = {
      schema,
      name,
      fqnLower,
      type: "PROCEDURE",
      parameters: params,
    };
    catalog.routines.set(fqnLower, routine);
  }
}

// ── CREATE TYPE ──

function parseCreateTypes(
  content: string,
  sourceFile: string,
  catalog: SchemaCatalog
): void {
  const typeRegex =
    /CREATE\s+TYPE\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s+FROM\s+([\w]+(?:\s*\([^)]*\))?)/gi;

  let match: RegExpExecArray | null;
  while ((match = typeRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);

    const schemaType: SchemaType = {
      schema,
      name,
      fqnLower,
      baseType: match[2].trim(),
    };
    catalog.types.set(fqnLower, schemaType);
  }

  // Also handle table types: CREATE TYPE ... AS TABLE (...)
  const tableTypeRegex =
    /CREATE\s+TYPE\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s+AS\s+TABLE\s*\(([^)]*)\)/gi;

  while ((match = tableTypeRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);

    // Register as both a type and a table
    const schemaType: SchemaType = {
      schema,
      name,
      fqnLower,
      baseType: "TABLE",
    };
    catalog.types.set(fqnLower, schemaType);

    const table: SchemaTable = {
      schema,
      name,
      fqnLower,
      columns: new Map(),
      indexes: new Map(),
      type: "TABLE",
    };
    parseColumnsBlock(match[2], table);
    catalog.tables.set(fqnLower, table);
  }
}

// ── ALTER TABLE ADD columns ──

function parseAlterTableAddColumns(
  content: string,
  catalog: SchemaCatalog
): void {
  const alterRegex =
    /ALTER\s+TABLE\s+((?:\[?[\w]+\]?\.)?(?:\[?[\w]+\]?))\s+ADD\s+([\s\S]*?)(?=;|GO\b|\bALTER\b|\bCREATE\b|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = alterRegex.exec(content)) !== null) {
    const { schema, name } = parseQualifiedName(match[1]);
    const fqnLower = makeFqn(schema, name);
    const table = catalog.tables.get(fqnLower);
    if (!table) continue;

    // The ADD block may have multiple columns
    const block = match[2];
    parseColumnsBlock(block, table);
  }
}

/**
 * Find the closest matching names for a given input (for "did you mean?" suggestions).
 */
export function findClosestMatches(
  input: string,
  candidates: string[],
  maxResults = 3
): string[] {
  const inputLower = input.toLowerCase();
  const scored = candidates
    .map((c) => ({ name: c, score: levenshtein(inputLower, c.toLowerCase()) }))
    .sort((a, b) => a.score - b.score);

  // Only suggest if the edit distance is reasonable (< half the string length)
  const threshold = Math.max(Math.ceil(input.length / 2), 3);
  return scored
    .filter((s) => s.score <= threshold)
    .slice(0, maxResults)
    .map((s) => s.name);
}

/** Simple Levenshtein distance */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
