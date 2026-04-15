import chalk from "chalk";
import { ValidationError, Severity } from "./types";

interface IgnoredError {
  error: ValidationError;
  hash: string;
}

/**
 * Format validation errors as human- and AI-readable text output.
 */
export function formatText(
  errors: ValidationError[],
  ignoredErrors: IgnoredError[] = []
): string {
  const lines: string[] = [];

  if (errors.length === 0 && ignoredErrors.length === 0) {
    return chalk.green("✓ No SQL validation errors found.\n");
  }

  if (errors.length === 0 && ignoredErrors.length > 0) {
    lines.push(
      chalk.green("✓ No active SQL validation errors found.") +
        chalk.dim(` (${ignoredErrors.length} ignored)\n`)
    );
  }

  if (errors.length > 0) {
    lines.push(
      chalk.red.bold(`Found ${errors.length} SQL validation error(s):`) +
        (ignoredErrors.length > 0
          ? chalk.dim(` (${ignoredErrors.length} additional ignored)`)
          : "") +
        "\n"
    );

    for (const error of errors) {
      lines.push(formatSingleError(error));
    }
  }

  // Show ignored errors as brief notices
  if (ignoredErrors.length > 0) {
    lines.push(chalk.dim("─".repeat(40)));
    lines.push(chalk.dim("Ignored errors:\n"));
    for (const { error, hash } of ignoredErrors) {
      const shortHash = hash.substring(0, 12);
      lines.push(
        chalk.dim(
          `  [IGNORED] ${error.file}:${error.lineStart} — ` +
            `${error.type}: ${error.message.substring(0, 60)}... ` +
            `(hash: ${shortHash})`
        )
      );
    }
    lines.push("");
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}

function formatSingleError(error: ValidationError): string {
  const lines: string[] = [];
  const typeColor = error.severity === "error" ? chalk.red : chalk.yellow;
  const tag = typeColor.bold(`[SQL_VALIDATION_ERROR] ${error.type}`);

  lines.push(tag);
  lines.push(`  File: ${chalk.cyan(error.file)}`);
  lines.push(
    `  Lines: ${chalk.yellow(
      error.lineStart === error.lineEnd
        ? String(error.lineStart)
        : `${error.lineStart}-${error.lineEnd}`
    )}`
  );
  lines.push(`  Schema: ${chalk.cyan(error.schemaFile)}`);
  lines.push(`  Message: ${error.message}`);
  if (error.suggestion) {
    lines.push(`  Suggestion: ${chalk.green(error.suggestion)}`);
  }

  // Context lines
  if (error.contextLines.length > 0) {
    lines.push("");
    lines.push("  Context:");
    for (const ctx of error.contextLines) {
      const lineNum = String(ctx.lineNumber).padStart(6);
      const marker = ctx.isError ? ">" : " ";
      const lineText = ctx.text;

      if (ctx.isError) {
        lines.push(chalk.red.bold(`  ${lineNum} |${marker} ${lineText}`));
      } else {
        lines.push(chalk.dim(`  ${lineNum} | ${lineText}`));
      }
    }
  }

  // Action line for AI agent consumption
  lines.push("");
  lines.push(
    chalk.white(
      `  Action: Review the ${errorTypeToNoun(error.type)} reference at ` +
        `line ${error.lineStart} in "${error.file}" against the schema file ` +
        `at "${error.schemaFile}" and verify whether the ` +
        `${errorTypeToTarget(error.type)} is valid. ${
          error.suggestion
            ? `Consider using "${error.suggestion}" instead.`
            : "Check the schema file for the correct name."
        }`
    )
  );
  lines.push("");

  return lines.join("\n");
}

function errorTypeToNoun(type: string): string {
  switch (type) {
    case "INVALID_TABLE":
      return "table";
    case "INVALID_COLUMN":
      return "column";
    case "INVALID_FUNCTION":
      return "function/procedure";
    case "INVALID_INDEX":
      return "index";
    case "SYNTAX_ERROR":
      return "SQL syntax";
    case "AMBIGUOUS_COLUMN":
      return "column";
    default:
      return "SQL";
  }
}

function errorTypeToTarget(type: string): string {
  switch (type) {
    case "INVALID_TABLE":
      return "table name";
    case "INVALID_COLUMN":
      return "column name";
    case "INVALID_FUNCTION":
      return "function or procedure name";
    case "INVALID_INDEX":
      return "index name";
    case "SYNTAX_ERROR":
      return "SQL syntax";
    case "AMBIGUOUS_COLUMN":
      return "column reference";
    default:
      return "SQL reference";
  }
}

/**
 * Format validation errors as JSON for programmatic consumption.
 */
export function formatJson(
  errors: ValidationError[],
  ignoredErrors: IgnoredError[] = []
): string {
  const output = {
    totalErrors: errors.length,
    totalIgnored: ignoredErrors.length,
    errors: errors.map((e) => ({
      type: e.type,
      severity: e.severity,
      file: e.file,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      schemaFile: e.schemaFile,
      message: e.message,
      suggestion: e.suggestion || null,
      context: e.contextLines.map((c) => ({
        line: c.lineNumber,
        text: c.text,
        isError: c.isError,
      })),
    })),
    ignored: ignoredErrors.map(({ error: e, hash }) => ({
      type: e.type,
      file: e.file,
      lineStart: e.lineStart,
      message: e.message,
      hash,
    })),
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Filter errors by severity threshold.
 */
export function filterBySeverity(
  errors: ValidationError[],
  minSeverity: Severity
): ValidationError[] {
  if (minSeverity === "warning") return errors;
  return errors.filter((e) => e.severity === "error");
}
