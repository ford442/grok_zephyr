/**
 * Simplified near-Earth SGP4 — the CPU reference that `compute/orbital.wgsl`
 * physics mode 3 mirrors line for line.
 *
 * Scope: Vallado `sgp4init` + `sgp4` for method 'n' only (period < 225 min):
 * secular J2/J4 + drag (including the non-simple d2–d4 / t3–t5 terms), J3
 * long-period terms and J2 short-period periodics. No SDP4 lunar-solar
 * periodics or resonance; deep-space slots are never packed and fall back to
 * the Keplerian re-anchor path. WGS-72 constants to match `public/sgp4.wasm`.
 *
 * GPU layout (`array<vec4f>`, see `packSgp4GpuSlot`):
 *   header  [baseSimSec, slotCount, 0, 0]
 *   slot k  at 4 + 12k:
 *     [no (un-Kozai rad/min, 0 = no SGP4), ecco, inclo, bstar,
 *      nodeBase, argpBase, mBase, tsinceBase (min),
 *      argpo, mo, 0, 0]
 *
 * The `*Base` angles are the secular phases pre-advanced in float64 to
 * `baseSimSec`, so the GPU only multiplies rates by the small
 * `(sim_time - baseSimSec) / 60` — f32 cannot hold `mdot · tsince` for a
 * days-old TLE (hundreds of radians) to better than ~0.2 km.
 */

export const SGP4_GPU_HEADER_FLOATS = 4;
export const SGP4_GPU_FLOATS_PER_SLOT = 12;
/** TLE slots that get a GPU SGP4 record; later slots stay on Keplerian re-anchor. */
export const SGP4_GPU_CAPACITY = 16384;
export const SGP4_GPU_BUFFER_BYTES =
  (SGP4_GPU_HEADER_FLOATS + SGP4_GPU_CAPACITY * SGP4_GPU_FLOATS_PER_SLOT) * 4;
/** Re-base the GPU phases once |sim_time − base| exceeds this (keeps f32 Δ small). */
export const SGP4_GPU_REBASE_SIM_SEC = 1800;

// WGS-72 (Vallado getgravconst 'wgs72').
export const SGP4_RE_KM = 6378.135;
const MU = 398600.8;
export const SGP4_XKE = 60 / Math.sqrt((SGP4_RE_KM * SGP4_RE_KM * SGP4_RE_KM) / MU);
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const X2O3 = 2 / 3;
const TWO_PI = Math.PI * 2;
const UNIX_EPOCH_JD = 2440587.5;

export interface Sgp4MeanElements {
  /** Un-Kozai mean motion (rad/min), i.e. satrec.no after sgp4init. */
  no: number;
  ecco: number;
  inclo: number;
  nodeo: number;
  argpo: number;
  mo: number;
  bstar: number;
  epochJd: number;
}

/** Epoch-derived SGP4 coefficients (Vallado `initl` + near-earth `sgp4init`). */
export interface Sgp4NearEarthInit {
  no: number;
  ecco: number;
  inclo: number;
  bstar: number;
  isimp: boolean;
  ao: number;
  con41: number;
  x1mth2: number;
  x7thm1: number;
  eta: number;
  cc1: number;
  cc4: number;
  cc5: number;
  mdot: number;
  argpdot: number;
  nodedot: number;
  omgcof: number;
  xmcof: number;
  nodecf: number;
  t2cof: number;
  xlcof: number;
  aycof: number;
  delmo: number;
  sinmao: number;
  d2: number;
  d3: number;
  d4: number;
  t3cof: number;
  t4cof: number;
  t5cof: number;
}

type SatrecLike = {
  no: number;
  ecco: number;
  inclo: number;
  nodeo: number;
  argpo: number;
  mo: number;
  bstar: number;
  jdsatepoch: number;
  jdsatepochF?: number;
  error?: number;
  method?: string;
};

/** True when Vallado would use the near-earth ('n') branch. */
export function isNearEarth(noUnKozai: number): boolean {
  return noUnKozai > 0 && TWO_PI / noUnKozai < 225;
}

/** Mean elements from an initialised satellite.js satrec, or null if unusable on the GPU. */
export function sgp4MeanElementsFromSatrec(satrec: SatrecLike): Sgp4MeanElements | null {
  if (satrec.error || satrec.method === 'd' || !isNearEarth(satrec.no)) return null;
  return {
    no: satrec.no,
    ecco: satrec.ecco,
    inclo: satrec.inclo,
    nodeo: satrec.nodeo,
    argpo: satrec.argpo,
    mo: satrec.mo,
    bstar: satrec.bstar,
    epochJd: satrec.jdsatepoch + (satrec.jdsatepochF ?? 0),
  };
}

export function sgp4NearEarthInit(
  no: number,
  ecco: number,
  inclo: number,
  bstar: number,
  argpo: number,
  mo: number,
): Sgp4NearEarthInit {
  const eccsq = ecco * ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(inclo);
  const cosio2 = cosio * cosio;
  const ao = Math.pow(SGP4_XKE / no, X2O3);
  const sinio = Math.sin(inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - ecco);

  const isimp = rp < 220 / SGP4_RE_KM + 1;
  let sfour = 78 / SGP4_RE_KM + 1;
  let qzms24 = Math.pow((120 - 78) / SGP4_RE_KM, 4);
  const perige = (rp - 1) * SGP4_RE_KM;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = Math.pow((120 - sfour) / SGP4_RE_KM, 4);
    sfour = sfour / SGP4_RE_KM + 1;
  }
  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * Math.pow(tsi, 4);
  const coef1 = coef / Math.pow(psisq, 3.5);
  const cc2 =
    coef1 *
    no *
    (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
      ((0.375 * J2 * tsi) / psisq) * con41 * (8 + 3 * etasq * (8 + etasq)));
  const cc1 = bstar * cc2;
  const cc3 = ecco > 1e-4 ? (-2 * coef * tsi * J3OJ2 * no * sinio) / ecco : 0;
  const x1mth2 = 1 - cosio2;
  const cc4 =
    2 *
    no *
    coef1 *
    ao *
    omeosq *
    (eta * (2 + 0.5 * etasq) +
      ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
          0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
  const mdot =
    no +
    0.5 * temp1 * rteosq * con41 +
    0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot =
    -0.5 * temp1 * con42 +
    0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
    temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot =
    xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  const omgcof = bstar * cc3 * Math.cos(argpo);
  const xmcof = ecco > 1e-4 ? (-X2O3 * coef * bstar) / eeta : 0;
  const nodecf = 3.5 * omeosq * xhdot1 * cc1;
  const t2cof = 1.5 * cc1;
  const xlcofDen = Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12;
  const xlcof = (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / xlcofDen;
  const aycof = -0.5 * J3OJ2 * sinio;
  const delmo = Math.pow(1 + eta * Math.cos(mo), 3);
  const sinmao = Math.sin(mo);
  const x7thm1 = 7 * cosio2 - 1;

  let d2 = 0;
  let d3 = 0;
  let d4 = 0;
  let t3cof = 0;
  let t4cof = 0;
  let t5cof = 0;
  if (!isimp) {
    const cc1sq = cc1 * cc1;
    d2 = 4 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3;
    d3 = (17 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
    t3cof = d2 + 2 * cc1sq;
    t4cof = 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq));
    t5cof = 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq));
  }

  return {
    no, ecco, inclo, bstar, isimp, ao, con41, x1mth2, x7thm1, eta, cc1, cc4, cc5,
    mdot, argpdot, nodedot, omgcof, xmcof, nodecf, t2cof, xlcof, aycof, delmo, sinmao,
    d2, d3, d4, t3cof, t4cof, t5cof,
  };
}

function wrapTwoPi(x: number): number {
  const r = x % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Minutes since TLE epoch at a Unix instant (Vallado JD convention). */
export function tsinceMinutes(epochJd: number, unixMs: number): number {
  return (unixMs / 86400000 + UNIX_EPOCH_JD - epochJd) * 1440;
}

/**
 * Write the GPU record for slot `k`. `baseUnixMs` is the UTC of sim_time =
 * `baseSimSec`; the secular phases are advanced to it in float64.
 */
export function packSgp4GpuSlot(
  dest: Float32Array,
  k: number,
  el: Sgp4MeanElements | null,
  baseUnixMs: number,
): void {
  const o = SGP4_GPU_HEADER_FLOATS + k * SGP4_GPU_FLOATS_PER_SLOT;
  if (!el) {
    dest.fill(0, o, o + SGP4_GPU_FLOATS_PER_SLOT);
    return;
  }
  const init = sgp4NearEarthInit(el.no, el.ecco, el.inclo, el.bstar, el.argpo, el.mo);
  const t0 = tsinceMinutes(el.epochJd, baseUnixMs);
  dest[o] = el.no;
  dest[o + 1] = el.ecco;
  dest[o + 2] = el.inclo;
  dest[o + 3] = el.bstar;
  dest[o + 4] = wrapTwoPi(el.nodeo + init.nodedot * t0 + init.nodecf * t0 * t0);
  dest[o + 5] = wrapTwoPi(el.argpo + init.argpdot * t0);
  dest[o + 6] = wrapTwoPi(el.mo + init.mdot * t0);
  dest[o + 7] = t0;
  dest[o + 8] = el.argpo;
  dest[o + 9] = el.mo;
  dest[o + 10] = 0;
  dest[o + 11] = 0;
}

export function writeSgp4GpuHeader(dest: Float32Array, baseSimSec: number, slotCount: number): void {
  dest[0] = baseSimSec;
  dest[1] = slotCount;
  dest[2] = 0;
  dest[3] = 0;
}

/**
 * Propagate slot `k` of a packed GPU buffer to `simTimeSec` — exactly what the
 * WGSL mode-3 kernel computes. Returns TEME km, or null (no record / SGP4 error).
 */
export function propagateSgp4GpuSlot(
  packed: Float32Array,
  k: number,
  simTimeSec: number,
): [number, number, number] | null {
  if (k >= packed[1]) return null;
  const o = SGP4_GPU_HEADER_FLOATS + k * SGP4_GPU_FLOATS_PER_SLOT;
  const no = packed[o];
  if (!(no > 0)) return null;
  const s = sgp4NearEarthInit(no, packed[o + 1], packed[o + 2], packed[o + 3], packed[o + 8], packed[o + 9]);
  const dt = (simTimeSec - packed[0]) / 60;
  const t0 = packed[o + 7];
  return sgp4NearEarthPosition(s, packed[o + 4], packed[o + 5], packed[o + 6], t0, dt);
}

/**
 * Vallado `sgp4` near-earth position with phases given at a base time:
 * tsince = t0 + dt, secular angles = base + rate · dt.
 */
export function sgp4NearEarthPosition(
  s: Sgp4NearEarthInit,
  nodeBase: number,
  argpBase: number,
  mBase: number,
  t0: number,
  dt: number,
): [number, number, number] | null {
  const t = t0 + dt;
  const t2 = t * t;
  const xmdf = mBase + s.mdot * dt;
  const argpdf = argpBase + s.argpdot * dt;
  const nodem = nodeBase + s.nodedot * dt + s.nodecf * dt * (2 * t0 + dt);
  let argpm = argpdf;
  let mm = xmdf;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;
  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delm = s.xmcof * (Math.pow(1 + s.eta * Math.cos(xmdf), 3) - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }

  const am = s.ao * tempa * tempa;
  let em = s.ecco - tempe;
  if (!(am > 0) || em >= 1 || em < -0.001) return null;
  if (em < 1e-6) em = 1e-6;
  mm = mm + s.no * templ;

  // Long-period periodics (J3).
  const sinip = Math.sin(s.inclo);
  const cosip = Math.cos(s.inclo);
  const axnl = em * Math.cos(argpm);
  let temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  // u = xl − node; the node is added back after the short-period terms.
  const u = wrapTwoPi(mm + argpm + temp * s.xlcof * axnl);

  // Kepler's equation in (axnl, aynl) — fixed 10 iterations like the WGSL.
  let eo1 = u;
  for (let ktr = 0; ktr < 10; ktr++) {
    const s1 = Math.sin(eo1);
    const c1 = Math.cos(eo1);
    let tem5 = 1 - c1 * axnl - s1 * aynl;
    tem5 = (u - aynl * c1 + axnl * s1 - eo1) / tem5;
    tem5 = Math.max(-0.95, Math.min(0.95, tem5));
    eo1 += tem5;
  }
  const sineo1 = Math.sin(eo1);
  const coseo1 = Math.cos(eo1);

  // Short-period periodics (J2).
  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return null;
  const rl = am * (1 - ecose);
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  if (mrt < 1) return null;
  su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * temp2 * cosip * sin2u;
  const xinc = s.inclo + 1.5 * temp2 * cosip * sinip * cos2u;

  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const k = mrt * SGP4_RE_KM;
  return [
    k * (xmx * sinsu + cnod * cossu),
    k * (xmy * sinsu + snod * cossu),
    k * (sini * sinsu),
  ];
}
