# Reference frames

Grok Zephyr mixes cinematic lighting with optional SGP4 catalog geometry. This note records **what the code pretends today**, not a full IERS reduction.

## Render frame (what shaders see)

All GPU positions (`sat_pos`, camera, `uni.sun_position`) live in a single right-handed Cartesian frame whose origin is Earth's center and whose units are **kilometers**.

| Axis | Pretended meaning |
| --- | --- |
| +X | Vernal-equinox / TEME X (catalog) or “art” orbit plane X (procedural) |
| +Z | Earth rotation axis, north |
| +Y | Completes RHS |

There is **no** precession, nutation, polar motion, or Earth-orientation parameter (EOP) chain.

## Satellite states

| Source | True frame | What we do |
| --- | --- | --- |
| Procedural Walker / Keplerian / J2 | Circular or osculating Keplerian in the render frame | Exact by construction |
| Vallado SGP4 WASM / satellite.js | **TEME** (True Equator Mean Equinox of date, Vallado) | Copied into the render buffer as if TEME ≡ ECI. No TEME→GCRF / TOD conversion. |
| Keplerian conversion (`eciStateToKeplerian`) | Same mixed Cartesian | Treats the vector as inertial ECI |

**Error bounds (SGP4 TEME used as GCRF/J2000):** typically **tens of arcseconds** (sub-km at LEO in the cross-track sense for short arcs), occasionally approaching **~1 arcminute** for neglected EOP / older TLEs. That is far smaller than the art-directed shell spacing (hundreds of km) and is **not** a substitute for conjunction-grade screening.

## Sun

| Mode | Vector | Use |
| --- | --- | --- |
| **Art** (default) | Sun on the **XY plane**, 1 AU, period 365.25 d, phase from `simTime` only | Cinematic terminator; visual baselines |
| **Astro** | Low-precision geometric sun (Meeus mean longitude / anomaly, mean obliquity) in the **mean equator of date**, from `SimClock.simUtc` | Seasonal terminator, eclipse/ground-station lighting |

Astro vs TEME satellites is an extra ~0.01°–0.1° inconsistency. Fine for lighting; not for solar-pressure force models.

Art mode **ignores calendar date**. The same `simTime` at June or December yields the same terminator. Astro mode at a fixed clock time of day but different day-of-year moves the terminator (sun declination ±~23.4°).

## Earth rotation / ground

`SimClock` carries a real **simulated UTC** (`epoch + simTime`). Ground-station ECEF→ECI currently uses a simple station helper; `gmstRad(jd)` in `src/physics/frames.ts` is the hook for a proper GMST rotation when pass prediction (#113) needs it.

Earth texture / ground view is **not** yet slaved to GMST. If star catalogs land, the sky will drift unless that rotation is applied.

## Clock

- `simTime` — seconds since the clock epoch (GPU Keplerian argument)
- `simUtcMs` — UTC milliseconds (`epochMs + simTime * 1000`)
- SGP4 re-anchor uses `simUtcMs` as the Vallado `unix_ms` argument (JD = unix/86400000 + 2440587.5)

## Toggle

- UI: **SUN** → ART | ASTRO
- URL: `?sun=art` (default) or `?sun=astro`
- Persistence: `localStorage['zephyr.sunMode']`

Visual regression stays on **art**.
