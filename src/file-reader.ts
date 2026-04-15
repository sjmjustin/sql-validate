import * as fs from "fs";

/**
 * Read a file with automatic encoding detection.
 *
 * Detects UTF-16 LE, UTF-16 BE, and UTF-8 (with or without BOM) by
 * inspecting the first 2-3 bytes for a Byte Order Mark. Falls back to
 * UTF-8 when no BOM is present.
 *
 * This is important for SSMS-exported schema files, which are often
 * saved as UTF-16 LE on Windows.
 */
export function readFileAutoEncoding(filePath: string): string {
  const buf = fs.readFileSync(filePath);

  if (buf.length === 0) return "";

  // Check for BOM (Byte Order Mark)
  if (buf.length >= 2) {
    // UTF-16 LE: FF FE
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      return decodeUtf16LE(buf, 2);
    }

    // UTF-16 BE: FE FF
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      return decodeUtf16BE(buf, 2);
    }
  }

  if (buf.length >= 3) {
    // UTF-8 BOM: EF BB BF
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return buf.toString("utf-8", 3);
    }
  }

  // No BOM — heuristic: check if file looks like UTF-16 by checking for
  // interleaved null bytes in the first 100 bytes (common in ASCII-range
  // UTF-16 content like SQL)
  if (buf.length >= 4) {
    const nullsAtOdd = countNulls(buf, 1, Math.min(100, buf.length));
    const nullsAtEven = countNulls(buf, 0, Math.min(100, buf.length));
    const sampleLen = Math.min(50, Math.floor(buf.length / 2));

    // UTF-16 LE without BOM: null bytes at odd positions (byte 1, 3, 5...)
    if (sampleLen > 4 && nullsAtOdd > sampleLen * 0.7 && nullsAtEven < sampleLen * 0.1) {
      return decodeUtf16LE(buf, 0);
    }

    // UTF-16 BE without BOM: null bytes at even positions (byte 0, 2, 4...)
    if (sampleLen > 4 && nullsAtEven > sampleLen * 0.7 && nullsAtOdd < sampleLen * 0.1) {
      return decodeUtf16BE(buf, 0);
    }
  }

  // Default: UTF-8
  return buf.toString("utf-8");
}

/** Decode a buffer as UTF-16 LE, skipping `offset` leading bytes. */
function decodeUtf16LE(buf: Buffer, offset: number): string {
  // Node natively supports utf16le
  return buf.toString("utf16le", offset);
}

/** Decode a buffer as UTF-16 BE, skipping `offset` leading bytes. */
function decodeUtf16BE(buf: Buffer, offset: number): string {
  // Node doesn't have a native utf16be decoder — swap bytes to LE first
  const swapped = Buffer.alloc(buf.length - offset);
  for (let i = 0; i < swapped.length - 1; i += 2) {
    swapped[i] = buf[offset + i + 1];
    swapped[i + 1] = buf[offset + i];
  }
  return swapped.toString("utf16le");
}

/** Count null bytes at positions with a given parity (0=even, 1=odd). */
function countNulls(buf: Buffer, startParity: number, limit: number): number {
  let count = 0;
  for (let i = startParity; i < limit; i += 2) {
    if (buf[i] === 0x00) count++;
  }
  return count;
}
