import * as fs from "fs";
import * as path from "path";
import { readFileAutoEncoding } from "./file-reader";
import { ExtractedQuery } from "./types";

/**
 * Extract SQL queries from a source file based on its extension.
 */
export function extractQueries(filePath: string): ExtractedQuery[] {
  const ext = path.extname(filePath).toLowerCase();
  const content = readFileAutoEncoding(filePath);
  const lines = content.split(/\r?\n/);

  switch (ext) {
    case ".sql":
      return extractFromSqlFile(filePath, content, lines);
    case ".cs":
      return extractFromCSharpFile(filePath, content, lines);
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return extractFromJsTs(filePath, content, lines);
    case ".py":
      return extractFromPython(filePath, content, lines);
    case ".java":
    case ".bx":
    case ".kt":
    case ".scala":
      return extractFromJavaLike(filePath, content, lines);
    case ".php":
      return extractFromPhp(filePath, content, lines);
    case ".cfm":
    case ".cfml":
    case ".cfc":
      return extractFromColdFusion(filePath, content, lines);
    case ".asp":
    case ".vbs":
    case ".vb":
      return extractFromVbLike(filePath, content, lines);
    case ".aspx":
      // ASPX files contain C#-style embedded code
      return extractFromCSharpFile(filePath, content, lines);
    case ".rb":
      return extractFromRuby(filePath, content, lines);
    case ".go":
      return extractFromGo(filePath, content, lines);
    case ".rs":
      return extractFromRust(filePath, content, lines);
    default:
      return [];
  }
}

// ── .sql files: the entire file is SQL ──

function extractFromSqlFile(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  // Split on GO batches
  const batches = splitOnGo(content);
  const results: ExtractedQuery[] = [];

  let currentLine = 1;
  for (const batch of batches) {
    const trimmed = batch.trim();
    if (!trimmed) {
      currentLine += batch.split("\n").length;
      continue;
    }

    // Only validate DML statements (SELECT, INSERT, UPDATE, DELETE, MERGE)
    // and DDL that references objects
    if (containsQueryKeywords(trimmed)) {
      const batchLines = batch.split("\n");
      results.push({
        sql: trimmed,
        file: filePath,
        lineStart: currentLine,
        lineEnd: currentLine + batchLines.length - 1,
        sourceLines: getSourceLines(lines, currentLine, currentLine + batchLines.length - 1),
      });
    }
    currentLine += batch.split("\n").length;
  }

  return results;
}

function splitOnGo(content: string): string[] {
  // Split on "GO" on its own line (standard SSMS batch separator)
  return content.split(/^\s*GO\s*$/im);
}

function containsQueryKeywords(sql: string): boolean {
  // Must have a primary verb (SELECT, INSERT, etc.)
  const hasPrimaryVerb =
    /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|EXEC|EXECUTE)\b/i.test(sql);
  if (!hasPrimaryVerb) return false;

  // EXEC/EXECUTE is sufficient on its own
  if (/\b(EXEC|EXECUTE)\b/i.test(sql)) return true;

  // Allow standalone function/procedure calls like `SELECT dbo.fn_Name(...)`
  // where a schema-qualified function call appears after SELECT.
  if (/\bSELECT\s+\w+\s*\.\s*\w+\s*\(/i.test(sql)) return true;

  // Require structural companions that look like real SQL, not prose or CSS:
  //   FROM <identifier>  — not "from {" (CSS keyframes) or "from the menu" (prose)
  //   WHERE <ident>      — not "where are you"
  //   JOIN <ident>, VALUES (, SET <col>=, INTO <ident>, ON <a>.<b>
  const hasStructural =
    /\b(FROM\s+[\[\w]+[\w\]]*\s*(?:\.|\(|AS\b|,|\s+\w+|\s*$)|WHERE\s+[\[\w]+[\w\]]*\s*[=<>!.]|JOIN\s+[\[\w]|VALUES\s*\(|SET\s+\w+\s*=|INTO\s+[\[\w]+[\w\]]*|ON\s+\w+\s*\.\s*\w+)/i.test(sql);
  return hasStructural;
}

// ── C# files: extract SQL from string literals ──

function extractFromCSharpFile(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];

  // Track byte ranges covered by verbatim/raw strings so regular strings don't overlap
  const coveredRanges: Array<[number, number]> = [];

  // Match verbatim strings @"..." which commonly hold SQL
  extractVerbatimStrings(content, lines, filePath, results, coveredRanges);

  // Match raw string literals (C# 11+) """..."""
  extractRawStrings(content, lines, filePath, results, coveredRanges);

  // Match regular string literals "..." that look like SQL (skip covered ranges)
  extractRegularStrings(content, lines, filePath, results, coveredRanges);

  return results;
}

function extractVerbatimStrings(
  content: string,
  lines: string[],
  filePath: string,
  results: ExtractedQuery[],
  coveredRanges: Array<[number, number]>
): void {
  // @"..." strings — can span multiple lines, "" is escaped quote
  const regex = /@"((?:[^"]|"")*?)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    coveredRanges.push([match.index, match.index + match[0].length]);

    const raw = match[1].replace(/""/g, '"');
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }
}

function extractRegularStrings(
  content: string,
  lines: string[],
  filePath: string,
  results: ExtractedQuery[],
  coveredRanges: Array<[number, number]>
): void {
  // Standard C# string: "..." on a single line (no unescaped newlines)
  const regex = /(?<!@)"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    // Skip if this match overlaps with a verbatim/raw string range
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (coveredRanges.some(([s, e]) => matchStart >= s && matchEnd <= e)) continue;

    const raw = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"');
    if (!containsQueryKeywords(raw)) continue;
    // Skip very short strings that are unlikely to be real queries
    if (raw.length < 15) continue;
    // Skip strings that look like code rather than SQL
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }
}

function extractRawStrings(
  content: string,
  lines: string[],
  filePath: string,
  results: ExtractedQuery[],
  coveredRanges: Array<[number, number]>
): void {
  // C# raw string literals: """..."""
  const regex = /"""([\s\S]*?)"""/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    coveredRanges.push([match.index, match.index + match[0].length]);

    const raw = match[1];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }
}

// ── TypeScript/JavaScript files: extract SQL from template literals and strings ──

function extractFromJsTs(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];

  // Template literals: `...` (may contain ${} interpolations)
  const templateRegex = /`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;

  while ((match = templateRegex.exec(content)) !== null) {
    // Replace ${...} interpolations with a placeholder for analysis
    const raw = match[1].replace(/\$\{[^}]*\}/g, "'__PARAM__'");
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Regular strings with SQL
  const stringRegex = /(?<!=\s*)"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const raw = (match[1] || match[2] || "")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── Python files: extract SQL from strings ──

function extractFromPython(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];

  // Triple-quoted strings (""" or ''')
  const tripleRegex = /(?:f?)("""([\s\S]*?)"""|'''([\s\S]*?)''')/g;
  let match: RegExpExecArray | null;

  while ((match = tripleRegex.exec(content)) !== null) {
    const raw = (match[2] || match[3] || "").replace(/\{[^}]*\}/g, "'__PARAM__'");
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Regular strings
  const stringRegex = /(?:f?)"((?:[^"\\]|\\.)*)"|(?:f?)'((?:[^'\\]|\\.)*)'/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const raw = (match[1] || match[2] || "")
      .replace(/\\n/g, "\n")
      .replace(/\{[^}]*\}/g, "'__PARAM__'");
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── Java / Kotlin / Scala / BoxLang: "..." strings + """...""" text blocks ──

function extractFromJavaLike(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  const coveredRanges: Array<[number, number]> = [];

  // Text blocks (Java 15+, Kotlin, Scala): """..."""
  const textBlockRegex = /"""([\s\S]*?)"""/g;
  let match: RegExpExecArray | null;

  while ((match = textBlockRegex.exec(content)) !== null) {
    coveredRanges.push([match.index, match.index + match[0].length]);

    const raw = match[1];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Regular strings "..." (single line, skip ranges covered by text blocks)
  const stringRegex = /"((?:[^"\\]|\\.)*)"/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (coveredRanges.some(([s, e]) => matchStart >= s && matchEnd <= e)) continue;

    const raw = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"');
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── PHP: "...", '...', heredoc <<<SQL...SQL; ──

function extractFromPhp(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  let match: RegExpExecArray | null;

  // Heredoc / Nowdoc: <<<SQL ... SQL; or <<<'SQL' ... SQL;
  // Common identifiers: SQL, EOT, EOQ, QUERY, EOF
  // PHP heredoc/nowdoc: <<<SQL ... SQL; (closing may be indented in PHP 7.3+)
  const heredocRegex = /<<<['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n\s*\1;/g;
  while ((match = heredocRegex.exec(content)) !== null) {
    const raw = match[2];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw.replace(/\{\$[^}]*\}/g, "'__PARAM__'").replace(/\$[\w]+/g, "'__PARAM__'"),
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Double-quoted strings "..."
  const dqRegex = /"((?:[^"\\]|\\.)*)"/g;
  while ((match = dqRegex.exec(content)) !== null) {
    const raw = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\{\$[^}]*\}/g, "'__PARAM__'")
      .replace(/\$[\w]+/g, "'__PARAM__'");
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  // Single-quoted strings '...' (no interpolation in PHP)
  const sqRegex = /'((?:[^'\\]|\\.)*)'/g;
  while ((match = sqRegex.exec(content)) !== null) {
    const raw = match[1].replace(/\\'/g, "'");
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── ColdFusion: <cfquery> tags + queryExecute("...") ──

function extractFromColdFusion(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  let match: RegExpExecArray | null;

  // <cfquery ...>SQL HERE</cfquery>
  const cfqueryRegex = /<cfquery[^>]*>([\s\S]*?)<\/cfquery>/gi;
  while ((match = cfqueryRegex.exec(content)) !== null) {
    let raw = match[1].trim();
    // Strip CF tags like <cfqueryparam ...>
    raw = raw.replace(/<cfqueryparam[^>]*>/gi, "'__PARAM__'");
    raw = raw.replace(/<\/?cf\w+[^>]*>/gi, "");
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // queryExecute("...") or queryExecute('...')  (CFScript syntax)
  const qeRegex = /queryExecute\s*\(\s*["']([\s\S]*?)["']\s*[,)]/gi;
  while ((match = qeRegex.exec(content)) !== null) {
    const raw = match[1];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw.replace(/#[\w.]+#/g, "'__PARAM__'"),
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Also extract from regular string literals in CFScript blocks
  const stringRegex = /"((?:[^"\\]|\\.)*)"/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const raw = match[1].replace(/#[\w.]+#/g, "'__PARAM__'");
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── VB / VBScript / Classic ASP: "..." strings with "" escaping ──

function extractFromVbLike(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  let match: RegExpExecArray | null;

  // VB/VBScript strings: "..." with "" as escaped quote
  const stringRegex = /"((?:[^"]|"")*)"/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const raw = match[1].replace(/""/g, '"');
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  // VB string concatenation is common: "SELECT " & var & " FROM ..."
  // We catch individual pieces above; full reconstruction isn't feasible

  return results;
}

// ── Ruby: "...", '...', heredoc <<~SQL...SQL ──

function extractFromRuby(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  let match: RegExpExecArray | null;

  // Heredoc: <<~SQL ... SQL  or  <<-SQL ... SQL  or  <<SQL ... SQL
  const heredocRegex = /<<[~-]?['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n\s*\1/g;
  while ((match = heredocRegex.exec(content)) !== null) {
    const raw = match[2];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw.replace(/#\{[^}]*\}/g, "'__PARAM__'"),
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Double-quoted strings "..." (support interpolation)
  const dqRegex = /"((?:[^"\\]|\\.)*)"/g;
  while ((match = dqRegex.exec(content)) !== null) {
    const raw = match[1]
      .replace(/\\n/g, "\n")
      .replace(/#\{[^}]*\}/g, "'__PARAM__'");
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  // Single-quoted strings '...' (no interpolation)
  const sqRegex = /'((?:[^'\\]|\\.)*)'/g;
  while ((match = sqRegex.exec(content)) !== null) {
    const raw = match[1];
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── Go: `...` raw strings + "..." strings ──

function extractFromGo(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  let match: RegExpExecArray | null;

  // Backtick raw strings (multi-line, no escapes)
  const rawStringRegex = /`([\s\S]*?)`/g;
  while ((match = rawStringRegex.exec(content)) !== null) {
    const raw = match[1];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Regular strings "..."
  const stringRegex = /"((?:[^"\\]|\\.)*)"/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const raw = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"');
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

// ── Rust: "..." strings + r#"..."# raw strings ──

function extractFromRust(
  filePath: string,
  content: string,
  lines: string[]
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];
  let match: RegExpExecArray | null;

  // Raw strings: r"...", r#"..."#, r##"..."##, etc.
  const rawRegex = /r#*"([\s\S]*?)"#*/g;
  while ((match = rawRegex.exec(content)) !== null) {
    const raw = match[1];
    if (!containsQueryKeywords(raw)) continue;

    const startOffset = match.index;
    const lineStart = offsetToLine(content, startOffset);
    const lineEnd = offsetToLine(content, startOffset + match[0].length);

    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd,
      sourceLines: getSourceLines(lines, lineStart, lineEnd),
    });
  }

  // Regular strings "..."
  const stringRegex = /(?<!r#*)"((?:[^"\\]|\\.)*)"/g;
  while ((match = stringRegex.exec(content)) !== null) {
    const raw = match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"');
    if (!containsQueryKeywords(raw)) continue;
    if (raw.length < 15) continue;
    if (looksLikeCode(raw)) continue;

    const lineStart = offsetToLine(content, match.index);
    results.push({
      sql: raw,
      file: filePath,
      lineStart,
      lineEnd: lineStart,
      sourceLines: getSourceLines(lines, lineStart, lineStart),
    });
  }

  return results;
}

/** Heuristic: reject strings that look like programming code rather than SQL */
function looksLikeCode(text: string): boolean {
  // Contains common code patterns that are not SQL
  if (/\b(function|class|public|private|protected|void|var|const|let|return|import|require|namespace)\b/.test(text)) {
    return true;
  }
  // Contains braces (code blocks), semicolons followed by code
  if (/[{}]/.test(text)) return true;
  return false;
}

// ── Helpers ──

function offsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function getSourceLines(
  lines: string[],
  lineStart: number,
  lineEnd: number
): string[] {
  // Return lines with 2 lines of context on each side
  const contextBefore = 2;
  const contextAfter = 2;
  const start = Math.max(0, lineStart - 1 - contextBefore);
  const end = Math.min(lines.length, lineEnd + contextAfter);
  return lines.slice(start, end);
}
