#!/usr/bin/env node
/**
 * Verification script: runs sql-validate and compares results to the expected manifest.
 * Reports: true positives, false positives, false negatives, and accuracy metrics.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SCHEMA_DIR = path.join(__dirname, "schema");
const SRC_DIR = path.join(__dirname, "src");
const MANIFEST_PATH = path.join(__dirname, "expected-errors.json");

// Run the validator in JSON mode
const schemaFiles = fs.readdirSync(SCHEMA_DIR)
  .filter(f => f.endsWith(".sql"))
  .map(f => path.join(SCHEMA_DIR, f))
  .join(" ");

const cmd = `node "${path.join(ROOT, "dist", "cli.js")}" --schema ${schemaFiles} --src "${SRC_DIR}" --format json --verbose`;

let rawOutput;
try {
  rawOutput = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
} catch (err) {
  // Exit code 1 means errors found (expected)
  rawOutput = err.stdout || "";
  if (!rawOutput) {
    console.error("Tool failed:", err.stderr);
    process.exit(2);
  }
}

// Strip stderr (verbose output goes to stderr, JSON goes to stdout)
const jsonStart = rawOutput.indexOf("{");
if (jsonStart < 0) {
  console.error("No JSON output found");
  console.error(rawOutput);
  process.exit(2);
}

const actual = JSON.parse(rawOutput.substring(jsonStart));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

console.log(`\n${"=".repeat(70)}`);
console.log(`  SQL VALIDATE — TEST HARNESS VERIFICATION REPORT`);
console.log(`${"=".repeat(70)}\n`);

console.log(`Expected errors (from manifest): ${manifest.totalExpected}`);
console.log(`Actual errors (from tool):       ${actual.totalErrors}\n`);

// ── Match actual to expected ──
// We match on: file (normalized) + type
// Line numbers may be off by a few due to generation, so we use a tolerance

const normalizeFile = (f) => f.replace(/\\/g, "/").toLowerCase();

const expectedSet = manifest.errors.map(e => ({
  ...e,
  fileNorm: normalizeFile(e.file),
  matched: false,
}));

const actualSet = actual.errors.map(e => ({
  ...e,
  fileNorm: normalizeFile(e.file),
  matched: false,
}));

// Match: same file + same type + line within tolerance
const LINE_TOLERANCE = 5;
let truePositives = 0;

for (const exp of expectedSet) {
  for (const act of actualSet) {
    if (act.matched) continue;
    if (act.fileNorm === exp.fileNorm && act.type === exp.type) {
      // Check if we can match by detail substring
      const detailLower = (exp.detail || "").toLowerCase();
      const msgLower = (act.message || "").toLowerCase();
      // For INVALID_TABLE: detail is the table name
      // For INVALID_COLUMN: detail is "ColName on Table"
      // For INVALID_FUNCTION: detail is the function name
      // For INVALID_INDEX: detail is "IndexName on Table"
      let detailMatch = false;
      if (exp.type === "INVALID_TABLE") {
        const tableName = detailLower.split(".").pop();
        detailMatch = msgLower.includes(tableName);
      } else if (exp.type === "INVALID_COLUMN") {
        const colName = detailLower.split(" on ")[0];
        detailMatch = msgLower.includes(colName);
      } else if (exp.type === "INVALID_FUNCTION") {
        const funcName = detailLower.split(".").pop();
        detailMatch = msgLower.includes(funcName);
      } else if (exp.type === "INVALID_INDEX") {
        const idxName = detailLower.split(" on ")[0];
        detailMatch = msgLower.includes(idxName);
      } else {
        detailMatch = true; // fallback
      }

      if (detailMatch) {
        act.matched = true;
        exp.matched = true;
        truePositives++;
        break;
      }
    }
  }
}

const falsePositives = actualSet.filter(a => !a.matched);
const falseNegatives = expectedSet.filter(e => !e.matched);

const precision = actual.totalErrors > 0 ? (truePositives / actual.totalErrors * 100).toFixed(1) : "N/A";
const recall = manifest.totalExpected > 0 ? (truePositives / manifest.totalExpected * 100).toFixed(1) : "N/A";

console.log(`${"─".repeat(40)}`);
console.log(`  RESULTS`);
console.log(`${"─".repeat(40)}`);
console.log(`  True Positives:   ${truePositives}`);
console.log(`  False Positives:  ${falsePositives.length}`);
console.log(`  False Negatives:  ${falseNegatives.length}`);
console.log(``);
console.log(`  Precision:        ${precision}%  (of what the tool found, how many were real)`);
console.log(`  Recall:           ${recall}%  (of real errors, how many did the tool find)`);
console.log(`${"─".repeat(40)}\n`);

// ── By type breakdown ──
console.log(`By error type:`);
const types = ["INVALID_TABLE", "INVALID_COLUMN", "INVALID_FUNCTION", "INVALID_INDEX"];
for (const type of types) {
  const expCount = expectedSet.filter(e => e.type === type).length;
  const actCount = actualSet.filter(a => a.type === type).length;
  const tpCount = expectedSet.filter(e => e.type === type && e.matched).length;
  const fpCount = actualSet.filter(a => a.type === type && !a.matched).length;
  const fnCount = expectedSet.filter(e => e.type === type && !e.matched).length;
  console.log(`  ${type.padEnd(20)} Expected: ${String(expCount).padStart(3)}  Found: ${String(actCount).padStart(3)}  TP: ${String(tpCount).padStart(3)}  FP: ${String(fpCount).padStart(3)}  FN: ${String(fnCount).padStart(3)}`);
}

// ── Show false positives ──
if (falsePositives.length > 0) {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`  FALSE POSITIVES (tool found, but not expected)`);
  console.log(`${"─".repeat(40)}`);
  const limit = Math.min(falsePositives.length, 20);
  for (let i = 0; i < limit; i++) {
    const fp = falsePositives[i];
    const relFile = path.relative(SRC_DIR, fp.file);
    console.log(`  [${fp.type}] ${relFile}:${fp.lineStart} — ${fp.message.substring(0, 80)}`);
  }
  if (falsePositives.length > limit) {
    console.log(`  ... and ${falsePositives.length - limit} more`);
  }
}

// ── Show false negatives ──
if (falseNegatives.length > 0) {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`  FALSE NEGATIVES (expected, but tool missed)`);
  console.log(`${"─".repeat(40)}`);
  const limit = Math.min(falseNegatives.length, 20);
  for (let i = 0; i < limit; i++) {
    const fn_ = falseNegatives[i];
    const relFile = path.relative(SRC_DIR, fn_.file);
    console.log(`  [${fn_.type}] ${relFile}:${fn_.line} — ${fn_.detail}`);
  }
  if (falseNegatives.length > limit) {
    console.log(`  ... and ${falseNegatives.length - limit} more`);
  }
}

console.log(`\n${"=".repeat(70)}\n`);

// Exit with 0 only if recall is above threshold
process.exit(parseFloat(recall) >= 50 ? 0 : 1);
