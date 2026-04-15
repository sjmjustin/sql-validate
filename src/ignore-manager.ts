import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { readFileAutoEncoding } from "./file-reader";

const LOCAL_IGNORE_FILE = ".saignore";
const GLOBAL_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".sql-validate"
);
const GLOBAL_IGNORE_FILE = path.join(GLOBAL_DIR, "globalignore");

export interface IgnoreEntry {
  filePath: string;
  hash: string;
}

/**
 * Process a source line into a normalized SHA-256 hash.
 * Strips leading/trailing whitespace, lowercases, then hashes.
 */
export function hashLine(line: string): string {
  const normalized = line.trim().toLowerCase();
  return crypto.createHash("sha256").update(normalized, "utf-8").digest("hex");
}

/**
 * Read a line from a file at a specific line number (1-indexed).
 */
export function readLineFromFile(filePath: string, lineNumber: number): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const content = readFileAutoEncoding(resolved);
  const lines = content.split(/\r?\n/);
  if (lineNumber < 1 || lineNumber > lines.length) {
    throw new Error(
      `Line ${lineNumber} is out of range for ${resolved} (file has ${lines.length} lines)`
    );
  }
  return lines[lineNumber - 1];
}

/**
 * Add an ignore entry to the local .saignore or global ignore file.
 */
export function addIgnoreEntry(
  filePath: string,
  lineNumber: number,
  global: boolean
): { entry: IgnoreEntry; ignoreFile: string; line: string } {
  const resolvedFile = path.resolve(filePath);
  const line = readLineFromFile(resolvedFile, lineNumber);
  const hash = hashLine(line);

  const entry: IgnoreEntry = { filePath: resolvedFile, hash };
  const ignoreFile = global ? GLOBAL_IGNORE_FILE : LOCAL_IGNORE_FILE;

  // Ensure directory exists for global file
  if (global && !fs.existsSync(GLOBAL_DIR)) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  }

  // Read existing entries to avoid duplicates
  const existing = loadIgnoreFile(ignoreFile);
  const alreadyExists = existing.some(
    (e) => e.filePath === resolvedFile && e.hash === hash
  );

  if (!alreadyExists) {
    const entryLine = `${resolvedFile}:${hash}`;
    const content = fs.existsSync(ignoreFile)
      ? fs.readFileSync(ignoreFile, "utf-8")
      : "";
    const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(ignoreFile, `${separator}${entryLine}\n`);
  }

  return { entry, ignoreFile, line };
}

/**
 * Load all ignore entries from a file.
 */
export function loadIgnoreFile(filePath: string): IgnoreEntry[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const entries: IgnoreEntry[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Format: filepath:sha256hash (hash is always 64 hex chars)
    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon === -1) continue;

    const fp = trimmed.substring(0, lastColon);
    const hash = trimmed.substring(lastColon + 1);

    // Validate hash looks like SHA-256 (64 hex chars)
    if (/^[a-f0-9]{64}$/.test(hash)) {
      entries.push({ filePath: fp, hash });
    }
  }

  return entries;
}

/**
 * Load all ignore entries from both local and global files.
 */
export function loadAllIgnoreEntries(): IgnoreEntry[] {
  const local = loadIgnoreFile(LOCAL_IGNORE_FILE);
  const global = loadIgnoreFile(GLOBAL_IGNORE_FILE);
  return [...local, ...global];
}

/**
 * Check if a specific file + line content is in the ignore list.
 * Returns the matching entry if ignored, null otherwise.
 */
export function isIgnored(
  filePath: string,
  lineContent: string,
  ignoreEntries: IgnoreEntry[]
): IgnoreEntry | null {
  const resolvedFile = path.resolve(filePath);
  const hash = hashLine(lineContent);

  for (const entry of ignoreEntries) {
    if (entry.hash === hash) {
      // Match by hash — also check file path matches (or entry uses a relative path)
      const entryResolved = path.resolve(entry.filePath);
      if (
        entryResolved === resolvedFile ||
        // Also match if the entry's basename matches (for portability)
        path.basename(entryResolved) === path.basename(resolvedFile)
      ) {
        return entry;
      }
    }
  }

  return null;
}

/**
 * Get the path to the local ignore file (for display purposes).
 */
export function getLocalIgnorePath(): string {
  return path.resolve(LOCAL_IGNORE_FILE);
}

/**
 * Get the path to the global ignore file (for display purposes).
 */
export function getGlobalIgnorePath(): string {
  return GLOBAL_IGNORE_FILE;
}
