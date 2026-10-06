#!/usr/bin/env node
/* global process, console, fetch, Buffer */
/**
 * Build public/sky/hip_v65.bin from the Hipparcos main catalogue (ESA 1997,
 * CDS I/239). See docs/SKY.md and public/sky/README.md.
 *
 *   node scripts/build-sky-catalog.mjs [path/to/hip_main.dat] [--vmax 6.5]
 *
 * Without a path the catalogue (53 MB, uncompressed on CDS) is downloaded.
 *
 * Output layout (little endian):
 *   header  u32 magic 'SKY1' · u32 version 1 · u32 count · u32 round(vmax*1000)
 *   star    f32 x, y, z (ICRS unit direction, J2000 epoch)
 *           u32 packed  = u16 round((V + 2) * 1000)  |  i16 round((B-V) * 1000) << 16
 * Stars are sorted brightest first.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIP_URL = 'https://cdsarc.cds.unistra.fr/ftp/I/239/hip_main.dat';
const MAGIC = 0x31594b53; // 'SKY1'
const VERSION = 1;
/** Hipparcos positions are at epoch J1991.25; move them to J2000. */
const EPOCH_YEARS = 2000.0 - 1991.25;
const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);
const DEG = Math.PI / 180;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const vmaxIdx = args.indexOf('--vmax');
const vmax = vmaxIdx >= 0 ? Number(args[vmaxIdx + 1]) : 6.5;
const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--vmax');
const outName = `hip_v${String(vmax).replace('.', '')}.bin`;

async function loadText() {
  if (input) return readFile(input, 'latin1');
  console.log(`downloading ${HIP_URL}`);
  const res = await fetch(HIP_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${HIP_URL}`);
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}

function parseSexagesimal(text, hours) {
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const sign = text.trim().startsWith('-') ? -1 : 1;
  const value = Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600;
  return sign * value * (hours ? 15 : 1);
}

const text = await loadText();
const stars = [];
let skipped = 0;
for (const line of text.split('\n')) {
  if (!line.startsWith('H|')) continue;
  const f = line.split('|');
  const v = Number.parseFloat(f[5]);
  if (!Number.isFinite(v) || v > vmax) continue;

  // ~263 entries have no astrometric solution; fall back to the hms/dms fields.
  let ra = Number.parseFloat(f[8]);
  let dec = Number.parseFloat(f[9]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
    ra = parseSexagesimal(f[3], true);
    dec = parseSexagesimal(f[4], false);
    if (ra === null || dec === null) {
      skipped++;
      continue;
    }
  }
  const pmRa = Number.parseFloat(f[12]) || 0; // mas/yr, already × cos δ
  const pmDe = Number.parseFloat(f[13]) || 0;
  const bvRaw = Number.parseFloat(f[37]);
  const bv = Number.isFinite(bvRaw) ? bvRaw : 0.6; // solar-ish when unmeasured

  const a = ra * DEG;
  const d = dec * DEG;
  const dir = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  // Proper motion along the local east (α) and north (δ) unit vectors —
  // well-behaved at the pole, unlike adding pmRA / cos δ to α.
  const east = [-Math.sin(a), Math.cos(a), 0];
  const north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const de = pmRa * MAS_TO_RAD * EPOCH_YEARS;
  const dn = pmDe * MAS_TO_RAD * EPOCH_YEARS;
  for (let k = 0; k < 3; k++) dir[k] += east[k] * de + north[k] * dn;
  const len = Math.hypot(dir[0], dir[1], dir[2]);

  stars.push({ hip: Number(f[1]), v, bv, x: dir[0] / len, y: dir[1] / len, z: dir[2] / len });
}

stars.sort((p, q) => p.v - q.v || p.hip - q.hip);

const buf = Buffer.alloc(16 + stars.length * 16);
buf.writeUInt32LE(MAGIC, 0);
buf.writeUInt32LE(VERSION, 4);
buf.writeUInt32LE(stars.length, 8);
buf.writeUInt32LE(Math.round(vmax * 1000), 12);
stars.forEach((s, i) => {
  const o = 16 + i * 16;
  buf.writeFloatLE(s.x, o);
  buf.writeFloatLE(s.y, o + 4);
  buf.writeFloatLE(s.z, o + 8);
  buf.writeUInt16LE(Math.round((s.v + 2) * 1000), o + 12);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s.bv * 1000))), o + 14);
});

const outDir = join(root, 'public', 'sky');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, outName), buf);
console.log(
  `${outName}: ${stars.length} stars (V ≤ ${vmax}), ${(buf.length / 1024).toFixed(1)} KB` +
    (skipped ? `, ${skipped} skipped without position` : ''),
);
