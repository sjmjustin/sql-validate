#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { glob } from "glob";
import { minimatch } from "minimatch";
import { parseSchemaFiles } from "./schema-parser";
import { extractQueries } from "./sql-extractor";
import { validateQueries } from "./validator";
import { formatText, formatJson, filterBySeverity } from "./formatter";
import { CliOptions, Severity, ExtractedQuery } from "./types";
import {
  addIgnoreEntry,
  loadAllIgnoreEntries,
  isIgnored,
  hashLine,
  readLineFromFile,
} from "./ignore-manager";

const program = new Command();

program
  .name("sql-validate")
  .description(
    "Static analysis tool that validates SQL queries in source code against SQL Server schema files."
  )
  .version("0.0.4")
  .option(
    "--schema <paths...>",
    "One or more SQL Server schema files (SSMS CREATE scripts)"
  )
  .option("--src <paths...>", "Source directories or files to scan")
  .option(
    "--exclude <globs...>",
    "Glob patterns to exclude",
    ["**/node_modules/**", "**/dist/**", "**/bin/**", "**/obj/**", "**/.git/**"]
  )
  .option("--format <type>", "Output format: text or json", "text")
  .option(
    "--severity <level>",
    "Minimum severity to report: error or warning",
    "error"
  )
  .option("--verbose", "Show verbose output including scan progress", false)
  .option(
    "--ignore <file:line>",
    "Add a specific file:line to the ignore list (e.g. --ignore src/repo.cs:187)"
  )
  .option(
    "--global",
    "When used with --ignore, store in global ignore file instead of project .saignore",
    false
  )
  .action(async (opts) => {
    try {
      const options = opts as CliOptions;

      // ── Ignore mode: add entry and exit ──
      if (options.ignore) {
        await runIgnore(options.ignore, options.global || false);
        return;
      }

      // ── Scan mode: require --schema and --src ──
      if (!options.schema || options.schema.length === 0) {
        console.error("Error: --schema is required for scanning. Use --help for usage.");
        process.exit(2);
      }
      if (!options.src || options.src.length === 0) {
        console.error("Error: --src is required for scanning. Use --help for usage.");
        process.exit(2);
      }

      await run(options);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(2);
    }
  });

// Constants must be defined before program.parse() triggers the action
const SCANNABLE_EXTENSIONS = new Set([
  ".sql",
  // .NET
  ".cs", ".vb", ".aspx",
  // JavaScript / TypeScript
  ".ts", ".tsx", ".js", ".jsx",
  // Python
  ".py",
  // Java / JVM
  ".java", ".kt", ".scala", ".bx",
  // PHP
  ".php",
  // ColdFusion
  ".cfm", ".cfml", ".cfc",
  // Classic ASP / VBScript
  ".asp", ".vbs",
  // Ruby
  ".rb",
  // Go
  ".go",
  // Rust
  ".rs",
]);

program.parse();

// ── Ignore mode ──

async function runIgnore(fileLineArg: string, global: boolean): Promise<void> {
  // Parse file:line argument — last colon separates path from line number
  const lastColon = fileLineArg.lastIndexOf(":");
  if (lastColon === -1 || lastColon === fileLineArg.length - 1) {
    console.error(
      'Error: --ignore requires format "file:line" (e.g. --ignore src/repo.cs:187)'
    );
    process.exit(2);
  }

  const filePath = fileLineArg.substring(0, lastColon);
  const lineStr = fileLineArg.substring(lastColon + 1);
  const lineNumber = parseInt(lineStr, 10);

  if (isNaN(lineNumber) || lineNumber < 1) {
    console.error(`Error: Invalid line number "${lineStr}". Must be a positive integer.`);
    process.exit(2);
  }

  const { entry, ignoreFile, line } = addIgnoreEntry(filePath, lineNumber, global);

  console.log(`Added ignore entry:`);
  console.log(`  File:   ${entry.filePath}`);
  console.log(`  Line ${lineNumber}: ${line.trim()}`);
  console.log(`  Hash:   ${entry.hash}`);
  console.log(`  Saved to: ${ignoreFile}`);
  process.exit(0);
}

// ── Scan mode ──

async function run(opts: CliOptions): Promise<void> {
  // ── Resolve and validate schema files ──
  const schemaFiles = resolveFilePaths(opts.schema, "Schema");
  if (schemaFiles.length === 0) {
    console.error("Error: No schema files found.");
    process.exit(2);
  }

  if (opts.verbose) {
    console.error(`Parsing ${schemaFiles.length} schema file(s)...`);
  }

  const catalog = parseSchemaFiles(schemaFiles);

  if (opts.verbose) {
    console.error(
      `  Schema catalog: ${catalog.tables.size} tables/views, ` +
        `${catalog.routines.size} functions/procedures, ` +
        `${catalog.types.size} types`
    );
  }

  // ── Resolve source files ──
  const sourceFiles = await resolveSourceFiles(opts.src, opts.exclude);
  if (sourceFiles.length === 0) {
    console.error("Error: No source files found to scan.");
    process.exit(2);
  }

  if (opts.verbose) {
    console.error(`Scanning ${sourceFiles.length} source file(s)...`);
  }

  // ── Extract SQL queries from source files ──
  const allQueries: ExtractedQuery[] = [];
  for (const file of sourceFiles) {
    try {
      const queries = extractQueries(file);
      allQueries.push(...queries);
    } catch (err: any) {
      if (opts.verbose) {
        console.error(`  Warning: Failed to parse ${file}: ${err.message}`);
      }
    }
  }

  if (opts.verbose) {
    console.error(`  Extracted ${allQueries.length} SQL query/queries.`);
  }

  if (allQueries.length === 0) {
    if (opts.format === "json") {
      console.log(JSON.stringify({ totalErrors: 0, errors: [] }, null, 2));
    } else {
      console.log("No SQL queries found in source files.");
    }
    process.exit(0);
  }

  // ── Validate queries against schema ──
  let errors = validateQueries(allQueries, catalog);

  // Filter by severity
  errors = filterBySeverity(errors, opts.severity as Severity);

  // ── Check ignore list ──
  const ignoreEntries = loadAllIgnoreEntries();
  const activeErrors = [];
  const ignoredErrors = [];

  for (const error of errors) {
    // Read the actual source line at the error location to hash it
    let lineContent = "";
    try {
      lineContent = readLineFromFile(error.file, error.lineStart);
    } catch {
      // If we can't read the line, don't ignore it
    }

    const match = lineContent
      ? isIgnored(error.file, lineContent, ignoreEntries)
      : null;

    if (match) {
      ignoredErrors.push({ error, hash: match.hash });
    } else {
      activeErrors.push(error);
    }
  }

  // ── Output results ──
  if (opts.format === "json") {
    console.log(formatJson(activeErrors, ignoredErrors));
  } else {
    console.log(formatText(activeErrors, ignoredErrors));
  }

  // Exit code: 0 = clean, 1 = errors found (ignored errors don't count)
  process.exit(activeErrors.length > 0 ? 1 : 0);
}

// ── File resolution helpers ──

function resolveFilePaths(paths: string[], label: string): string[] {
  const resolved: string[] = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      if (stat.isFile()) {
        resolved.push(abs);
      } else if (stat.isDirectory()) {
        // Find all .sql files in the directory
        const files = fs.readdirSync(abs, { recursive: true }) as string[];
        for (const f of files) {
          if (f.endsWith(".sql")) {
            resolved.push(path.join(abs, f));
          }
        }
      }
    } else {
      console.error(`Warning: ${label} path not found: ${p}`);
    }
  }
  return resolved;
}

async function resolveSourceFiles(
  paths: string[],
  excludePatterns: string[]
): Promise<string[]> {
  const resolved: string[] = [];

  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      console.error(`Warning: Source path not found: ${p}`);
      continue;
    }

    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (SCANNABLE_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
        resolved.push(abs);
      }
    } else if (stat.isDirectory()) {
      // Use glob to find all scannable files
      const extensions = Array.from(SCANNABLE_EXTENSIONS).map((e) =>
        e.replace(".", "")
      );
      const pattern = `**/*.{${extensions.join(",")}}`;
      const files = await glob(pattern, {
        cwd: abs,
        absolute: true,
        nodir: true,
      });

      for (const file of files) {
        const relativePath = path.relative(abs, file);
        const excluded = excludePatterns.some((pat) =>
          minimatch(relativePath, pat, { dot: true })
        );
        if (!excluded) {
          resolved.push(file);
        }
      }
    }
  }

  return [...new Set(resolved)]; // deduplicate
}
