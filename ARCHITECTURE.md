# Grok Zephyr Architecture

## Overview

Grok Zephyr is a Vite + TypeScript WebGPU application that simulates and renders a 1,048,576-satellite constellation in real time. The app keeps orbital state, pattern data, and render targets on the GPU, then drives a multi-pass render pipeline from `src/app/App.ts`.

## Runtime flow

1. `src/main.ts` (thin bootstrap) creates an `OnboardingManager` and an `App` instance, then calls `app.initialize()`.
2. `src/app/App.ts` orchestrates boot: it delegates to `bootWebGPU()` or `bootWebGL()` depending on the resolved backend.
3. `src/core/WebGPUContext.ts` requests a high-performance adapter, enables supported optional features such as `timestamp-query`, validates required limits, and configures the canvas swapchain.
4. `src/app/createGpuResources.ts` allocates the large storage buffers (via `SatelliteGPUBuffer`) and builds the render pipeline (via `RenderPipeline`).
5. `src/render/RenderPipeline.ts` runs compute passes to update positions/beam data, then renders the scene into HDR targets before bloom and final composite.
6. `src/ui/UIManager.ts` reflects view mode, quality, and performance state back into the HUD.

## Source layout

```text
src/
├── main.ts                # Thin bootstrap — creates App, shows onboarding
├── app/                   # Application orchestration (App.ts, FrameLoop, boot, controllers)
├── core/                  # WebGPU init, GPU buffer management, quality presets
├── render/                # Compute + scene + post-process pipeline orchestration
├── camera/                # Horizon, god, fleet, ground, and moon camera logic
├── data/                  # TLE parsing/loading and satellite catalog
├── physics/               # CPU-side orbital propagation helpers
├── shaders/               # WGSL shader sources grouped by domain
├── webgl/                 # WebGL2 fallback renderer (debug/CI; see docs/WEBGL_FALLBACK.md)
├── audio/                 # Audio engine for ambient/sfx
├── capture/               # Screenshot and video capture
├── ui/                    # HUD, onboarding, compatibility check, perf dashboard
├── utils/                 # Math and performance profiling
└── types/                 # Shared TypeScript types and constants
```

`core/OrbitalElements.ts` holds the GPU-agnostic orbital element data and
Keplerian math shared by the WebGPU `SatelliteGPUBuffer` and the WebGL2 fallback,
so both renderers agree on orbit geometry.

## Render pipeline

The main frame flow is a 7-pass HDR pipeline:

1. **Orbital compute pass** – GPU-side Keplerian propagation for 1,048,576 satellites
2. **Beam compute pass** – satellite-to-ground beam direction solve
3. **Scene render pass** – cinematic starfield, Earth (PBR ocean + Fresnel + city lights + animated terminator), atmosphere, satellites, and volumetric beams into `rgba16float` HDR targets
4. **Optional trail pass** – satellite trail accumulation
5. **Bloom threshold pass** – soft-knee luminance extraction (configurable threshold)
6. **Kawase bloom pyramid** – multi-resolution downsample/upsample (2–5 levels) with optional anamorphic horizontal stretch
7. **Composite + post-process pass** – ACES filmic tonemapping, lens effects (chromatic aberration, vignette, starburst, flares), film grain, and final output

Key formats:

- HDR render targets: `rgba16float`
- Depth: `depth24plus`
- Bloom mip pyramid: up to 5 half-size levels (`rgba16float`)
- Presentation/swapchain: `navigator.gpu.getPreferredCanvasFormat()`

## Visual features (2026 Polish Roadmap)

The following systems were implemented as part of the 2026 visual fidelity audit:

### Earth rendering (`src/shaders/render/earth.ts`)

- FBM terrain with height-based biome colouring (beach → grass → forest → rock → snow)
- PBR ocean: Schlick Fresnel reflectance + Blinn-Phong sun glint + Gerstner wave normals animated with `uni.time`
- Animated day/night terminator driven by `uni.sun_pos`
- City lights: coastal- and latitude-weighted FBM density, strictly on the night side with atmospheric falloff
- Polar ice caps
- Subtle surface rotation offset for a living-Earth feel

### Cinematic starfield (`src/shaders/render/stars.ts`)

- Camera-direction sky-ray reconstruction (stars correctly follow camera rotation)
- Magnitude-based HDR brightness distribution (bright foreground stars + faint background layer)
- Realistic colour temperature variation (O/B/A/F/G/K/M spectral classes)
- Milky Way band via galactic-coordinate noise modulation
- Twinkling / scintillation driven by `uni.time` (TAA-friendly)
- Magnitude-capped HDR output: only the brightest stars pierce bloom threshold 1.5; ground view attenuates star energy further

### Bloom pipeline (`src/render/RenderPipeline.ts`, `src/shaders/render/postProcess/`)

- Configurable soft-knee threshold pass
- **Source-aware bloom separation** (single pass, no extra buffers): star HDR is magnitude-capped in `stars.ts`, the threshold pass attenuates mid-band star/limb energy via `sourceBloomWeight()`, and the composite pass layers tight satellite bloom on hot scene peaks vs softer star bloom elsewhere (`compositeBloom(bloom, scene, …)`)
- Kawase dual-filter downsample pyramid (2–5 levels, driven by quality preset)
- 9-tap tent-filter upsample with additive blend
- Optional anamorphic horizontal stretch for Cinematic preset
- `BloomConfig` type exposed through `PostProcessStack`

#### Bloom source separation (stars vs satellites)

Dual bloom buffers were rejected to stay within the ~118 MB Pascal budget. Instead, three single-pass stages cooperate:

| Stage               | File                | Role                                                                                                       |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Star HDR cap        | `stars.ts`          | `starHdrLuminance()` keeps mag > 2 stars sub-threshold; Milky Way luminance-capped; ground view ×0.62      |
| Threshold weighting | `bloomThreshold.ts` | `sourceBloomWeight()` — 36 % extraction for 1.5–4.0 HDR (stars/limb), full above 4.0 (sat cores)           |
| Composite layering  | `composite.ts`      | `compositeBloom(bloom, scene)` — tight gain on scene peaks ≥ 4.2, soft star bloom on moderate scene energy |

WebGL mirrors the threshold and composite curves in `src/webgl/shaders.ts`. No extra render targets or presets required.

### Camera feel (`src/camera/CameraController.ts`)

- God View: velocity + exponential damping (`GOD_INERTIA_DAMPING = 0.88`) for buttery drag momentum
- Smooth blended transitions between all view modes (lerp over 0.6–1.4 s)
- Three cinematic attract/demo paths (horizon drift, god-view spiral, fleet-fly) — any input interrupts immediately
- Optional auto-start after a configurable inactivity timeout

### Lens effects (`src/shaders/lens_effects.wgsl`, `src/render/PostProcessStack.ts`)

- Chromatic aberration (radial RGB split, edge-weighted)
- Anamorphic lens flares with ghost reflections from the sun
- 6-point starburst diffraction
- Vignetting with adjustable intensity, smoothness, and roundness
- All effects individually toggleable via `LensEffectsConfig`; enabled by default on High/Cinematic presets

### HUD / UI (`src/ui/`, `src/styles/`)

- Glassmorphism panels with layered backdrop-filter, neon borders, and inner glows
- Clear sectioning: View Modes | Beam Patterns | Animations | Physics | Quality
- Micro-animations on active states (glow, scale, colour shift)
- Satellite focus inspector: live data panel showing orbital elements, shell, pattern participation
- Constellation statistics overlay
- Cinematic/Demo mode button in the toolbar

### Performance dashboard (`src/ui/PerformanceDashboard.ts`)

- Collapsible perf panel showing per-pass GPU timings (Compute / Scene / Bloom / Post / Total)
- FPS sparkline history
- Quality preset impact hints
- Graceful fallback to CPU timing when `timestamp-query` is unavailable

### First-run experience (`src/ui/`)

- Dismissible intro overlay with premise, scale, and core controls (persisted via `localStorage`)
- Full-screen branded compatibility message for non-WebGPU browsers with actionable next steps
- Basic ARIA labels and visible focus styles on all major interactive elements

### Capture (`src/ui/`)

- One-click PNG screenshot at native and 2× resolution with branded overlay
- Short WebM video clip export via WebCodecs (5 / 10 / 15 s, configurable)
- UI visibility toggle before capture

## Camera modes

| Mode        | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| Horizon 720 | ~720 km altitude looking down on the constellation                |
| God View    | Free-orbit spherical camera with inertia and zoom                 |
| Fleet POV   | First-person view from within the satellite swarm (WASD movement) |
| Ground View | Surface-level observer with full EarthAtmosphereRenderer          |
| Moon View   | Wide-angle view from ~380,000 km                                  |

## Quality presets

| Preset    | Bloom levels | Lens effects  | Anamorphic | TAA |
| --------- | ------------ | ------------- | ---------- | --- |
| Low       | 2            | off           | off        | off |
| Balanced  | 3            | vignette only | off        | on  |
| High      | 4            | CA + vignette | off        | on  |
| Cinematic | 5            | all           | on         | on  |

## WebGPU requirements

The app is tuned for the fixed 1,048,576-satellite mode and validates the adapter before allocating buffers:

- Large storage buffers up to ~32 MB each
- Compute dispatch of `ceil(NUM_SATELLITES / 64)` workgroups
- Optional `timestamp-query` support for GPU profiling

If those requirements are not met, initialization stops with a branded compatibility message instead of attempting partial startup.

## WebGL2 fallback renderer

`?renderer=webgl` boots a self-contained WebGL2 path (`src/webgl/`) instead of the
WebGPU pipeline. It renders the same simulation (starfield → Earth+atmosphere →
satellites → bloom → ACES composite) through a readback-friendly context so agents
and CI can screenshot and inspect the scene. It shares `OrbitalElements` and the
`CameraController`, propagates all 1,048,576 satellites in the vertex shader, and
caps via `?sats=`. Full design, the WGSL→GLSL mapping, and porting notes live in
**`docs/WEBGL_FALLBACK.md`**.

## Data sources

- Default mode procedurally generates a Walker-style constellation
- `?tle=` query parameters can load real TLE groups through `src/data/TLELoader.ts`
- Real TLE sets are padded back up to the fixed GPU fleet size

## Validation

- Build: `npm run build`
- Type check: `npm run type-check`
- Unit tests: `npm run test` (26 test files across core, data, physics, camera, render, shaders, app, webgl)
- Visual regression: `npm run test:visual` (Playwright + SwiftShader, golden PNGs)
- Lint: `npm run lint` (ESLint + Knip)

The unit test suite is in `src/`, colocated with source as `*.test.ts` files, and uses
Vitest. The visual regression suite lives under `tests/visual/` and uses Playwright.

WebGPU rendering cannot be tested in headless CI (no WebGPU support in Node or
Playwright's SwiftShader), so rendering correctness relies on the WebGL2 fallback
(`?renderer=webgl`) which is readback-friendly and tested via Playwright.
