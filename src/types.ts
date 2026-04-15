// ── Core domain types for sql-validate ──

/** A column defined in the schema */
export interface SchemaColumn {
  name: string;
  /** Lowercased name for case-insensitive matching */
  nameLower: string;
  dataType: string;
  isNullable: boolean;
}

/** A table or view defined in the schema */
export interface SchemaTable {
  schema: string;        // e.g. "dbo"
  name: string;
  /** Lowercased "[schema].[name]" for matching */
  fqnLower: string;
  columns: Map<string, SchemaColumn>;
  indexes: Map<string, SchemaIndex>;
  type: "TABLE" | "VIEW";
}

/** An index defined in the schema */
export interface SchemaIndex {
  name: string;
  nameLower: string;
  tableFqn: string;
  columns: string[];
}

/** A function or stored procedure defined in the schema */
export interface SchemaRoutine {
  schema: string;
  name: string;
  fqnLower: string;
  type: "FUNCTION" | "PROCEDURE";
  parameters: string[];
}

/** A user-defined type in the schema */
export interface SchemaType {
  schema: string;
  name: string;
  fqnLower: string;
  baseType: string;
}

/** The complete schema catalog built from parsing schema files */
export interface SchemaCatalog {
  tables: Map<string, SchemaTable>;       // key = lowercase "[schema].[name]"
  routines: Map<string, SchemaRoutine>;   // key = lowercase "[schema].[name]"
  types: Map<string, SchemaType>;         // key = lowercase "[schema].[name]"
  /** Source file each object was parsed from */
  sourceFiles: string[];
}

// ── Validation error types ──

export type ErrorType =
  | "INVALID_TABLE"
  | "INVALID_COLUMN"
  | "INVALID_FUNCTION"
  | "INVALID_INDEX"
  | "SYNTAX_ERROR"
  | "AMBIGUOUS_COLUMN";

export type Severity = "error" | "warning";

export interface ValidationError {
  type: ErrorType;
  severity: Severity;
  file: string;
  lineStart: number;
  lineEnd: number;
  /** The relevant schema file for this object */
  schemaFile: string;
  message: string;
  /** Suggestion for correction, if available */
  suggestion?: string;
  /** The SQL context lines around the error */
  contextLines: ContextLine[];
}

export interface ContextLine {
  lineNumber: number;
  text: string;
  isError: boolean;
}

// ── SQL extraction types ──

export interface ExtractedQuery {
  sql: string;
  file: string;
  /** Line number in the source file where the SQL starts */
  lineStart: number;
  /** Line number in the source file where the SQL ends */
  lineEnd: number;
  /** The raw source lines for context display */
  sourceLines: string[];
}

// ── CLI options ──

export interface CliOptions {
  schema: string[];
  src: string[];
  exclude: string[];
  format: "text" | "json";
  severity: Severity;
  verbose: boolean;
  ignore?: string;
  global?: boolean;
}
