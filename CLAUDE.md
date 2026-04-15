# SQL Verifier — Project Instructions

## What this is
`sql-validate` is a static analysis CLI that validates SQL queries embedded in source code against SQL Server 2022 schema files exported from SSMS. It catches invalid table names, column names, functions, stored procedures, and index hints before they reach runtime.

## Tool location
Installed globally via `npm link` from this directory. Run `sql-validate --help` for usage.

## SQL Validation Workflow

**After every change to a source file containing SQL queries (.cs, .ts, .js, .py, .sql), run sql-validate to check for schema errors before considering the task complete.**

### How to run
```bash
sql-validate --schema <path-to-schema-files...> --src <path-to-changed-files-or-directories...>
```

### Interpreting results
- **Exit code 0**: All SQL references are valid. Proceed.
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

### Example
```bash
# Validate all source files against the schema
sql-validate --schema db/schema/*.sql --src ./src --verbose

# Validate a single file after editing it
sql-validate --schema db/schema/*.sql --src ./src/repositories/UserRepository.cs

# JSON output for programmatic parsing
sql-validate --schema db/schema/*.sql --src ./src --format json
```

## For the test harness
```bash
# Regenerate random test corpus (200 files, ~225 injected errors)
node test-harness/generate.js

# Run accuracy verification
node test-harness/verify.js
```

## Automated Hook (Active in This Project)

A `PostToolUse` hook in `.claude/settings.json` automatically runs `sql-validate` after every Edit or Write to a `.cs`, `.ts`, `.js`, `.py`, or `.sql` file. If errors are found, the tool output appears inline and a system message instructs you to fix the SQL before proceeding.

The hook is non-blocking for non-SQL files (package.json, .md, etc.) — it checks the file extension and skips silently.

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
