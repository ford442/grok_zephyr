#import "uniforms.wgsl"

@group(0) @binding(1) var<storage, read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage, read>       ext_elem : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> sat_pos  : array<vec4f>;
struct StationUniform { position_active: vec4f, zenith_min_sin: vec4f }
@group(0) @binding(4) var<uniform> station: StationUniform;
@group(0) @binding(5) var<storage, read> active_from : array<u32>;
struct GrowthUni { era_day: u32, enabled: u32, pad0: u32, pad1: u32 }
@group(0) @binding(6) var<uniform> growth : GrowthUni;
// Near-earth SGP4 mean elements for TLE slots (physics mode 3). Layout in
// src/physics/sgp4NearEarth.ts: [0] = (base_sim_sec, slot_count, 0, 0), then
// 3 vec4 per slot. A 1-slot zero buffer when no catalog is loaded.
@group(0) @binding(7) var<storage, read> sgp4_elem : array<vec4f>;

override num_satellites: u32 = 1048576u;

const REALISM_FLAG_BIT : u32 = 20u;
const PHYSICS_MODE_SHIFT : u32 = 17u;
const PHYSICS_MODE_MASK  : u32 = 7u;

// Multi-shell orbit radii (km from Earth center) — art-directed procedural mode
const ORBIT_RADII_KM = array<f32,3>(6711.0, 6921.0, 7521.0);
const MEAN_MOTIONS = array<f32,3>(0.001153, 0.001097, 0.000946);

const EARTH_J2 : f32 = 0.00108262668;
const EARTH_RADIUS_J2_KM : f32 = 6378.137;

fn solveKepler(M: f32, e: f32) -> f32 {
  var E = M;
  if (e > 0.8) { E = 3.14159265; }
  for (var iter = 0; iter < 8; iter++) {
    let f = E - e * sin(E) - M;
    let fp = 1.0 - e * cos(E);
    E = E - f / fp;
  }
  return E;
}

fn keplerianPosition(a: f32, e: f32, inc: f32, raan: f32, argp: f32, M0: f32, n: f32, t: f32) -> vec3f {
  let M = M0 + n * t;
  let E = solveKepler(M, e);
  let cE = cos(E);
  let sE = sin(E);
  let nu = atan2(sqrt(max(0.0, 1.0 - e * e)) * sE, cE - e);
  let r = a * (1.0 - e * cE);

  let xOrb = r * cos(nu);
  let yOrb = r * sin(nu);

  let cO = cos(raan); let sO = sin(raan);
  let ci = cos(inc);  let si = sin(inc);
  let cw = cos(argp); let sw = sin(argp);

  let x = (cO * cw - sO * sw * ci) * xOrb + (-cO * sw - sO * cw * ci) * yOrb;
  let y = (sO * cw + cO * sw * ci) * xOrb + (-sO * sw + cO * cw * ci) * yOrb;
  let z = sw * si * xOrb + cw * si * yOrb;
  return vec3f(x, y, z);
}

fn keplerianJ2Position(a: f32, e: f32, inc: f32, raan0: f32, argp0: f32, M0: f32, n: f32, t: f32) -> vec3f {
  let p = a * (1.0 - e * e);
  var raan = raan0;
  var argp = argp0;
  var M = M0 + n * t;
  if (p > 1.0) {
    let re_p = EARTH_RADIUS_J2_KM / p;
    let re_p2 = re_p * re_p;
    let ci = cos(inc);
    let ci2 = ci * ci;
    let factor = 1.5 * n * EARTH_J2 * re_p2;
    raan = raan0 - factor * ci * t;
    argp = argp0 + 0.5 * factor * (5.0 * ci2 - 1.0) * t;
    let eccF = sqrt(max(0.0, 1.0 - e * e));
    M = M0 + (n + 0.5 * factor * eccF * (3.0 * ci2 - 1.0)) * t;
  }
  return keplerianPosition(a, e, inc, raan, argp, M, 0.0, 0.0);
}

// ---------------------------------------------------------------------------
// Simplified near-earth SGP4 (Vallado sgp4init + sgp4, method 'n', WGS-72).
// Line-for-line mirror of src/physics/sgp4NearEarth.ts — change both together.
// No SDP4 deep-space terms; those slots are never packed.
// ---------------------------------------------------------------------------
const SGP4_RE_KM : f32 = 6378.135;
const SGP4_XKE   : f32 = 0.0743669161;
const SGP4_J2    : f32 = 0.001082616;
const SGP4_J3OJ2 : f32 = -0.0023450697;
const SGP4_J4    : f32 = -0.00000165597;
const SGP4_TWO_PI : f32 = 6.28318530718;

// Returns xyz km in .xyz and 1 in .w on success, w = 0 on SGP4 error.
fn sgp4NearEarth(v0: vec4f, v1: vec4f, v2: vec4f, dt: f32) -> vec4f {
  let no = v0.x; let ecco = v0.y; let inclo = v0.z; let bstar = v0.w;
  let t0 = v1.w; let argpo = v2.x; let mo = v2.y;

  // --- sgp4init (near earth) ---
  let eccsq = ecco * ecco;
  let omeosq = 1.0 - eccsq;
  let rteosq = sqrt(omeosq);
  let cosio = cos(inclo);
  let cosio2 = cosio * cosio;
  let ao = pow(SGP4_XKE / no, 2.0 / 3.0);
  let sinio = sin(inclo);
  let po = ao * omeosq;
  let con42 = 1.0 - 5.0 * cosio2;
  let con41 = -con42 - cosio2 - cosio2;
  let posq = po * po;
  let rp = ao * (1.0 - ecco);
  let isimp = rp < (220.0 / SGP4_RE_KM + 1.0);

  var sfour = 78.0 / SGP4_RE_KM + 1.0;
  var qzms24 = pow((120.0 - 78.0) / SGP4_RE_KM, 4.0);
  let perige = (rp - 1.0) * SGP4_RE_KM;
  if (perige < 156.0) {
    sfour = select(perige - 78.0, 20.0, perige < 98.0);
    qzms24 = pow((120.0 - sfour) / SGP4_RE_KM, 4.0);
    sfour = sfour / SGP4_RE_KM + 1.0;
  }
  let pinvsq = 1.0 / posq;
  let tsi = 1.0 / (ao - sfour);
  let eta = ao * ecco * tsi;
  let etasq = eta * eta;
  let eeta = ecco * eta;
  let psisq = abs(1.0 - etasq);
  let tsi2 = tsi * tsi;
  let coef = qzms24 * tsi2 * tsi2;
  let coef1 = coef / (psisq * psisq * psisq * sqrt(psisq));
  let cc2 = coef1 * no * (ao * (1.0 + 1.5 * etasq + eeta * (4.0 + etasq)) +
    0.375 * SGP4_J2 * tsi / psisq * con41 * (8.0 + 3.0 * etasq * (8.0 + etasq)));
  let cc1 = bstar * cc2;
  let cc3 = select(0.0, -2.0 * coef * tsi * SGP4_J3OJ2 * no * sinio / ecco, ecco > 1.0e-4);
  let x1mth2 = 1.0 - cosio2;
  let cc4 = 2.0 * no * coef1 * ao * omeosq * (eta * (2.0 + 0.5 * etasq) + ecco * (0.5 + 2.0 * etasq) -
    SGP4_J2 * tsi / (ao * psisq) * (-3.0 * con41 * (1.0 - 2.0 * eeta + etasq * (1.5 - 0.5 * eeta)) +
    0.75 * x1mth2 * (2.0 * etasq - eeta * (1.0 + etasq)) * cos(2.0 * argpo)));
  let cc5 = 2.0 * coef1 * ao * omeosq * (1.0 + 2.75 * (etasq + eeta) + eeta * etasq);
  let cosio4 = cosio2 * cosio2;
  let temp1i = 1.5 * SGP4_J2 * pinvsq * no;
  let temp2i = 0.5 * temp1i * SGP4_J2 * pinvsq;
  let temp3i = -0.46875 * SGP4_J4 * pinvsq * pinvsq * no;
  let mdot = no + 0.5 * temp1i * rteosq * con41 + 0.0625 * temp2i * rteosq * (13.0 - 78.0 * cosio2 + 137.0 * cosio4);
  let argpdot = -0.5 * temp1i * con42 + 0.0625 * temp2i * (7.0 - 114.0 * cosio2 + 395.0 * cosio4) +
    temp3i * (3.0 - 36.0 * cosio2 + 49.0 * cosio4);
  let xhdot1 = -temp1i * cosio;
  let nodedot = xhdot1 + (0.5 * temp2i * (4.0 - 19.0 * cosio2) + 2.0 * temp3i * (3.0 - 7.0 * cosio2)) * cosio;
  let omgcof = bstar * cc3 * cos(argpo);
  let xmcof = select(0.0, -(2.0 / 3.0) * coef * bstar / eeta, ecco > 1.0e-4);
  let nodecf = 3.5 * omeosq * xhdot1 * cc1;
  let t2cof = 1.5 * cc1;
  let xlcofDen = select(1.5e-12, 1.0 + cosio, abs(cosio + 1.0) > 1.5e-12);
  let xlcof = -0.25 * SGP4_J3OJ2 * sinio * (3.0 + 5.0 * cosio) / xlcofDen;
  let aycof = -0.5 * SGP4_J3OJ2 * sinio;
  let dm = 1.0 + eta * cos(mo);
  let delmo = dm * dm * dm;
  let sinmao = sin(mo);
  let x7thm1 = 7.0 * cosio2 - 1.0;

  // --- sgp4: secular gravity + drag, phases from the float64 base ---
  let t = t0 + dt;
  let t2 = t * t;
  let xmdf = v1.z + mdot * dt;
  let argpdf = v1.y + argpdot * dt;
  let nodem = v1.x + nodedot * dt + nodecf * dt * (2.0 * t0 + dt);
  var argpm = argpdf;
  var mm = xmdf;
  var tempa = 1.0 - cc1 * t;
  var tempe = bstar * cc4 * t;
  var templ = t2cof * t2;
  if (!isimp) {
    let cc1sq = cc1 * cc1;
    let d2 = 4.0 * ao * tsi * cc1sq;
    let tempd = d2 * tsi * cc1 / 3.0;
    let d3 = (17.0 * ao + sfour) * tempd;
    let d4 = 0.5 * tempd * ao * tsi * (221.0 * ao + 31.0 * sfour) * cc1;
    let t3cof = d2 + 2.0 * cc1sq;
    let t4cof = 0.25 * (3.0 * d3 + cc1 * (12.0 * d2 + 10.0 * cc1sq));
    let t5cof = 0.2 * (3.0 * d4 + 12.0 * cc1 * d3 + 6.0 * d2 * d2 + 15.0 * cc1sq * (2.0 * d2 + cc1sq));
    let delomg = omgcof * t;
    let dmt = 1.0 + eta * cos(xmdf);
    let delm = xmcof * (dmt * dmt * dmt - delmo);
    let tempdm = delomg + delm;
    mm = xmdf + tempdm;
    argpm = argpdf - tempdm;
    let t3 = t2 * t;
    let t4 = t3 * t;
    tempa = tempa - d2 * t2 - d3 * t3 - d4 * t4;
    tempe = tempe + bstar * cc5 * (sin(mm) - sinmao);
    templ = templ + t3cof * t3 + t4 * (t4cof + t * t5cof);
  }

  let am = ao * tempa * tempa;
  var em = ecco - tempe;
  if (!(am > 0.0) || em >= 1.0 || em < -0.001) { return vec4f(0.0); }
  em = max(em, 1.0e-6);
  mm = mm + no * templ;

  // --- long-period periodics ---
  let sinip = sinio;
  let cosip = cosio;
  let axnl = em * cos(argpm);
  var temp = 1.0 / (am * (1.0 - em * em));
  let aynl = em * sin(argpm) + temp * aycof;
  let u = mm + argpm + temp * xlcof * axnl;
  let uw = u - SGP4_TWO_PI * floor(u / SGP4_TWO_PI);

  // --- Kepler (fixed 10 iterations) ---
  var eo1 = uw;
  for (var ktr = 0; ktr < 10; ktr++) {
    let s = sin(eo1);
    let c = cos(eo1);
    var tem5 = 1.0 - c * axnl - s * aynl;
    tem5 = (uw - aynl * c + axnl * s - eo1) / tem5;
    eo1 = eo1 + clamp(tem5, -0.95, 0.95);
  }
  let sineo1 = sin(eo1);
  let coseo1 = cos(eo1);

  // --- short-period periodics ---
  let ecose = axnl * coseo1 + aynl * sineo1;
  let esine = axnl * sineo1 - aynl * coseo1;
  let el2 = axnl * axnl + aynl * aynl;
  let pl = am * (1.0 - el2);
  if (pl < 0.0) { return vec4f(0.0); }
  let rl = am * (1.0 - ecose);
  let betal = sqrt(1.0 - el2);
  temp = esine / (1.0 + betal);
  let sinu = am / rl * (sineo1 - aynl - axnl * temp);
  let cosu = am / rl * (coseo1 - axnl + aynl * temp);
  var su = atan2(sinu, cosu);
  let sin2u = (cosu + cosu) * sinu;
  let cos2u = 1.0 - 2.0 * sinu * sinu;
  temp = 1.0 / pl;
  let temp1 = 0.5 * SGP4_J2 * temp;
  let temp2 = temp1 * temp;
  let mrt = rl * (1.0 - 1.5 * temp2 * betal * con41) + 0.5 * temp1 * x1mth2 * cos2u;
  if (mrt < 1.0) { return vec4f(0.0); }
  su = su - 0.25 * temp2 * x7thm1 * sin2u;
  let xnode = nodem + 1.5 * temp2 * cosip * sin2u;
  let xinc = inclo + 1.5 * temp2 * cosip * sinip * cos2u;

  let sinsu = sin(su); let cossu = cos(su);
  let snod = sin(xnode); let cnod = cos(xnode);
  let sini = sin(xinc); let cosi = cos(xinc);
  let xmx = -snod * cosi;
  let xmy = cnod * cosi;
  let k = mrt * SGP4_RE_KM;
  return vec4f(k * (xmx * sinsu + cnod * cossu), k * (xmy * sinsu + snod * cossu), k * sini * sinsu, 1.0);
}

fn decodeColorIndex(shellData: f32) -> f32 {
  return f32(u32(shellData) & 255u);
}

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= num_satellites) { return; }

  var launchDay = active_from[i >> 1u];
  launchDay = select(launchDay & 0xFFFFu, launchDay >> 16u, (i & 1u) != 0u);
  if (growth.enabled != 0u && launchDay > growth.era_day) {
    sat_pos[i] = vec4f(0.0);
    return;
  }

  let e = orb_elem[i];
  let colorIndex = decodeColorIndex(e.w);
  let realismOn = ((uni.view_mode >> REALISM_FLAG_BIT) & 1u) != 0u;
  let physicsMode = (uni.view_mode >> PHYSICS_MODE_SHIFT) & PHYSICS_MODE_MASK;

  let extBase = i * 2u;
  let ext0 = ext_elem[extBase];
  let ext1 = ext_elem[extBase + 1u];
  let useSgp4 = realismOn && ext1.w > 0.5;
  let useKepler = physicsMode >= 1u || useSgp4;
  // Mode 3 runs SGP4 on the J2 fallback path's fleet: TLE slots with a packed
  // record use the near-earth kernel, everything else keeps secular J2.
  let useJ2 = physicsMode >= 2u;
  let sgp4Slots = u32(sgp4_elem[0].y);
  let useGpuSgp4 = physicsMode == 3u && realismOn && i < sgp4Slots && sgp4_elem[1u + i * 3u].x > 0.0;

  var pos = vec3f(0.0);
  if (useGpuSgp4) {
    let b = 1u + i * 3u;
    let dt = (uni.sim_time - sgp4_elem[0].x) / 60.0;
    pos = sgp4NearEarth(sgp4_elem[b], sgp4_elem[b + 1u], sgp4_elem[b + 2u], dt).xyz;
  } else if (useKepler) {
    if (useJ2) {
      pos = keplerianJ2Position(ext0.x, ext0.y, ext0.z, ext0.w, ext1.x, ext1.y, ext1.z, uni.sim_time);
    } else {
      pos = keplerianPosition(ext0.x, ext0.y, ext0.z, ext0.w, ext1.x, ext1.y, ext1.z, uni.sim_time);
    }
  } else {
    let shellDataU = u32(e.w);
    let shellIndex = shellDataU >> 8u;
    let orbitR = ORBIT_RADII_KM[shellIndex];
    let meanMotion = MEAN_MOTIONS[shellIndex];
    let M  = e.z + meanMotion * uni.sim_time;
    let cM = cos(M); let sM = sin(M);
    let cR = cos(e.x); let sR = sin(e.x);
    let cI = cos(e.y); let sI = sin(e.y);
    pos = vec3f(
      orbitR * (cR*cM - sR*sM*cI),
      orbitR * (sR*cM + cR*sM*cI),
      orbitR * sM * sI
    );
  }

  var packed = u32(colorIndex) & 255u;
  if (station.position_active.w > 0.5) {
    let toSat = normalize(pos - station.position_active.xyz);
    if (dot(toSat, station.zenith_min_sin.xyz) >= station.zenith_min_sin.w) {
      packed |= 256u;
    }
  }
  sat_pos[i] = vec4f(pos, f32(packed));
}
