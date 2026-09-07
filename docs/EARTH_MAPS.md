# Earth photometric maps

The Earth surface is procedural FBM by default. `?earthmap=` swaps in a
photometric plate — Blue Marble albedo, VIIRS night lights and a MODIS cloud
sheet — sampled in the same body frame the FBM terrain uses, so continents sit
still under a GMST-rotating Earth (see [FRAMES.md](FRAMES.md)).

Textures are **opt-in**. With no `?earthmap=` the shader takes its original
path and renders the same pixels as before, which is what keeps the default
visual-regression URL on procedural Earth and sky.

## URL

| Value | Albedo | Night lights | Clouds |
| --- | --- | --- | --- |
| *(absent)* / `off` / `proc` | — | — | — |
| `low` | 1K | — | — |
| `balanced` | 2K | 1K | — |
| `high` / `cinematic` | 4K | 2K | 2K |
| `on` / `auto` | tier from `?preset=` (low → low, balanced → balanced, high/cinematic → high) |

`?earth=proc` also forces procedural. It does **not** collide with `?earth=0|1`,
which is the unrelated GMST rotation switch.

The WebGL2 fallback renderer (`?renderer=webgl`) is procedural only.

## Assets

`public/earth/*.ktx2`, built by `scripts/build-earth-maps.sh` from NASA sources
(provenance in `public/earth/README.md`). 2.3 MB committed for all six files.

Encoded as **ETC1S** (Basis LZ supercompression), transcoded at load to whatever
the adapter supports. ETC1S rather than UASTC on size: 2K albedo is 352 KB
against 2.2 MB for UASTC, at 32.8 dB PSNR — the difference is not visible at any
altitude the camera reaches, and UASTC would have put ~9 MB of binaries in the
repo.

Transcoding uses `public/basis/basis_transcoder.{js,wasm}` (Binomial, Apache-2.0,
585 KB) — the container parser and transcoder in one, so there is no separate
KTX2 parsing dependency and nothing new in `package.json`.

## Format selection

| Adapter feature | Transcode target | GPU format |
| --- | --- | --- |
| `texture-compression-bc` | BC7 M5 | `bc7-rgba-unorm-srgb` |
| `texture-compression-astc` | ASTC 4x4 | `astc-4x4-unorm-srgb` |
| `texture-compression-etc2` | ETC2 RGBA | `etc2-rgba8unorm-srgb` |
| none | RGBA32 | `rgba8unorm-srgb` |

Those three features are requested **only** when `?earthmap=` selects a tier.
Device features are frozen at creation, so `bootWebGPU` resolves the tier from
the URL before `requestDevice` — they cannot be added when the first `.ktx2`
arrives. See `REQUESTED_OPTIONAL_FEATURES` in `src/core/GpuCapabilities.ts`.

On an adapter with no block format the tier is clamped to the 1K albedo and 1K
lights and the cloud sheet is dropped, so an uncompressed 4K plate never
happens.

## Memory

Mip chains stop at 4x4 — a 2:1 equirect reaches height 2 before width 4, which
no block format can hold. Totals include mips.

| Tier | Compressed (BC7 / ASTC / ETC2) | Uncompressed fallback (after clamping) |
| --- | --- | --- |
| `low` | 0.67 MB | 2.7 MB |
| `balanced` | 3.3 MB | 5.3 MB |
| `high` | 16.0 MB | 5.3 MB |

This is texture memory and is **separate from** the satellite storage-buffer
budget — the plates take nothing from it. `[EarthTextures]` logs the tier, the
chosen format and the measured total at boot.

## Shading

`src/shaders/render/earthMapCommon.ts` holds the `@group(1)` block — sampler,
three plates, a settings uniform and `equirectUV` — and is included by both the
orbital Earth shader and the Ground View horizon shader, so the two sample one
set of textures rather than inventing a second Earth.

The bindings are always present — unloaded slots hold a 1x1 placeholder and
`earthMaps.flags` is 0 — so there is one earth pipeline rather than a textured
and a procedural variant, and the cached scene render bundle is recorded once. Plates are loaded before the bind groups are built, so nothing
has to be invalidated for a late texture swap.

- **Albedo** replaces the biome FBM. The ocean mask is derived from the plate
  (open water is where blue clearly dominates) rather than shipping a fourth
  texture; it drives the existing Gerstner/Fresnel ocean, which keeps its glint
  and now takes its base water color from the plate's bathymetry.
- **Night lights** replace `cityLightEmission`, squared to push the DNB
  composite's airglow floor down while keeping city cores bright, multiplied by
  the same night-side term. Without a night plate (the `low` tier) the FBM city
  lights stay on.
- **Clouds** replace `cloudNoise()` and scroll in longitude from `sim_time`, so
  motion is visible at any time scale. The existing coverage, forward-scatter
  edge and twilight-fade treatment is unchanged.

Equirect sampling uses `textureSampleGrad` with seam-corrected derivatives: `u`
jumps 1 → 0 at the antimeridian, and the raw `dpdx` there would select the
coarsest mip and draw a blurred line down the Pacific.

### Ground View

`src/shaders/render/ground.ts` samples the same albedo and night plates at
grazing incidence, blended in by ray distance (`smoothstep(30, 500, t) * 0.8`).
A 4K equirect texel is ~10 km, so near the observer the FBM keeps supplying the
detail the horizon view exists to show, while far ground reads as real
geography. It uses `textureSampleLevel` with a distance-derived LOD rather than
derivatives: the sampling sits inside the ray-hit branch, which is not uniform
control flow.

## Rebuilding

```sh
# KTX-Software >= 4.4 and ImageMagick on PATH
scripts/build-earth-maps.sh
```
