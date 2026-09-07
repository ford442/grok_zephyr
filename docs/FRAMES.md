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
| Vallado SGP4 WASM / satellite.js | **TEME** (True Equator Mean Equinox of date, Vallado) | Copied into the render buffer as if TEME ≡ ECI. Optional `sgp4_teme_to_gcrf` (low-order IAU-76) exists in WASM but is **not** applied on the re-anchor path. |
| Keplerian conversion (`eciStateToKeplerian`) | Same mixed Cartesian | Treats the vector as inertial ECI |

**Error bounds (SGP4 TEME used as GCRF/J2000):** typically **tens of arcseconds** (sub-km at LEO in the cross-track sense for short arcs), occasionally approaching **~1 arcminute** for neglected EOP / older TLEs. That is far smaller than the art-directed shell spacing (hundreds of km) and is **not** a substitute for conjunction-grade screening.

## Sun

| Mode | Vector | Use |
| --- | --- | --- |
| **Art** (default) | Sun on the **XY plane**, 1 AU, period 365.25 d, phase from `simTime` only | Cinematic terminator; visual baselines |
| **Astro** | Low-precision geometric sun (Meeus mean longitude / anomaly, mean obliquity) in the **mean equator of date**, from `SimClock.simUtc` | Seasonal terminator, eclipse/ground-station lighting |

Astro vs TEME satellites is an extra ~0.01°–0.1° inconsistency. Fine for lighting; not for solar-pressure force models.

Art mode **ignores calendar date**. The same `simTime` at June or December yields the same terminator. Astro mode at a fixed clock time of day but different day-of-year moves the terminator (sun declination ±~23.4°).

## Single time/orientation module

`src/physics/frames.ts` is the only GMST / ECEF↔ECI implementation:

- `gmstRad(jd)` — Greenwich Mean Sidereal Time (IAU 1982 / Vallado seconds polynomial), radians in `[0, 2π)`.
- `eciToEcef(eci, jd)` / `ecefToEci(ecef, jd)` — `rotateZ` by `±gmstRad(jd)`.
- `earthRotationRad(mode, simTimeSec, utcMs)` — the render-frame Earth-orientation angle consumed by the Earth/Ground View shaders (see below).

`src/ground/GroundStation.ts` used to carry its own Meeus-degree GMST polynomial (`gmstRadians`) and hand-rolled `rotateEcfToEci`. It now delegates entirely to `frames.ts` (`ecefToEci` + `unixMsToJulianDate`). The two formulas agreed to within ~1e-6 rad at J2000 and a 2026 date before the switch — locked by a regression test in `src/physics/frames.test.ts` — so ground-station geometry is unchanged, just no longer duplicated.

Pass prediction (`PassPredictor.ts`, `elevationDeg`, `isSatelliteVisible`), station GPU state (`stationGpuState`, written into the `station` uniform every frame), and Earth rotation (below) all key off `SimClock.simUtcMs`.

## Earth rotation / ground

The Earth surface shader (`src/shaders/render/earth.ts`) and the Ground View horizon shader (`src/shaders/render/ground.ts`) rotate their body-fixed terrain/city-light sampling by a single CPU-computed angle, `uni.earth_rotation_rad`, using the same `rotateZ(+angle)` convention as `eciToEcef`. The angle comes from `earthRotationRad(mode, simTimeSec, utcMs)`:

| Mode | Angle | When |
| --- | --- | --- |
| `'art'` | `-(2π · simTime / 86164 s)` — the legacy sim-time-only spin, no UTC anchor | **Default.** Bit-identical to the pre-unification WGSL formula, so every existing ART-mode visual baseline is unaffected. |
| `'gmst'` | `gmstRad(unixMsToJulianDate(simUtcMs))` — true GMST | `?sun=astro` (always), or `?earth=1` under ART sun |

Under `'gmst'`, a ground station's ECI position (`GroundStation.ts`, true GMST) and the textured surface underneath it (shaders, same true GMST) rotate together — a station's zenith and the terrain/city-light pattern at its lat/lon agree, to the extent the procedural FBM "continents" stand in for real geography. Under the default `'art'` mode they do **not** agree (the spin has no UTC anchor), matching the pre-existing behavior this doc used to warn about.

The **WebGL2** Earth shader (`src/webgl/shaders.ts`) remains a simplified, **non-rotating** port — it never applied any spin, ART or GMST. That's an existing simplification, not something this change extends; WebGL2 continents are still a fixed art pose regardless of sun mode.

If star catalogs land, the sky will still drift against GMST-rotated terrain unless the astro sun's celestial-sphere placement and `earthRotationRad('gmst', …)` share the same clock — they already do (`SimClock.simUtcMs`).

## Clock

- `simTime` — seconds since the clock epoch (GPU Keplerian argument)
- `simUtcMs` — UTC milliseconds (`epochMs + simTime * 1000`)
- SGP4 re-anchor uses `simUtcMs` as the Vallado `unix_ms` argument (JD = unix/86400000 + 2440587.5)

## Toggles

- UI: **SUN** → ART | ASTRO
- URL: `?sun=art` (default) or `?sun=astro`; `?earth=1` forces GMST-true Earth rotation under ART sun (implied by `?sun=astro`)
- Persistence: `localStorage['zephyr.sunMode']` (Earth-rotation opt-in is not persisted)

Visual regression stays on **art** sun with Earth rotation off (the default), so baselines are untouched by this module.
