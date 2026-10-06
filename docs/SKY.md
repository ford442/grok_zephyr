# Night sky

The sky is procedural by default: hashed star cells, an FBM Milky Way and a
blackbody approximation (`src/shaders/render/stars.wgsl`, entry point `fs`).
`?sky=hip` replaces the stars brighter than V 6.5 with the real ones from the
Hipparcos catalogue, so God View, Moon View and the Ground View night sky show
real asterisms, the north and south celestial poles, and the right number of
stars at each magnitude.

The catalog is **opt-in**. With no `?sky=` the procedural pipeline, bind group
and entry point are the ones used before, which keeps the default
visual-regression URL unchanged.

## URL

| Value | Sky |
| --- | --- |
| *(absent)* / `proc` / anything unknown | procedural (today's shader) |
| `hip` / `hipparcos` / `catalog` | Hipparcos catalog over a procedural background |
| `auto` / `on` | `hip` on the `high` and `cinematic` presets, `proc` on `low` / `balanced` |

The mode is resolved once in `bootWebGPU` (next to `?earthmap=`) and is fixed
for the session. If the fetch or decode fails, the app logs
`[SkyCatalog] load failed` and keeps the procedural sky. Startup is never
blocked.

The WebGL2 fallback (`?renderer=webgl`) and the standalone build ignore `?sky=`
and stay procedural. Per project policy there is no GLSL port unless a visual
test needs one.

## Data

`public/sky/hip_v65.bin` (139 KB) is built by `scripts/build-sky-catalog.mjs`
from the Hipparcos Main Catalogue (ESA 1997, CDS I/239). Provenance is in
`public/sky/README.md`.

- All 8,874 entries with V ≤ 6.5 (the naked-eye limit).
- Positions are moved from the Hipparcos epoch J1991.25 to J2000 using each
  star's proper motion.
- Layout, little endian:
  - A 16-byte header: `'SKY1'`, version 1, count, and `round(vmax × 1000)`.
  - Then 16 bytes per star: f32 ICRS unit direction xyz, plus a u32 that packs
    `(V + 2) × 1000` in the low 16 bits and signed `(B−V) × 1000` in the high
    16 bits.
  - Records are sorted brightest first.

The storage buffer is about 139 KB of GPU memory. It is **not** part of the
satellite storage ledger (`calculateSatelliteBufferBudget`), so it takes
nothing from the 128 MB Pascal budget.

```sh
node scripts/build-sky-catalog.mjs              # downloads hip_main.dat (53 MB) from CDS
node scripts/build-sky-catalog.mjs hip_main.dat # or use a local copy
```

## Rendering

The stars draw is the first command in all three scene bundles (standard, Moon
and Ground; `SceneRenderBundle.ts`). With `?sky=hip` it becomes two draws:

1. **Background**, `stars.wgsl` → `fs_catalog`. It draws the same art as `fs`
   (gradient, horizon fog, Milky Way and the two dense hash layers), but only
   hash stars fainter than the catalog limit, so no false bright stars compete
   with the real ones. The view ray comes from the real projection, recovered
   from `view_proj` and the camera basis. The procedural `skyDir` ignores FOV,
   which is fine for random stars but would put the Milky Way in the wrong
   place relative to catalog stars. The Milky Way is evaluated on the ICRS ray,
   so the band runs through Cygnus, Crux and Sagittarius where it should.
2. **Catalog points**, `starsCatalog.wgsl`. These are instanced camera-facing
   quads (`draw(6, count)`) with additive color and no depth write.
   - **Projection.** `view_proj · (dir, 0)` puts each star at infinity, so it
     does not move as the camera translates, only as it rotates. The quad is
     then expanded in pixels from `uni.screen_size`.
   - **Footprint.** A Gaussian footprint about 1.6 px across, widening to 2× for
     stars brighter than about V 3.5.
   - **Brightness.** `starHdrLuminance(V)`, the same Pogson curve and bloom cap
     as the procedural layers.
   - **Colour.** B−V is converted to temperature with Ballesteros (2012), then to
     colour with `blackbodyColor`.

Both pipelines bind `@group(1)` = star buffer + `SkyCatalogSettings`
(`starCatalogLayout`). The group is always bound (one-star placeholder under
`proc`) and both pipelines are always created, so the default boot also
compiles their WGSL.

### Occlusion and haze

- **Earth occlusion** happens in the vertex shader. A star whose ray from the
  camera hits the solid Earth (`dot(dir, −cam/|cam|) > √(1 − R²/|cam|²)`) is
  dropped. This works in every view: below the Ground View horizon, behind the
  Earth disk from Moon View, and behind the limb in orbit. It does not depend
  on the terrain or Earth draw covering the star afterwards.
  `isStarOccludedByEarth` in `src/render/SkyCatalog.ts` is the CPU mirror.
- **Atmosphere.** Catalog stars get the same `atmosphereLUT` extinction and
  horizon reddening as the procedural field (`skyExtinction`, which samples at
  an explicit LOD so it is valid after the occlusion branch). They also get the
  same Ground View attenuation and Moon View dimming next to the Earth disk
  (`catalogStarScale`). The atmosphere limb pass draws on top additively, so
  stars fade through the limb glow in orbital views exactly as procedural ones
  do.

Shared WGSL lives in `starsCommon.wgsl`: atmosphere bindings, `blackbodyColor`,
`starHdrLuminance` and the catalog helpers.

## Reference frame

Catalog directions are ICRS (≈ GCRF / J2000). The render frame is **TEME of
date** by default (see [FRAMES.md](FRAMES.md)), which in 2026 is rotated about
0.37° from J2000 by precession — far more than a pixel. `SkyCatalogSettings`
therefore carries a 3×3 ICRS → render rotation:

| Condition | Matrix |
| --- | --- |
| `?frame=gcrf` **and** `?sun=astro` (re-anchors are GCRF) | identity |
| otherwise | `gcrfToTemeMatrix(jd(simUtcMs))` |

`gcrfToTemeMatrix` (`src/physics/frames.ts`) is the transpose of a line-for-line
TS port of `temeToGcrfMatrix` in `native/wasm/teme_gcrf.hpp`. It uses IAU-76
precession, truncated IAU-1980 nutation and the equation of the equinoxes.
`Sgp4WasmEngine.test.ts` pins the port to the WASM oracle. Stars and `?frame=`
satellites therefore share one rotation, and the remaining error is that
model's (tens of arcseconds), well under a pixel.

The matrix is a uniform rather than baked into the buffer because the SUN
toggle can change the frame at runtime. `writeSkyFrameUniform`
(`UniformWriter.ts`) rewrites it only when the sun mode, the GCRF request, or
the 30-day bucket of `simUtcMs` changes; precession moves stars about 4″ a
month. Writing a buffer never invalidates the cached render bundle.

GPU near-earth SGP4 slots (physics mode 3) are always TEME. Under `?frame=gcrf`
they differ from the catalog by the TEME→GCRF angle, the same caveat FRAMES.md
records for satellites.

## Tests

WebGPU pixels cannot be read back in the cloud VM, so correctness is pinned on
CPU mirrors. All of these are in `src/render/SkyCatalog.test.ts` unless noted.

- **`?sky=` parsing:** every mode × quality preset.
- **Decoder:** magic, version and truncation checks, plus the packed-record
  round-trip in the same form the shader unpacks.
- **Committed catalog:**
  - Polaris, Acrux, Alnitak, Alnilam, Mintaka, Sirius and Betelgeuse are each
    within 0.05° of a SIMBAD J2000 position typed independently of the build
    script, with matching V.
  - Records are sorted by magnitude, and Sirius is first.
- **Projection:**
  - Orion's Belt projects in order and near-collinear, at about 1.4° spacing,
    for a camera aimed at Alnilam.
  - Polaris sits 0.6–0.75° from centre for a camera aimed at the pole.
  - The TEME frame matrix moves stars by about 0.37°.
- **Occlusion:** Ground View horizon and nadir; the Moon View Earth disk versus
  a direction 2° off it.
- **Frame matrix:** `src/physics/frames.test.ts` checks orthonormality and
  magnitude; `Sgp4WasmEngine.test.ts` checks agreement with the WASM oracle.
- **Opt-in smoke spec:** `SKY_VISUAL=1 npx playwright test webgpu-sky` boots
  God View and Moon View with `?sky=hip` and checks that the catalog loads and
  the shaders compile. It stores no golden because SwiftShader captures are
  black.

On a real GPU, check:

- Orion and Sirius in God View.
- Crux low in the south from a southern Ground View site.
- Polaris near the pole in Ground View from the north.
