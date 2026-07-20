<!-- From: /root/grok_zephyr/AGENTS.md -->

# AGENTS.md - Grok Zephyr / Colossus Fleet

## Project Overview

**Grok Zephyr** (also referred to as **Colossus Fleet**) is a WebGPU-powered orbital simulation featuring 1,048,576 simulated satellites. The project visualizes a massive satellite constellation in Earth orbit at 550 km altitude, inspired by the Grok, SpaceX, and Colossus project concepts.

The simulation renders a real-time light show with RGB beam projections from satellites, viewable from multiple camera perspectives including a 720 km horizon vantage point, free-floating "God View", first-person "Fleet POV", immersive "Ground View" with environmental overlays, and a distant "Moon View". It also supports interactive beam patterns (CHAOS, GROK, 𝕏 LOGO), constellation animation patterns (SMILE, DIGITAL RAIN, HEARTBEAT), and selectable physics propagation modes.

## Technology Stack

| Component        | Technology                                                                   |
| ---------------- | ---------------------------------------------------------------------------- |
| Graphics API     | WebGPU                                                                       |
| Shading Language | WGSL (WebGPU Shading Language)                                               |
| Frontend         | TypeScript 5.9+                                                              |
| Build Tool       | Vite 5.0+                                                                    |
| Math Utilities   | Custom column-major matrix implementation                                    |
| Physics          | satellite.js 5.0+ (fallback) + Vallado SGP4 WASM (`native/` → `public/sgp4.wasm`) |
| Package Manager  | npm                                                                          |
| Deployment       | Python 3 + Paramiko (SFTP)                                                   |
| Testing          | Vitest (`npm run test`) with initial coverage for math + TLE parsing         |

## Project Structure

```
grok_zephyr/
├── index.html                    # Main HTML entry point with UI controls
├── package.json                  # npm dependencies and scripts
├── tsconfig.json                 # TypeScript configuration (strict mode)
├── vite.config.ts                # Vite build configuration with custom plugins
├── git.sh                        # Git helper script
├── README.md                     # Human-readable project description
├── AGENTS.md                     # This file
├── ARCHITECTURE.md               # Architecture documentation
├── initial_plan.md               # Design documentation and planning
├── update_plan.md                # Recent updates and roadmap
├── SWARM_PROMPT.md               # AI prompt context
├── demo-ground-observer.html     # Ground observer demo page
├── scripts/
│   └── build-standalone.ts       # Standalone HTML build script
├── public/
│   └── tle/
│       └── starlink_sample.txt   # Sample Starlink TLE data
├── dist/                         # Build output (generated)
├── tests/
│   └── visual/                   # Visual regression baselines (Playwright)
└── src/
    ├── main.ts                   # Thin bootstrap — application lifecycle lives in src/app/App.ts
    ├── styles.css                # Global styles and UI theming
    ├── styles/
    │   ├── ground-observer.css   # Ground view overlay styles
    │   └── onboarding.css       # First-run onboarding styles
    ├── types/
    │   ├── index.ts              # Core TypeScript interfaces and types
    │   ├── constants.ts          # Simulation and rendering constants
    │   ├── shaders.ts            # Shader-related types
    │   └── animation.ts          # Animation, LOD, TAA, post-process types
    ├── app/
    │   ├── App.ts                # Application orchestrator (GrokZephyrApp)
    │   ├── AppRuntime.ts         # Runtime interface shared across modules
    │   ├── AppCallbackBinder.ts  # UI/event callback binding
    │   ├── FrameLoop.ts          # Render loop start/stop and frame state
    │   ├── bootWebGPU.ts         # WebGPU backend initialization
    │   ├── bootWebGL.ts          # WebGL backend initialization
    │   ├── createGpuResources.ts # GPU buffer/pipeline creation
    │   ├── destroyGpuResources.ts# GPU resource teardown
    │   ├── SimClock.ts           # Simulation clock with rate scaling
    │   ├── SimulationState.ts    # Central simulation state
    │   ├── ViewModeCoordinator.ts# View mode and tuning coordination
    │   ├── PatternController.ts  # Beam/animation/physics pattern routing
    │   ├── QualityController.ts  # Quality preset application
    │   ├── RealismController.ts  # Realism mode toggle
    │   ├── UniformWriter.ts      # Uniform buffer write orchestration
    │   ├── UrlState.ts           # URL query parameter state
    │   ├── SatelliteSelection.ts # Screen-space satellite picking
    │   ├── GroundObserverUI.ts   # Ground observer overlay updates
    │   ├── MobilePresentation.ts # Mobile viewport/orientation handling
    │   └── SkylineDisplayController.ts # Skyline city display control
    ├── core/
    │   ├── WebGPUContext.ts      # WebGPU adapter/device initialization
    │   ├── WebGPUErrorReporter.ts# Structured GPU error reporting
    │   ├── SatelliteGPUBuffer.ts # GPU buffer management for 1M satellites
    │   ├── OrbitalElements.ts    # GPU-agnostic orbital element data
    │   ├── QualityPresets.ts     # Quality level definitions
    │   ├── ExposureRuntime.ts    # HDR exposure settings persistence
    │   ├── HdrPresentation.ts    # HDR presentation utilities
    │   ├── EarthGeometry.ts      # Earth sphere geometry generation
    │   ├── AnimationTuning.ts    # Animation tuning profiles
    │   ├── BeamPatternProfile.ts # Beam pattern profiles
    │   ├── ImageTuning.ts        # Image tuning constants
    │   ├── ViewTuningProfile.ts  # View-specific tuning
    │   └── seededRandom.ts       # Deterministic random utilities
    ├── render/
    │   ├── RenderPipeline.ts     # Main rendering pipeline orchestration
    │   ├── PostProcessStack.ts   # Post-processing configuration stack
    │   ├── RenderTargets.ts      # HDR, depth, and bloom target management
    │   ├── TrailRenderer.ts      # Satellite trail/ribbon rendering
    │   ├── SkylineCity.ts        # City skyline rendering
    │   ├── SmileV2Pipeline.ts    # Smile V2 animation compute pipeline
    │   ├── passes/
    │   │   └── index.ts          # Render pass helpers
    │   └── pipelines/
    │       ├── index.ts          # Pipeline exports
    │       ├── types.ts          # Pipeline type definitions
    │       ├── ComputePipeline.ts    # Compute pipeline creation
    │       ├── ScenePipelines.ts     # Scene render pipelines
    │       ├── EffectPipelines.ts    # Effect render pipelines
    │       └── PostProcessPipelines.ts # Bloom/composite pipelines
    ├── camera/
    │   ├── CameraController.ts      # View modes and camera math
    │   ├── GroundObserverCamera.ts  # Ground view presets and parallax
    │   ├── FleetCockpit.ts          # Fleet POV cockpit overlay
    │   ├── GodFraming.ts            # God view framing helpers
    │   ├── HorizonLimb.ts           # Horizon limb calculations
    │   └── groundPresetEffects.ts   # Ground preset visual effects
    ├── audio/
    │   └── AudioEngine.ts        # Audio engine for ambient/sfx
    ├── capture/
    │   └── CaptureManager.ts     # Screenshot/video capture
    ├── ui/
    │   ├── UIManager.ts          # HUD updates, control buttons, animation UI
    │   ├── OnboardingManager.ts  # First-run onboarding overlay
    │   ├── PerformanceDashboard.ts # GPU/CPU perf panel
    │   ├── WebGPUCompatibilityManager.ts # Browser support check
    │   ├── timeScaleControl.ts   # Time scale UI integration
    │   ├── uiManagerSetup.ts     # UI setup helpers
    │   └── uiTypes.ts            # UI-specific types
    ├── utils/
    │   ├── math.ts               # 3D math utilities (vectors, matrices)
    │   └── PerformanceProfiler.ts # FPS and timing metrics
    ├── physics/
    │   ├── TlePropagator.ts      # SGP4 CPU anchor (WASM Vallado + satellite.js fallback)
    │   ├── Sgp4WasmEngine.ts     # Emscripten batch API wrapper (public/sgp4.wasm)
    │   ├── keplerianFromState.ts # ECI → Keplerian for GPU extended elements
    │   └── index.ts
    ├── data/
    │   ├── ConstellationLoader.ts  # Walker constellation generation
    │   ├── TLELoader.ts            # TLE data parsing and loading
    │   ├── SatelliteCatalog.ts     # Satellite catalog management
    │   ├── TLESource.ts            # CelesTrak URL resolution
    │   └── TLESource.test.ts
    ├── background.ts             # Background utilities
    ├── earth.ts                  # Earth rendering helpers
    ├── focus.ts                  # Satellite focus/inspection manager
    ├── patterns.ts               # Pattern definitions and control
    ├── visualHarness.ts          # Playwright visual test harness
    └── shaders/
        ├── index.ts              # Central shader exports (canonical runtime WGSL)
        ├── uniforms.ts           # Shared uniform struct (TypeScript)
        ├── uniforms.wgsl         # Legacy include stub (not used at runtime)
        ├── compute/
        │   ├── index.ts          # Compute shader exports
        │   ├── orbital.ts        # Orbital mechanics compute shader
        │   └── beam.ts           # Beam compute shader
        ├── render/
        │   ├── index.ts          # Render shader exports
        │   ├── stars.ts          # Starfield background
        │   ├── earth.ts          # Earth sphere rendering
        │   ├── atmosphere.ts     # Atmospheric limb glow
        │   ├── satellites.ts     # Satellite billboards (canonical sharp kernel)
        │   ├── beam.ts           # Laser beam rendering
        │   ├── ground.ts         # Ground terrain rendering
        │   ├── volumetricBeams.ts
        │   └── postProcess/
        │       ├── index.ts      # Post-process shader exports
        │       ├── bloomThreshold.ts  # Bloom extraction (canonical)
        │       ├── bloomBlur.ts
        │       └── composite.ts  # Final tonemapping
        └── animations/
            ├── index.ts          # Animation shader exports
            ├── smileV2.ts        # Smile V2 compute shader (canonical)
            ├── skyStrips.ts
            └── *.wgsl            # Archival animation shaders (not imported at runtime)
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (port 5173)
npm run dev

# Build for production (outputs to dist/)
npm run build

# Build standalone single-file version (grok-zephyr.standalone.html)
npm run build:standalone

# Build Vallado SGP4 WASM module (public/sgp4.wasm + public/sgp4.js)
npm run build:wasm

# Preview production build locally
npm run preview

# Type check without emitting
npm run type-check

# Lint (ESLint + Knip)
npm run lint
```

## Architecture Details

### Rendering Pipeline (7+ Passes)

The frame is rendered through the following passes:

1. **Compute Pass**: Update 1,048,576 satellite positions via compute shader (16,384 workgroups × 64 threads)
2. **Beam Compute Pass**: Compute laser beam start/end positions based on beam pattern mode
3. **Smile V2 Compute (optional)**: Run constellation animation pattern compute if an animation is active
4. **Scene Pass**: Render to HDR texture
   - Ground View uses `encodeGroundScenePass` with terrain rendering
   - Other views use `encodeScenePass` (stars → Earth → atmosphere → satellites → beams)
5. **Bloom Threshold**: Extract bright pixels to bloom texture
6. **Bloom Horizontal Blur**: Gaussian blur pass
7. **Bloom Vertical Blur**: Gaussian blur pass
8. **Composite Pass**: Tonemap HDR + bloom to swapchain with ACES approximation

### Simulation Constants

```typescript
const NUM_SATELLITES = 1048576; // 2^20 satellites
const EARTH_RADIUS_KM = 6371.0; // km - Earth radius
const ORBIT_RADIUS_KM = 6921.0; // km - 550km altitude orbit
const CAMERA_RADIUS_KM = 7091.0; // km - 720km altitude camera
const MOON_DISTANCE_KM = 384400.0; // km - average Earth-Moon distance
const MEAN_MOTION = 0.001097; // rad/s - orbital angular velocity
const NUM_PLANES = 1024; // orbital planes
const SATELLITES_PER_PLANE = 1024; // satellites per plane
```

### Uniform Buffer Layout (256 bytes)

```
[0-63]    view_proj:      mat4x4f      // View-projection matrix
[64-79]   camera_pos:     vec4f        // Camera position
[80-95]   camera_right:   vec4f        // Camera right vector
[96-111]  camera_up:      vec4f        // Camera up vector
[112-115] time:           f32          // Simulation time
[116-119] delta_time:     f32          // Frame delta time
[120-123] view_flags:     u32          // Packed: view_mode (bits 0-15), is_ground_view (bit 16), physics_mode (bits 17-19)
[124-127] sim_time:       f32          // Scaled simulation time
[128-223] frustum:        array<vec4f,6>  // Frustum planes
[224-231] screen_size:    vec2f        // Screen dimensions
[232-235] time_scale:     f32          // Simulation time multiplier (1x - 100000x)
[236-239] pad0:           u32          // Padding
[240-255] sun_position:   vec4f        // Sun position in ECI frame
```

### View Modes

| Mode          | ID  | Description                                                                       |
| ------------- | --- | --------------------------------------------------------------------------------- |
| 720km Horizon | 0   | Camera at 720km altitude on +X axis, looking along constellation                  |
| God View      | 1   | Orbiting free camera with mouse controls (drag to rotate, scroll to zoom)         |
| Fleet POV     | 2   | Camera follows satellite #0 in first-person; WASD for micro-drift                 |
| Ground View   | 3   | Surface observer looking up at the constellation; includes environmental overlays |
| Moon View     | 4   | Camera positioned at Earth-Moon distance viewing the near-side constellation      |

### Ground Observer Presets

When in Ground View, the following presets are available via UI buttons:

- **House** (`houseWindow`) — View from a house window
- **Car** (`carWindshield`) — View from a car windshield
- **Beach** (`beachNight`) — Night beach perspective
- **Rooftop** (`rooftop`) — Urban rooftop view
- **Airplane** (`airplaneWindow`) — View from an airplane window

Each preset applies a different CSS overlay class to `#ground-observer-overlay`.

### Beam Patterns

Controlled by the "BEAM PATTERN" UI buttons:

- **CHAOS** (`0`) — Random/unstructured beam pattern
- **GROK** (`1`) — Grok-branded structured pattern (default)
- **𝕏 LOGO** (`2`) — X logo projection pattern

### Animation Patterns

Controlled by the "CONSTELLATION PATTERNS" UI buttons:

- **SMILE** (`3`) — Smile face constellation animation
- **DIGITAL RAIN** (`4`) — Matrix-style digital rain effect
- **HEARTBEAT** (`5`) — Pulsing heartbeat pattern

### Physics Modes

Controlled by the "PHYSICS MODE" UI buttons:

- **Simple** (`0`) — Basic circular orbits (implemented)
- **Keplerian** (`1`) — Elliptical orbits with mean anomaly (implemented)
- **J2 Perturbed** (`2`) — Oblateness corrections (UI placeholder; not fully implemented in compute shader)

### Constellation Configuration

The default procedural mode uses a Walker constellation pattern with multiple inclination shells:

- 53° — main Starlink-like shell
- 70° — polar coverage
- 97.6° — sun-synchronous
- 30° — equatorial

## Key Files Reference

### Core Application

**src/main.ts**: Thin bootstrap — mounts `OnboardingManager`, instantiates `App`, and wires
the `beforeunload` teardown. All application lifecycle (WebGPU/WebGL init, frame loop,
camera, UI, TLE loading, pattern/physics/animation control) lives in **`src/app/App.ts`** and
its satellite modules (`FrameLoop.ts`, `bootWebGPU.ts`, `bootWebGL.ts`, `SimClock.ts`, etc.).
**src/main.ts**: Thin bootstrap that creates an `OnboardingManager` and an `App`
instance, exposes `App` (aliased as `GrokZephyrApp`) as the default export, and
attaches it to `window.zephyr` for debugging. The main application lifecycle
lives in `src/app/App.ts`.

**src/app/App.ts**: Application orchestrator (`App` class, exported as `GrokZephyrApp`) that:

- WebGPU/WebGL backend initialization and boot
- GPU buffer and pipeline resource creation
- Render loop start/stop via `FrameLoop`
- Camera, UI, audio, and profiler coordination
- TLE data loading from query parameters
- Pattern/physics/animation mode routing
- Time scale and quality preset control
- Device loss recovery and error handling

**src/core/WebGPUContext.ts**: WebGPU abstraction layer handling:

- Adapter and device creation
- Canvas context configuration
- Buffer creation helpers
- Error handling with `WebGPUError` class

**src/core/SatelliteGPUBuffer.ts**: GPU memory manager for:

- 16MB orbital elements buffer (read-only)
- 32MB extended elements buffer (for J2 propagation)
- 16MB position buffer (read-write storage)
- 256-byte uniform buffer
- 4MB per-satellite color buffer (rgba8unorm packed)
- 16MB pattern buffer (Sky Strips)
- 2MB beam data buffer (64k beams)
- 32MB trail buffer (2 frames)
- Various uniform buffers for bloom, beams, patterns, Smile V2
- Double-buffered staging uploads (zero CPU stall)
- Total ~118 MB (under Pascal 128 MB safe limit)

### Rendering

**src/render/RenderPipeline.ts**: Complete rendering system with:

- Pipeline creation for all shader stages
- Render target management (HDR, depth, bloom)
- Bind group setup
- Pass encoding methods (compute, scene, ground, bloom, composite)

**src/render/SmileV2Pipeline.ts**: Smile V2 animation compute pipeline.

**src/render/TrailRenderer.ts**: Satellite trail ribbon rendering.

### Camera System

**src/camera/CameraController.ts**: Camera management:

- Five view modes with smooth transitions
- God view mouse controls (orbit + zoom)
- Fleet POV satellite tracking with WASD micro-movement
- Ground and Moon view camera math
- View-projection matrix calculation

**src/camera/GroundObserverCamera.ts**: Ground view presets and parallax updates.

### Shader Organization

Shaders are organized into three domains under `src/shaders/`:

- **compute/** — Compute shaders (orbital mechanics, beams)
- **render/** — Render shaders (stars, Earth, atmosphere, satellites, ground, post-process)
- **animations/** — Animation shaders (Smile V2, Sky Strips, digital rain, heartbeat, etc.)

The central export is `src/shaders/index.ts` which exposes `SHADERS.compute`, `SHADERS.render`, and `SHADERS.animations`. Legacy flat exports are deprecated but remain for backward compatibility.

## Vite Configuration Features

The `vite.config.ts` includes two custom plugins:

1. **wgslPlugin**: Handles `.wgsl` file imports as strings with `#import` preprocessing
2. **standalonePlugin**: Generates `grok-zephyr.standalone.html` (single-file build with inlined JS/CSS) when `mode === 'standalone'` (triggered by `npm run build:standalone`)

Path aliases configured:

- `@/*` → `src/*`
- `@/shaders/*` → `src/shaders/*`
- `@/core/*` → `src/core/*`
- `@/render/*` → `src/render/*`
- `@/camera/*` → `src/camera/*`
- `@/matrix/*` → `src/matrix/*`
- `@/ui/*` → `src/ui/*`
- `@/utils/*` → `src/utils/*`
- `@/types/*` → `src/types/*`
- `@/physics/*` → `src/physics/*`

## Code Style Guidelines

### TypeScript

- Strict mode enabled with full type checking (`strict: true`)
- `noUnusedLocals` and `noUnusedParameters` are enforced
- `noFallthroughCasesInSwitch` is enforced
- ES2022 target with ESNext modules
- Module resolution: `bundler`
- Column-major matrix convention (consistent with WebGPU)
- Custom math utilities (no external 3D math libraries)
- Private methods prefixed with `_` (in some files)
- Explicit return types on public methods
- Import paths use `.js` extensions (e.g., `@/core/WebGPUContext.js`) — Vite resolves these to `.ts` source files

### Naming Conventions

- Classes: `PascalCase`
- Methods/Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`
- File names: `PascalCase.ts` for classes, `camelCase.ts` for utilities

### WGSL Shaders

- Uniform struct shared across shaders via string concatenation
- Workgroup size of 64 for compute shaders
- Explicit binding layouts with proper visibility flags
- Shaders are organized in domain subdirectories (`compute/`, `render/`, `animations/`)
- The Vite WGSL plugin supports `#import "relative/path.wgsl"` for shader includes

## Browser Requirements

- **Chrome** 113+ (recommended)
- **Edge** 113+
- **Firefox Nightly** with WebGPU flag enabled
- **Safari Technology Preview**

WebGPU requires a secure context (HTTPS or localhost).

## Renderer Backends (WebGPU + WebGL2 fallback)

The app is WebGPU-first but ships a **toggleable WebGL2 fallback renderer**. Use
it whenever you need to _see_ what the simulation renders — WebGPU output is not
readable in headless Chromium, but the WebGL2 canvas is (`gl.readPixels` /
`canvas.toDataURL` work; `preserveDrawingBuffer` is on).

- Activate: `?renderer=webgl` (persists in `localStorage['zephyr.renderer']`).
- Reduce load: `?renderer=webgl&sats=100000` (default = full 1,048,576).
- Debug flags: `?renderer=webgl&debug=wireframe,lod,points,noearth,nostars,nobloom,nosats`.
- Scripting: `window.zephyrGL.{getDebug,setDebug,capture}()` for Playwright/agents.

The WebGL path **shares** simulation state with WebGPU — orbital data + Keplerian
math live in `src/core/OrbitalElements.ts` (used by both `SatelliteGPUBuffer` and
the WebGL renderer), and the `CameraController` drives both. Satellite propagation
runs in the GLSL vertex shader (the "simplified compute fallback" for
`orbital_compute.wgsl`). Not ported to WebGL: volumetric beams, trails, TAA,
motion blur, DoF, and J2/RK4 physics. Full details, the WGSL→GLSL uniform mapping,
and WebGL→WebGPU porting notes are in **`docs/WEBGL_FALLBACK.md`**.

WebGL module layout: `src/webgl/{rendererSelection,glUtils,shaders,WebGLRenderer,WebGLDebug,SatellitePickerGL}.ts`.
Integration points in `src/app/App.ts` and `src/app/bootWebGL.ts`.

## WASM SGP4 Engine

Vallado reference SGP4 is compiled to `public/sgp4.wasm` via Emscripten (`npm run build:wasm`).
Prebuilt artifacts are committed; CI rebuilds on `native/**` changes (`.github/workflows/build-wasm.yml`).

- **Runtime**: `TlePropagator` loads WASM when available; falls back to `satellite.js` on failure.
- **Batch API**: `propagateBatchEci()` / `applyKeplerianBatch()` feed GPU extended-element re-anchoring.
- **Benchmark**: Performance dashboard shows WASM vs JS speedup after TLE catalog load.
- **Tests**: `Sgp4WasmEngine.test.ts` checks 1e-3 km agreement over 24h; `Sgp4Benchmark.test.ts` checks speedup.

## Testing

The project uses **Vitest** (Node environment) with colocated `*.test.ts` files. There are currently **26 unit test files** (plus visual regression tests) covering modules across the codebase:

**Math & Utilities:**
- `src/utils/math.test.ts` — matrix/vector operations, frustum extraction

**Core:**
- `src/core/OrbitalElements.test.ts` — Keplerian propagation invariants
- `src/core/AnimationTuning.test.ts` — animation tuning profiles
- `src/core/BeamPatternProfile.test.ts` — beam pattern data validation
- `src/core/HdrPresentation.test.ts` — HDR presentation utilities
- `src/core/ImageTuning.test.ts` — image tuning constants
- `src/core/ViewTuningProfile.test.ts` — view tuning profile resolution
- `src/core/WebGPUErrorReporter.test.ts` — error reporter formatting

**Data:**
- `src/data/TLELoader.test.ts` — TLE parsing and fetch handling
- `src/data/TLESource.test.ts` — CelesTrak URL resolution
- `src/data/TLESource.resolve.test.ts` — TLE source resolution
- `src/data/SatelliteCatalog.test.ts` — catalog management

**Physics:**
- `src/physics/Sgp4WasmEngine.test.ts` — WASM SGP4 accuracy (1e-3 km @ 24h)
- `src/physics/Sgp4Benchmark.test.ts` — WASM vs JS speedup
- `src/physics/TlePropagator.test.ts` — propagator orchestration
- `src/physics/keplerianFromState.test.ts` — ECI to Keplerian conversion

**Camera:**
- `src/camera/FleetCockpit.test.ts` — Fleet POV cockpit logic
- `src/camera/GodFraming.test.ts` — God view framing
- `src/camera/HorizonLimb.test.ts` — horizon limb calculations
- `src/camera/groundPresetEffects.test.ts` — ground preset effects

**App:**
- `src/app/SimClock.test.ts` — simulation clock
- `src/app/SimClock.url.test.ts` — clock URL state sync

**Render:**
- `src/render/SkylineCity.test.ts` — city skyline rendering

**Shaders:**
- `src/shaders/shaderSources.test.ts` — shader source validation

**WebGL:**
- `src/webgl/rendererSelection.test.ts` — backend + `?sats` + `?debug` resolution

**Visual regression** — `npm run test:visual` (Playwright + SwiftShader, golden PNGs under `tests/visual/baselines/`)

**Harness:**
- `src/visualHarness.test.ts` — Playwright harness URL param parsing

## Deployment

Production hosting uses **GitHub Pages** via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

- **Automatic**: merge to `main` → [Test](.github/workflows/test.yml) runs → on success, Deploy builds `dist/` and publishes.
- **Manual**: GitHub **Actions → Deploy → Run workflow**.
- **Prerequisite**: repo **Settings → Pages → Source** must be **GitHub Actions**.

Local production verification:

```bash
npm run build && npm run preview
```

## Performance Considerations

- **Compute Shader**: Dispatches 16,384 workgroups for 1M satellites
- **Frustum Culling**: Done in vertex shader to degenerate invisible satellites
- **Distance Culling**: Satellites >150,000km from camera are not rendered (increased for Ground/Moon views)
- **HDR Rendering**: Uses `rgba16float` format for intermediate buffers
- **Texture Views**: Cached to avoid `createView()` calls every frame
- **Pascal Safety**: Total GPU buffer footprint is kept under ~118 MB (128 MB safe limit) through tight packing (rgba8unorm colors, compact extended elements, reduced trail frames)

## TLE Mode (Real Satellite Data)

The simulation supports loading real Two-Line Element (TLE) data as an alternative to the default procedural Walker constellation.

### Activation

Add a `?tle=` query parameter to the URL:

```
# CelesTrak shorthand names:
https://your-host/?tle=starlink     # ~6,000 Starlink satellites
https://your-host/?tle=oneweb       # OneWeb constellation
https://your-host/?tle=gps          # GPS operational satellites
https://your-host/?tle=active       # All active satellites (~8,000+)

# Direct URL to any 3-line TLE text file:
https://your-host/?tle=https://example.com/my-satellites.tle
```

Without `?tle=`, the default procedural Walker constellation is used.

### Supported CelesTrak Shorthands

`starlink`, `oneweb`, `iridium`, `iridium-next`, `gps`, `galileo`, `stations`, `active`

### Data Flow: TLE Input → GPU Orbital Elements

```
URL ?tle=starlink
  → TLELoader.fromFile(sourceUrl)               [src/data/TLELoader.ts]
    → fetch() 3-line TLE text
    → TLELoader.parse() → TLEData[]
  → SatelliteGPUBuffer.loadFromTLEData(tles)    [src/core/SatelliteGPUBuffer.ts]
    → For each TLE: parse line2 fixed-width columns
      → Extract: inclination, RAAN, mean anomaly (deg → rad)
      → Derive altitude from mean motion: a = (μ/n²)^(1/3)
      → Classify into shell 0/1/2 by altitude bracket
      → Pack into vec4f: [raan, inc, M, (shell<<8)|colorIdx]
    → Fill remaining slots (up to 1,048,576) with procedural Walker data
  → uploadOrbitalElements() → GPU read-only storage buffer
  → Compute shader propagates all 1M positions per frame (same as procedural)
```

### Padding Behavior

Real TLE counts (~6K) are much smaller than the 1,048,576 buffer. Remaining slots are filled deterministically with Walker satellites. The HUD displays the data source, e.g. "Source: TLE (6,142 real)".

### Fallback

If TLE fetch/parse fails (network error, CORS, invalid format), the app logs a warning and falls back to procedural generation. Startup is never blocked.

### Caveats

- **Scale**: Real constellations have ~6K sats vs 1M procedural. Padded sats use the standard Walker pattern.
- **Accuracy**: TLEs are propagated with the same simplified circular Keplerian model. Full SGP4 in compute shader is not yet implemented.
- **Epoch**: Simulation uses wall-clock elapsed time, not UTC. Positions drift from reality over time.
- **CORS**: CelesTrak allows cross-origin. Custom URLs need CORS headers.

## Known Limitations and TODOs

1. **SGP4 Propagation**: Currently using simplified Keplerian mechanics in the compute shader; full GPU SGP4 implementation is stubbed
2. **J2 Perturbations**: UI exists but compute shader implementation is incomplete
3. **GPU Timing**: Only works if the browser supports `timestamp-query` feature
4. **Standalone Build**: Creates a single HTML file but requires manual deployment
5. ~~**No Automated Tests**~~: The project now has **139 Vitest unit tests** (`npm run test`) covering math utilities, TLE parsing, orbital elements, WebGL renderer selection, and the visual harness, plus Playwright visual regression tests (`npm run test:visual`).

## Security Considerations

- No sensitive credentials in frontend code or deploy scripts
- WebGPU requires secure context (HTTPS or localhost)

## Development Tips

### Adding New View Modes

1. Add entry to `VIEW_MODES` array in `src/types/constants.ts`
2. Add button to `#controls` div in `index.html`
3. Update `setViewMode()` method in `CameraController.ts`
4. Add camera logic in `calculateCamera()` method
5. Update `estimateVisibleSatellites()` in `src/app/App.ts` if needed

### Modifying Orbital Mechanics

- Orbital elements generated in `SatelliteGPUBuffer.generateOrbitalElements()`
- Compute shader in `src/shaders/compute/orbital.ts`
- CPU-side position calculation in `calculateSatellitePosition()` for camera tracking

### Shader Development

- Shaders are defined in domain subdirectories under `src/shaders/`
- Entry point is `src/shaders/index.ts` which exports `SHADERS.compute`, `SHADERS.render`, and `SHADERS.animations`
- Check browser console for shader compilation errors
- The Vite WGSL plugin supports `#import "relative/path.wgsl"` for shader includes

### Adding New Beam Patterns

1. Update the beam compute shader in `src/shaders/compute/beam.ts`
2. Add UI button in `index.html` with `data-pattern` attribute
3. Update `setPatternMode()` in `src/app/PatternController.ts` if pattern param semantics change

### Adding New Animation Patterns

1. Create WGSL shader in `src/shaders/animations/`
2. Export from `src/shaders/animations/index.ts`
3. Add UI button in `index.html` under `#animation-controls`
4. Wire up in `UIManager.ts` and `src/app/PatternController.ts`

### Ground Observer Development

1. Presets are defined in `GroundObserverCamera.ts`
2. Overlay CSS classes are in `src/styles/ground-observer.css`
3. Preset buttons are in `index.html` inside `#ground-preset-selector`

## File Dependencies Graph

```
main.ts (thin bootstrap)
└── App (src/app/App.ts)
    ├── bootWebGPU / bootWebGL
    │   ├── WebGPUContext
    │   └── WebGPUCompatibilityManager
    ├── createGpuResources / destroyGpuResources
    │   ├── SatelliteGPUBuffer
    │   ├── RenderPipeline
    │   │   ├── shaders/index.ts
    │   │   ├── SmileV2Pipeline
    │   │   ├── PostProcessStack
    │   │   └── RenderTargets
    │   └── SkylineCity
    ├── FrameLoop (render loop)
    │   ├── UniformWriter
    │   └── TrailRenderer
    ├── CameraController
    │   └── utils/math.ts
    ├── GroundObserverCamera
    ├── UIManager
    │   ├── OnboardingManager
    │   ├── PerformanceDashboard
    │   └── timeScaleControl
    ├── PerformanceProfiler
    ├── AudioEngine
    ├── TLELoader / SatelliteCatalog / TLESource
    ├── PatternController
    ├── QualityController
    ├── RealismController
    ├── ViewModeCoordinator
    ├── SimClock / SimulationState
    ├── SatelliteSelection
    ├── MobilePresentation
    └── types/constants.ts
```

## Cursor Cloud specific instructions

### Running / verifying the WebGPU renderer in the cloud VM

Chrome here ships a SwiftShader Vulkan ICD, so the WebGPU path runs under software rendering. Launch Chrome with `--enable-unsafe-webgpu --enable-features=Vulkan --use-webgpu-adapter=swiftshader` (plus `--headless=new --no-sandbox --disable-gpu-sandbox --user-data-dir=/tmp/<unique>` for scripted runs). The default URL (no `?renderer=`) uses WebGPU; `?renderer=webgl` selects the readable WebGL2 fallback.

Key caveat: WebGPU **offscreen rendering + compute work** in this VM, but **on-screen canvas presentation does NOT** — the GPU process cannot allocate the swapchain shared image (`SharedImageStub: Unable to create shared image`), so the device is lost (`reason=destroyed`) on the first `getCurrentTexture()`/present and the app enters its device-loss recovery loop. This reproduces with a trivial WebGPU canvas, so it is an environment limitation, not an app bug (presentation works on real GPUs). To verify the WebGPU renderer here, look for `[GrokZephyr] Initialization complete` in the console (full shader/pipeline init) rather than expecting a visible canvas; to capture actual WebGPU pixels, read back an offscreen target (e.g. the composite-intermediate texture) instead of presenting. For quick visual inspection, use `?renderer=webgl`.
