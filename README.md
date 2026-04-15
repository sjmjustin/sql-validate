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

These errors compile fine, pass type checks, and look plausible in code review. They only blow up at runtime, often in production, often at 2 AM. If you're thinking, "yeah, but my QA team would catch errors like that before it ever made it to production.", how about you do your QA team (or your AI test swarm if you're into that sort of thing) a favor and use a tool like this that catches them before they waste valuable time filing bug reports about missing SQL columns and find the less obvious problems.

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
| `0`  | No validation errors found (ignored errors don't count) |
| `1`  | Validation errors found (details on stdout) |
| `2`  | Tool error (bad schema path, parse failure, etc.) |

## Ignoring False Positives

When the tool flags a query you know is correct (e.g., dynamic SQL, a table from a linked server, or a pattern the parser can't handle), you can suppress it:

```bash
# Ignore a specific line in a specific file
sql-validate --ignore src/repos/UserRepository.cs:187

# Store the ignore globally (applies across all projects)
sql-validate --ignore src/repos/UserRepository.cs:187 --global
```

This reads the line from the file, normalizes it (trim + lowercase), hashes it with SHA-256, and stores a `filepath:hash` entry in:
- **`.saignore`** — project-local file in your working directory (commit this to share with your team)
- **`~/.sql-validate/globalignore`** — user-global file (with `--global`)

On subsequent scans, any error whose source line matches a hash in the ignore list is suppressed. Instead of the full error block, you'll see a brief notice:

```
Ignored errors:
  [IGNORED] src/repos/UserRepository.cs:187 — INVALID_TABLE: Table "linked.Remote... (hash: 441500bcf4cb)
```

The hash is shown so you can find and remove it from `.saignore` if the line changes or you want to un-ignore it.

### `.saignore` File Format

```
# Lines starting with # are comments
# Format: absolute_filepath:sha256hash
C:\project\src\repos\UserRepo.cs:441500bcf4cb9d18e25a689ac67d94e581fdfc23a6a5fe64f9b99460a873e3a9
C:\project\src\data\queries.sql:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

The hash is resilient against common code churn — whitespace changes (tabs to spaces, indent level shifts) and line number changes (code added/removed above) won't break the match, since the line is trimmed and lowercased before hashing. The ignore only stops matching if the actual SQL content on the line changes, which is the intended behavior since the code should be re-validated.

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

| Language | Extensions | SQL Extraction Method |
|----------|-----------|----------------------|
| **C#** | .cs | `@"..."` verbatim strings, `"""..."""` raw strings, regular `"..."` strings |
| **VB.NET** | .vb | `"..."` strings with `""` escaping |
| **ASP.NET** | .aspx | C#-style embedded code blocks |
| **Classic ASP / VBScript** | .asp, .vbs | `"..."` strings with `""` escaping |
| **TypeScript / JavaScript** | .ts, .tsx, .js, .jsx | `` `...` `` template literals, regular strings |
| **Python** | .py | `"""..."""` / `'''...'''` triple-quoted strings, f-strings |
| **Java** | .java | `"..."` strings, `"""..."""` text blocks (Java 15+) |
| **Kotlin** | .kt | `"..."` strings, `"""..."""` raw strings |
| **Scala** | .scala | `"..."` strings, `"""..."""` multi-line strings |
| **BoxLang** | .bx | `"..."` strings, `"""..."""` text blocks |
| **PHP** | .php | `"..."`, `'...'`, heredoc `<<<SQL...SQL;` / nowdoc |
| **ColdFusion** | .cfm, .cfml, .cfc | `<cfquery>` tags, `queryExecute("...")` in CFScript |
| **Ruby** | .rb | `"..."`, `'...'`, heredoc `<<~SQL...SQL` |
| **Go** | .go | `` `...` `` raw strings, `"..."` strings |
| **Rust** | .rs | `r#"..."#` raw strings, `"..."` strings |
| **SQL** | .sql | Full file, split on `GO` batch separators |

## CLI Reference

```
sql-validate [options]

Scan mode:
  --schema <paths...>    One or more SQL Server schema files (SSMS CREATE scripts)
  --src <paths...>       Source directories or files to scan
  --exclude <globs...>   Glob patterns to skip
                         (default: node_modules, dist, bin, obj, .git)
  --format <type>        Output format: text | json  (default: text)
  --severity <level>     Minimum severity: error | warning  (default: error)
  --verbose              Show scan progress on stderr

Ignore mode:
  --ignore <file:line>   Add a line to the ignore list (e.g. --ignore src/repo.cs:187)
  --global               Store ignore entry in global file (~/.sql-validate/globalignore)
                         instead of project-local .saignore

General:
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
            "command": "f=$(node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.tool_input.file_path)})\" <&0); if echo \"$f\" | grep -qiE '\\.(cs|vb|aspx|ts|tsx|js|jsx|py|java|kt|scala|bx|php|cfm|cfml|cfc|asp|vbs|rb|go|rs|sql)$'; then result=$(sql-validate --schema /absolute/path/to/schema/*.sql --src \"$f\" 2>&1); rc=$?; if [ $rc -eq 1 ]; then echo \"$result\"; echo \"{\\\"systemMessage\\\":\\\"sql-validate found SQL schema errors. Review the Action: lines above and fix before proceeding.\\\"}\"; fi; fi",
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
│   ├── test-ignore.js      # .saignore feature tests
│   └── expected-errors.json
├── test-fixtures/           # Small hand-crafted test cases
├── dist/                    # Compiled output
├── CLAUDE.md                # Agent instructions
└── .claude/settings.json    # PostToolUse hook config
```

## File Encoding Support

SSMS exports files in different encodings depending on your Windows settings. The tool auto-detects encoding for all file reads:

| Encoding | Detection | Common Source |
|----------|-----------|---------------|
| **UTF-16 LE + BOM** | `FF FE` header bytes | Default SSMS "Generate Scripts" on Windows |
| **UTF-16 BE + BOM** | `FE FF` header bytes | Rare, but handled |
| **UTF-8 + BOM** | `EF BB BF` header bytes | Some Windows editors, Notepad |
| **UTF-16 without BOM** | Null-byte heuristic | Edge cases |
| **UTF-8 (default)** | Fallback | Most source code files |

You don't need to convert your schema files — just point the tool at them and it figures out the encoding.

Tested against real-world production schemas: **12 MB across two databases** (694 tables, 7,388 columns, 391 indexes, 21 routines) parsed in **109ms**.

## Known Limitations

- **SQL Server only.** This tool parses T-SQL and SSMS-style `CREATE` scripts. It will not work with PostgreSQL, MySQL, Oracle, or SQLite schemas. If you'd like to add other flavors of SQL into the tool with a `--flavor` argument and a full test harness, I would be honored to include it.
- **Static extraction only.** SQL constructed via string concatenation (`"SELECT " + cols + " FROM "`) will not be fully analyzed. The tool extracts complete string literals, not dynamically-assembled queries.
- **No semantic analysis.** It checks that *names* exist — not that your query is logically correct, performant, or returns the right data.
- **No type checking.** It won't catch `WHERE IntColumn = 'string'` type mismatches.
- **Views have limited column info.** Views without explicit column lists in the `CREATE VIEW` statement will not have their columns validated.
- **CTE and subquery aliases** are not fully resolved. Column validation works best on queries that directly reference schema tables.

### What the Schema Parser Skips (By Design)

If you look at your SSMS export and count `CREATE TABLE` statements, you might find more than what `sql-validate` reports. This is expected. The parser intentionally skips objects that aren't part of your actual database schema:

- **Temp tables** (`#AlertInfo`, `#BlitzResults`, etc.) — These are created at runtime inside stored procedures and don't exist in the schema catalog. They start with `#` and are scoped to a session.
- **Dynamically-constructed DDL** — Some stored procedures build `CREATE TABLE` or `CREATE VIEW` statements as strings (`'CREATE TABLE ' + @SchemaName + '...'`). These appear as `CREATE TABLE` in a text search but aren't real DDL — they're string literals inside procedure bodies.
- **Table variables** (`@TableVar TABLE (...)`) — Declared inside procedures, not schema objects.

If you're comparing the tool's table count against a raw `grep "CREATE TABLE"` on your schema file, subtract the temp tables and dynamic DDL to get the real number. In our testing with a production 852-`CREATE TABLE` schema file, 136 were temp tables and 32 were dynamic DDL string fragments — the parser correctly found all 682 real tables.

## Requirements

- **Node.js** 18+
- **npm** 8+
- SQL Server schema files exported from SSMS (or hand-written `CREATE TABLE/VIEW/FUNCTION/PROCEDURE/INDEX` scripts)

## Contributing

This is an experimental project. Issues and pull requests are welcome, but please keep expectations calibrated — SQL parsing is a deep rabbit hole and this tool takes a practical, regex-based approach rather than building a full T-SQL parser.

If you find a false positive or false negative pattern, the most helpful thing is a minimal reproduction: the schema SQL and the source file that triggers the wrong behavior.

## License

MIT License — see [LICENSE](LICENSE).
