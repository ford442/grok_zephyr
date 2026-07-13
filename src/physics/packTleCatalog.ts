/**
 * Pack TLE line pairs into the 260-byte records expected by the WASM catalog loader.
 */

export const TLE_LINE_BYTES = 130;
export const TLE_RECORD_BYTES = TLE_LINE_BYTES * 2;

export interface TleLinePair {
  line1: string;
  line2: string;
}

function writePaddedLine(buf: Uint8Array, offset: number, line: string): void {
  const trimmed = line.trim();
  const bytes = new TextEncoder().encode(trimmed);
  const len = Math.min(bytes.length, TLE_LINE_BYTES - 1);
  if (len > 0) {
    buf.set(bytes.subarray(0, len), offset);
  }
}

/** Pack TLE records into a contiguous byte buffer for sgp4_load_catalog(). */
export function packTleCatalog(tles: readonly TleLinePair[]): Uint8Array {
  const buf = new Uint8Array(tles.length * TLE_RECORD_BYTES);
  for (let i = 0; i < tles.length; i++) {
    const base = i * TLE_RECORD_BYTES;
    writePaddedLine(buf, base, tles[i].line1);
    writePaddedLine(buf, base + TLE_LINE_BYTES, tles[i].line2);
  }
  return buf;
}
