#!/usr/bin/env node
/**
 * Test script for the .saignore feature.
 *
 * 1. Runs sql-validate on a known-bad file, counts errors
 * 2. Uses --ignore to suppress one specific error
 * 3. Re-runs and verifies: error count dropped by 1, ignored count is 1
 * 4. Verifies the .saignore file was created with correct format
 * 5. Cleans up
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const SCHEMA = path.join(__dirname, "..", "test-fixtures", "schema.sql");
const SRC_FILE = path.join(__dirname, "..", "test-fixtures", "src", "UserRepository.cs");
const SAIGNORE = path.join(ROOT, ".saignore");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function runTool(args) {
  try {
    return execSync(`node "${CLI}" ${args}`, {
      encoding: "utf-8",
      cwd: ROOT,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err) {
    // Exit code 1 = errors found (expected), return stdout
    return err.stdout || "";
  }
}

// ── Clean state ──
if (fs.existsSync(SAIGNORE)) fs.unlinkSync(SAIGNORE);

console.log("\n  .saignore Feature Tests\n");

// ── Test 1: Baseline — count errors before ignore ──
let baselineResult;
test("Baseline scan finds errors", () => {
  const raw = runTool(`--schema "${SCHEMA}" --src "${SRC_FILE}" --format json`);
  baselineResult = JSON.parse(raw);
  assert(baselineResult.totalErrors > 0, `Expected errors, got ${baselineResult.totalErrors}`);
  assert(baselineResult.totalIgnored === 0, `Expected 0 ignored, got ${baselineResult.totalIgnored}`);
});

const baselineCount = baselineResult ? baselineResult.totalErrors : 0;

// ── Test 2: --ignore creates .saignore ──
// Line 20 has: "                                 u.usr_email,"
test("--ignore creates .saignore file", () => {
  const output = runTool(`--ignore "${SRC_FILE}:20"`);
  assert(fs.existsSync(SAIGNORE), ".saignore file was not created");
  assert(output.includes("Added ignore entry"), `Expected confirmation, got: ${output.substring(0, 100)}`);
  assert(output.includes("441500bcf4cb"), `Expected hash in output, got: ${output.substring(0, 200)}`);
});

// ── Test 3: .saignore has correct format ──
test(".saignore has valid format (filepath:sha256)", () => {
  const content = fs.readFileSync(SAIGNORE, "utf-8").trim();
  const lines = content.split("\n").filter(l => l.trim());
  assert(lines.length === 1, `Expected 1 entry, got ${lines.length}`);
  const [filePart, hashPart] = [
    lines[0].substring(0, lines[0].lastIndexOf(":")),
    lines[0].substring(lines[0].lastIndexOf(":") + 1),
  ];
  assert(filePart.length > 0, "File path is empty");
  assert(/^[a-f0-9]{64}$/.test(hashPart), `Hash is not valid SHA-256: ${hashPart}`);
});

// ── Test 4: Duplicate --ignore doesn't add duplicate entry ──
test("Duplicate --ignore does not add duplicate entry", () => {
  runTool(`--ignore "${SRC_FILE}:20"`);
  const content = fs.readFileSync(SAIGNORE, "utf-8").trim();
  const lines = content.split("\n").filter(l => l.trim());
  assert(lines.length === 1, `Expected 1 entry after duplicate, got ${lines.length}`);
});

// ── Test 5: Scan with .saignore — error count reduced, ignored count increased ──
test("Scan with .saignore reduces active errors by 1", () => {
  const raw = runTool(`--schema "${SCHEMA}" --src "${SRC_FILE}" --format json`);
  const result = JSON.parse(raw);
  assert(
    result.totalErrors === baselineCount - 1,
    `Expected ${baselineCount - 1} active errors, got ${result.totalErrors}`
  );
  assert(result.totalIgnored === 1, `Expected 1 ignored, got ${result.totalIgnored}`);
});

// ── Test 6: Ignored entry appears in JSON output ──
test("Ignored error appears in JSON ignored array with hash", () => {
  const raw = runTool(`--schema "${SCHEMA}" --src "${SRC_FILE}" --format json`);
  const result = JSON.parse(raw);
  assert(result.ignored.length === 1, `Expected 1 ignored entry, got ${result.ignored.length}`);
  const ignored = result.ignored[0];
  assert(ignored.type === "INVALID_COLUMN", `Expected INVALID_COLUMN, got ${ignored.type}`);
  assert(ignored.lineStart === 20, `Expected line 20, got ${ignored.lineStart}`);
  assert(ignored.hash.length === 64, `Expected 64-char hash, got ${ignored.hash.length}`);
});

// ── Test 7: Text output shows [IGNORED] line ──
test("Text output shows [IGNORED] notice for suppressed error", () => {
  const raw = runTool(`--schema "${SCHEMA}" --src "${SRC_FILE}"`);
  assert(raw.includes("[IGNORED]"), "Expected [IGNORED] in text output");
  assert(raw.includes("usr_email"), "Expected 'usr_email' in ignored notice");
  assert(raw.includes("additional ignored"), "Expected 'additional ignored' in header");
});

// ── Test 8: Add a second ignore entry ──
test("Can add multiple ignore entries", () => {
  runTool(`--ignore "${SRC_FILE}:22"`); // UserStatus column
  const content = fs.readFileSync(SAIGNORE, "utf-8").trim();
  const lines = content.split("\n").filter(l => l.trim());
  assert(lines.length === 2, `Expected 2 entries, got ${lines.length}`);

  const raw = runTool(`--schema "${SCHEMA}" --src "${SRC_FILE}" --format json`);
  const result = JSON.parse(raw);
  assert(
    result.totalErrors === baselineCount - 2,
    `Expected ${baselineCount - 2} active errors, got ${result.totalErrors}`
  );
  assert(result.totalIgnored === 2, `Expected 2 ignored, got ${result.totalIgnored}`);
});

// ── Test 9: Exit code is 0 when all errors are ignored ──
// Ignore all remaining errors
test("Exit code 0 when all errors are ignored", () => {
  // Get remaining active errors and ignore them all
  const raw = runTool(`--schema "${SCHEMA}" --src "${SRC_FILE}" --format json`);
  const result = JSON.parse(raw);
  for (const err of result.errors) {
    runTool(`--ignore "${SRC_FILE}:${err.lineStart}"`);
  }

  // Now run again — should exit 0
  try {
    execSync(`node "${CLI}" --schema "${SCHEMA}" --src "${SRC_FILE}" --format json`, {
      encoding: "utf-8",
      cwd: ROOT,
    });
    // If we get here, exit code was 0
  } catch (err) {
    throw new Error(`Expected exit code 0, got non-zero`);
  }
});

// ── Cleanup ──
if (fs.existsSync(SAIGNORE)) fs.unlinkSync(SAIGNORE);

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
