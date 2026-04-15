# SQL Verifier — Project Instructions

## What this is
`sql-validate` is a static analysis CLI that validates SQL queries embedded in source code against SQL Server 2022 schema files exported from SSMS. It catches invalid table names, column names, functions, stored procedures, and index hints before they reach runtime.

## Tool location
Installed globally via `npm link` from this directory. Run `sql-validate --help` for usage.

## Supported file types
`.cs`, `.vb`, `.aspx`, `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.java`, `.kt`, `.scala`, `.bx`, `.php`, `.cfm`, `.cfml`, `.cfc`, `.asp`, `.vbs`, `.rb`, `.go`, `.rs`, `.sql`

## SQL Validation Workflow

**After every change to a source file containing SQL queries, run sql-validate to check for schema errors before considering the task complete.**

### How to run
```bash
sql-validate --schema <schema-files...> --src <source-files-or-dirs...> [options]
```

### Options
| Flag | Description |
|------|-------------|
| `--schema <paths...>` | One or more SSMS schema SQL files (required for scanning) |
| `--src <paths...>` | Source files or directories to scan (required for scanning) |
| `--exclude <globs...>` | Glob patterns to skip (default: `node_modules`, `dist`, `bin`, `obj`, `.git`) |
| `--format text\|json` | Output format (default: `text`) |
| `--severity error\|warning` | Minimum severity to report (default: `error`) |
| `--verbose` | Show scan progress on stderr |
| `--ignore <file:line>` | Add a line to the `.saignore` ignore list |
| `--global` | Store ignore entry globally instead of in project `.saignore` |

### Excluding files and directories
Use `--exclude` to skip paths that would generate noise. The default excludes are `**/node_modules/**`, `**/dist/**`, `**/bin/**`, `**/obj/**`, and `**/.git/**`.

**Important:** Do not scan your schema files as source code. If your schema `.sql` files are inside the `--src` directory, exclude them:
```bash
sql-validate --schema db/schema/*.sql --src . --exclude "**/*-schema.sql" "**/node_modules/**"
```

Additional exclude examples:
```bash
# Exclude test directories and migration scripts
--exclude "**/node_modules/**" "**/test/**" "**/migrations/**"

# Exclude vendor/third-party code
--exclude "**/node_modules/**" "**/vendor/**" "**/packages/**"

# Exclude specific files by name
--exclude "**/node_modules/**" "**/legacy_queries.sql"
```

Note: when you provide `--exclude`, it replaces the defaults. Always include `**/node_modules/**` (or other defaults you need) alongside your custom patterns.

### Interpreting results
- **Exit code 0**: All SQL references are valid (ignored errors don't count). Proceed.
- **Exit code 1**: Validation errors found. Each error includes:
  - The error type (INVALID_TABLE, INVALID_COLUMN, INVALID_FUNCTION, INVALID_INDEX)
  - The file path and line number
  - The schema file to check against
  - A suggestion for the correct name (when available)
  - An `Action:` line with specific instructions to fix the issue
- **Exit code 2**: Tool error (bad schema path, etc.)

### When errors are found
1. Read the `Action:` line in each error block
2. Open the referenced schema file to verify the correct object name
3. Fix the SQL in the source file
4. Re-run sql-validate to confirm the fix
5. Repeat until exit code 0

### Suppressing false positives
If the tool flags a query you know is correct (dynamic SQL, linked server reference, etc.):
```bash
sql-validate --ignore path/to/file.cs:187
```
This hashes the line content and stores it in `.saignore`. The error will be suppressed on future runs unless the actual SQL content on that line changes.

### Example commands
```bash
# Validate all source files against the schema
sql-validate --schema db/schema/*.sql --src ./src --verbose

# Validate a single file after editing it
sql-validate --schema db/schema/*.sql --src ./src/repositories/UserRepository.cs

# Exclude schema files and test data from source scanning
sql-validate --schema db/schema/*.sql --src . --exclude "**/*-schema.sql" "**/seed-data/**" "**/node_modules/**"

# JSON output for programmatic parsing
sql-validate --schema db/schema/*.sql --src ./src --format json
```

## For the test harness
```bash
# Regenerate random test corpus (200 files, ~225 injected errors)
node test-harness/generate.js

# Run accuracy verification
node test-harness/verify.js

# Run .saignore feature tests
node test-harness/test-ignore.js
```

## Automated Hook (Active in This Project)

A `PostToolUse` hook in `.claude/settings.json` automatically runs `sql-validate` after every Edit or Write to a supported source file. If errors are found, the tool output appears inline and a system message instructs you to fix the SQL before proceeding.

The hook is non-blocking for non-source files (package.json, .md, .json, etc.) — it checks the file extension and skips silently.

### Adapting for Other Projects

Copy `.claude/settings.json` into another project and change the `--schema` path to point to that project's schema files:

```
sql-validate --schema /path/to/your/project/db/schema/*.sql --src "$f"
```

## Building
```bash
npm run build    # compile TypeScript
npm link         # install globally
```
