# sql-validate

**Static analysis for SQL queries embedded in source code, validated against SQL Server schema files.**

Catches hallucinated table names, misspelled columns, phantom functions, and bad index hints *before* they make it to runtime — designed to run in AI coding agent pipelines where these errors are common and expensive.

---

> **WARNING: This project is beta / experimental.**
>
> `sql-validate` is a static analysis tool that **does not modify any files**. It is read-only — it scans your source code, compares SQL references against your schema, and reports what it finds. That's it.
>
> That said, here's what you should know:
>
> - **It may produce false positives.** Complex SQL with dynamic construction, deeply nested subqueries, or unusual T-SQL syntax can confuse the parser. Your AI coding agent may chase ghosts.
> - **It may miss real errors.** SQL buried inside string concatenation, conditional assembly, or ORM-generated patterns may not be extracted or validated. Don't treat a clean pass as proof of correctness.
> - **It does not validate SQL logic.** It checks that names exist in your schema — not that your JOINs make sense, your WHERE clauses are correct, or your query will actually return what you expect.
>
> **No guarantees. Use at your own risk.**

---

## What Problem Does This Solve?

AI coding agents (Claude, Copilot, Cursor, etc.) are remarkably good at writing SQL — until they aren't. Common failure modes:

- **Hallucinated table names** — `dbo.UserProfiles` when the table is actually `auth.Users`
- **Wrong column names** — `u.usr_email` instead of `u.Email`
- **Phantom functions** — `dbo.fn_GetUserEmail()` that doesn't exist in your database
- **Bad index hints** — `WITH (INDEX(IX_Users_EmailAddress))` referencing a nonexistent index

These errors compile fine, pass type checks, and look plausible in code review. They only blow up at runtime, often in production, often at 2 AM.

`sql-validate` catches them at write time by comparing every SQL reference against your actual database schema.

## How It Works

```
Source Files (.cs, .ts, .js, .py, .sql)
         |
         v
  [SQL Extractor] ──── extracts queries from string literals,
         |              template literals, verbatim strings,
         |              triple-quoted strings, .sql files
         v
  [Query Validator] ── resolves table aliases, checks every
         |              table, column, function, index reference
         |              against the schema catalog
         v
  [Schema Catalog] ─── built by parsing SSMS CREATE scripts
         |              (tables, views, columns, functions,
         |              procedures, indexes)
         v
   Error Report ────── file path, line number, context,
                        "Did you mean?" suggestions,
                        and Action: lines for AI agents
```

## Quick Start

### Install

```bash
git clone https://github.com/sjmjustin/sql-validate.git
cd sql-validate
npm install
npm run build
npm link        # installs 'sql-validate' globally
```

### Export Your Schema from SSMS

In SQL Server Management Studio:
1. Right-click your database → **Tasks** → **Generate Scripts...**
2. Select the objects you want (tables, views, functions, stored procedures)
3. In **Set Scripting Options**, choose **Save to file** → single or one file per object
4. Click **Finish**

This gives you `.sql` files with `CREATE TABLE`, `CREATE VIEW`, `CREATE FUNCTION`, etc. statements that `sql-validate` can parse.

### Run

```bash
# Validate all source files in ./src against your schema
sql-validate --schema db/schema/*.sql --src ./src

# Validate a single file
sql-validate --schema db/schema/*.sql --src ./src/repos/UserRepository.cs

# Verbose mode (shows scan progress)
sql-validate --schema db/schema/*.sql --src ./src --verbose

# JSON output for programmatic consumption
sql-validate --schema db/schema/*.sql --src ./src --format json
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | No validation errors found |
| `1`  | Validation errors found (details on stdout) |
| `2`  | Tool error (bad schema path, parse failure, etc.) |

## Example Output

```
[SQL_VALIDATION_ERROR] INVALID_COLUMN
  File: src/repos/UserRepository.cs
  Lines: 20
  Schema: db/schema/auth.sql
  Message: Column "usr_email" does not exist on table "auth.Users". Did you mean "Email"?
  Suggestion: Email

  Context:
      18 |         {
      19 |             var query = @"SELECT u.Id,
      20 |>                                  u.usr_email,
      21 |                                  u.FirstName,
      22 |                                  u.CreatedDate

  Action: Review the column reference at line 20 in "src/repos/UserRepository.cs"
          against the schema file at "db/schema/auth.sql" and verify whether the
          column name is valid. Consider using "Email" instead.
```

The `Action:` line is specifically written for AI agent consumption — it tells the agent exactly what to check, where to look, and what to try instead.

## What It Validates

| Check | Description |
|-------|-------------|
| **Tables & Views** | Every `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `DELETE FROM` target exists in the schema |
| **Columns** | Qualified refs (`u.Email`) and unqualified refs are checked against the table's column list |
| **Functions & Procedures** | Schema-qualified calls (`dbo.fn_GetTotal()`) and `EXEC` targets are verified |
| **Index Hints** | `WITH (INDEX(...))` names are checked against the target table's indexes |
| **Alias Resolution** | `FROM auth.Users u` registers `u` as an alias so `u.Email` validates against `auth.Users` |
| **"Did You Mean?"** | Levenshtein distance suggestions for close matches |

## Supported Source Languages

| Language | SQL Extraction Method |
|----------|----------------------|
| **C#** (.cs) | `@"..."` verbatim strings, `"""..."""` raw strings, regular `"..."` strings |
| **TypeScript/JavaScript** (.ts, .js, .tsx, .jsx) | `` `...` `` template literals, regular strings |
| **Python** (.py) | `"""..."""` / `'''...'''` triple-quoted strings, f-strings (interpolations replaced with placeholders) |
| **SQL** (.sql) | Full file, split on `GO` batch separators |

## CLI Reference

```
sql-validate [options]

Options:
  --schema <paths...>    One or more SQL Server schema files (SSMS CREATE scripts)
  --src <paths...>       Source directories or files to scan
  --exclude <globs...>   Glob patterns to skip
                         (default: node_modules, dist, bin, obj, .git)
  --format <type>        Output format: text | json  (default: text)
  --severity <level>     Minimum severity: error | warning  (default: error)
  --verbose              Show scan progress on stderr
  -V, --version          Output version number
  -h, --help             Display help
```

## AI Agent Integration

This tool was purpose-built for AI coding agent workflows. Two integration paths:

### 1. CLAUDE.md Instructions (Manual)

Add to your project's `CLAUDE.md`:

```markdown
## SQL Validation

After every change to a file containing SQL (.cs, .ts, .js, .py, .sql), run:

    sql-validate --schema db/schema/*.sql --src <changed-file>

If errors are found, read the Action: line in each error, fix the SQL, and
re-run until exit code 0.
```

### 2. PostToolUse Hook (Automatic)

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "f=$(node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.tool_input.file_path)})\" <&0); if echo \"$f\" | grep -qiE '\\.(cs|ts|js|py|sql)$'; then result=$(sql-validate --schema /absolute/path/to/schema/*.sql --src \"$f\" 2>&1); rc=$?; if [ $rc -eq 1 ]; then echo \"$result\"; echo \"{\\\"systemMessage\\\":\\\"sql-validate found SQL schema errors. Review the Action: lines above and fix before proceeding.\\\"}\"; fi; fi",
            "timeout": 30,
            "statusMessage": "Validating SQL references..."
          }
        ]
      }
    ]
  }
}
```

**Important:** Replace `/absolute/path/to/schema/*.sql` with the actual path to your SSMS schema exports.

This hook:
- Fires after every file edit
- Skips non-SQL file types silently
- Shows validation errors inline when found
- Sends a system message to the agent instructing it to fix the errors

## JSON Output Format

With `--format json`, the output is machine-parseable:

```json
{
  "totalErrors": 2,
  "errors": [
    {
      "type": "INVALID_COLUMN",
      "severity": "error",
      "file": "src/repos/UserRepository.cs",
      "lineStart": 20,
      "lineEnd": 20,
      "schemaFile": "db/schema/auth.sql",
      "message": "Column \"usr_email\" does not exist on table \"auth.Users\". Did you mean \"Email\"?",
      "suggestion": "Email",
      "context": [
        { "line": 19, "text": "            var query = @\"SELECT u.Id,", "isError": false },
        { "line": 20, "text": "                                 u.usr_email,", "isError": true },
        { "line": 21, "text": "                                 u.FirstName,", "isError": false }
      ]
    }
  ]
}
```

## Test Harness

The repo includes a test harness that generates 200 source files with ~225 intentional errors across 5 schema domains, then verifies the tool's accuracy:

```bash
# Generate test corpus (randomized each run)
node test-harness/generate.js

# Run accuracy verification
node test-harness/verify.js
```

**Benchmark results:**
- 200 files scanned (80 C#, 70 TypeScript, 30 Python, 20 SQL)
- ~650 SQL queries extracted
- **100% recall** — every injected error detected
- **87% precision** — remaining "false positives" were real errors the manifest didn't track

## Project Structure

```
sql-validate/
├── src/
│   ├── cli.ts              # CLI entry point (commander)
│   ├── schema-parser.ts    # Parses SSMS CREATE scripts → schema catalog
│   ├── sql-extractor.ts    # Extracts SQL from .cs, .ts, .py, .sql files
│   ├── validator.ts        # Validates queries against the catalog
│   ├── formatter.ts        # Text and JSON output formatters
│   └── types.ts            # TypeScript type definitions
├── test-harness/
│   ├── schema/             # 5 realistic SSMS schema files
│   ├── src/                # Generated test corpus (200 files)
│   ├── generate.js         # Test corpus generator
│   ├── verify.js           # Accuracy verification script
│   └── expected-errors.json
├── test-fixtures/           # Small hand-crafted test cases
├── dist/                    # Compiled output
├── CLAUDE.md                # Agent instructions
└── .claude/settings.json    # PostToolUse hook config
```

## Known Limitations

- **SQL Server only.** This tool parses T-SQL and SSMS-style `CREATE` scripts. It will not work with PostgreSQL, MySQL, Oracle, or SQLite schemas.
- **Static extraction only.** SQL constructed via string concatenation (`"SELECT " + cols + " FROM "`) will not be fully analyzed. The tool extracts complete string literals, not dynamically-assembled queries.
- **No semantic analysis.** It checks that *names* exist — not that your query is logically correct, performant, or returns the right data.
- **No type checking.** It won't catch `WHERE IntColumn = 'string'` type mismatches.
- **Views have limited column info.** Views without explicit column lists in the `CREATE VIEW` statement will not have their columns validated.
- **CTE and subquery aliases** are not fully resolved. Column validation works best on queries that directly reference schema tables.

## Requirements

- **Node.js** 18+
- **npm** 8+
- SQL Server schema files exported from SSMS (or hand-written `CREATE TABLE/VIEW/FUNCTION/PROCEDURE/INDEX` scripts)

## Contributing

This is an experimental project. Issues and pull requests are welcome, but please keep expectations calibrated — SQL parsing is a deep rabbit hole and this tool takes a practical, regex-based approach rather than building a full T-SQL parser.

If you find a false positive or false negative pattern, the most helpful thing is a minimal reproduction: the schema SQL and the source file that triggers the wrong behavior.

## License

MIT License — see [LICENSE](LICENSE).
