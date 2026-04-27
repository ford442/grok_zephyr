# AGENTS.md - Grok Zephyr / Colossus Fleet

## Project Overview

**Grok Zephyr** (also referred to as **Colossus Fleet**) is a WebGPU-powered orbital simulation featuring 1,048,576 simulated satellites. The project visualizes a massive satellite constellation in Earth orbit at 550km altitude, inspired by the Grok, SpaceX, and Colossus project concepts.

The simulation renders a real-time light show with RGB beam projections from satellites, viewable from multiple camera perspectives including a 720km horizon vantage point, free-floating "God View", first-person "Fleet POV", immersive "Ground View" with environmental overlays, and a distant "Moon View". It also supports interactive beam patterns (CHAOS, GROK, 𝕏 LOGO), constellation animation patterns (SMILE, DIGITAL RAIN, HEARTBEAT), and selectable physics propagation modes.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Graphics API | WebGPU |
| Shading Language | WGSL (WebGPU Shading Language) |
| Frontend | TypeScript 5.3+ |
| Build Tool | Vite 5.0+ |
| Math Utilities | Custom column-major matrix implementation |
| Physics | satellite.js 5.0+ (SGP4 dependency, but GPU propagation is custom Keplerian) |
| Package Manager | npm |
| Deployment | Python 3 + Paramiko (SFTP) |
| Testing | **None currently** — no test framework or test files exist |

## Project Structure

```
grok_zephyr/
├── index.html                    # Main HTML entry point with UI controls
├── package.json                  # npm dependencies and scripts
├── tsconfig.json                 # TypeScript configuration (strict mode)
├── vite.config.ts                # Vite build configuration with custom plugins
├── deploy.py                     # SFTP deployment script (expects dist/ directory)
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
└── src/
    ├── main.ts                   # Application entry point (GrokZephyrApp class)
    ├── styles.css                # Global styles and UI theming
    ├── styles/
    │   └── ground-observer.css   # Ground view overlay styles
    ├── types/
    │   ├── index.ts              # Core TypeScript interfaces and types
    │   ├── constants.ts          # Simulation and rendering constants
    │   ├── shaders.ts            # Shader-related types
    │   └── animation.ts          # Animation, LOD, TAA, post-process types
    ├── core/
    │   ├── WebGPUContext.ts      # WebGPU adapter/device initialization
    │   ├── SatelliteGPUBuffer.ts # GPU buffer management for 1M satellites
    │   ├── SatelliteColorBuffer.ts # Per-satellite color buffer management
    │   └── BlinkTimingModel.ts   # Coherent ground-image blink timing
    ├── render/
    │   ├── RenderPipeline.ts     # Main rendering pipeline orchestration
    │   ├── PostProcessStack.ts   # Post-processing configuration stack
    │   ├── RenderTargets.ts      # HDR, depth, and bloom target management
    │   ├── TrailRenderer.ts      # Satellite trail/ribbon rendering
    │   ├── SmileV2Pipeline.ts    # Smile V2 animation compute pipeline
    │   ├── SmileV2Controller.ts  # Smile V2 animation state controller
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
    │   └── GroundObserverCamera.ts  # Ground view presets and parallax
    ├── ui/
    │   └── UIManager.ts          # HUD updates, control buttons, animation UI
    ├── utils/
    │   ├── math.ts               # 3D math utilities (vectors, matrices)
    │   └── PerformanceProfiler.ts # FPS and timing metrics
    ├── physics/
    │   ├── OrbitalPropagator.ts  # Keplerian propagation (simplified, CPU-side stub)
    │   ├── Propagator.ts         # Advanced propagation (SGP4/J2)
    │   └── index.ts
    ├── data/
    │   ├── ConstellationLoader.ts  # Walker constellation generation
    │   └── TLELoader.ts            # TLE data parsing and loading
    ├── matrix/
    │   ├── ColorMatrix.ts          # RGB projection patterns
    │   └── AnimationEngine.ts      # Animation engine for patterns
    ├── patterns/
    │   └── PatternSequencer.ts     # Pattern sequencing logic
    ├── animations/
    │   ├── SmileV2Controller.ts    # Smile V2 animation controller
    │   ├── SmileV2IntegrationExample.ts # Integration example
    │   └── index.ts
    └── shaders/
        ├── index.ts              # Central shader exports
        ├── uniforms.ts           # Shared uniform struct (TypeScript)
        ├── uniforms.wgsl         # Shared uniform struct (WGSL)
        ├── constellation_optics.wgsl
        ├── orbital_compute.wgsl
        ├── composite.wgsl
        ├── atmosphere.wgsl
        ├── sky_strips_compute.wgsl
        ├── bloom_threshold.wgsl
        ├── earth_atmosphere.wgsl
        ├── satellite_render.wgsl
        ├── satellites_lod.wgsl
        ├── taa.wgsl
        ├── constellation_patterns.wgsl
        ├── stars.wgsl
        ├── lens_effects.wgsl
        ├── bloom_blur.wgsl
        ├── earth_atmosphere_enhanced.wgsl
        ├── projection_billboard.wgsl
        ├── volumetric_beams.wgsl
        ├── earth.wgsl
        ├── satellites.wgsl
        ├── compute/
        │   ├── index.ts          # Compute shader exports
        │   ├── orbital.ts        # Orbital mechanics compute shader
        │   └── beam.ts           # Beam compute shader
        ├── render/
        │   ├── index.ts          # Render shader exports
        │   ├── stars.ts          # Starfield background
        │   ├── earth.ts          # Earth sphere rendering
        │   ├── atmosphere.ts     # Atmospheric limb glow
        │   ├── satellites.ts     # Satellite billboards
        │   ├── beam.ts           # Laser beam rendering
        │   ├── ground.ts         # Ground terrain rendering
        │   └── postProcess/
        │       ├── index.ts      # Post-process shader exports
        │       ├── bloomThreshold.ts
        │       ├── bloomBlur.ts
        │       └── composite.ts  # Final tonemapping
        └── animations/
            ├── index.ts          # Animation shader exports
            ├── smile_v2.wgsl     # Smile V2 compute shader
            ├── smileV2.ts        # Smile V2 shader export
            ├── sky_strips_compute.wgsl
            ├── skyStrips.ts
            ├── digital_rain.wgsl
            ├── fireworks.wgsl
            ├── heartbeat.wgsl
            ├── spiral_galaxy.wgsl
            └── smile.wgsl
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

# Preview production build locally
npm run preview

# Type check without emitting
npm run type-check

# Deploy (builds and prints gh-pages instructions)
npm run deploy
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
const NUM_SATELLITES = 1048576;    // 2^20 satellites
const EARTH_RADIUS_KM = 6371.0;    // km - Earth radius
const ORBIT_RADIUS_KM = 6921.0;    // km - 550km altitude orbit
const CAMERA_RADIUS_KM = 7091.0;   // km - 720km altitude camera
const MOON_DISTANCE_KM = 384400.0; // km - average Earth-Moon distance
const MEAN_MOTION = 0.001097;      // rad/s - orbital angular velocity
const NUM_PLANES = 1024;           // orbital planes
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

| Mode | ID | Description |
|------|-----|-------------|
| 720km Horizon | 0 | Camera at 720km altitude on +X axis, looking along constellation |
| God View | 1 | Orbiting free camera with mouse controls (drag to rotate, scroll to zoom) |
| Fleet POV | 2 | Camera follows satellite #0 in first-person; WASD for micro-drift |
| Ground View | 3 | Surface observer looking up at the constellation; includes environmental overlays |
| Moon View | 4 | Camera positioned at Earth-Moon distance viewing the near-side constellation |

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

**src/main.ts**: Main application class `GrokZephyrApp` that orchestrates:
- WebGPU initialization
- Buffer management
- Render loop
- Camera and UI coordination
- TLE data loading from query parameters
- Pattern/physics/animation mode switching
- Time scale control

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
2. **standalonePlugin**: Generates `grok-zephyr.standalone.html` (single-file build with inlined JS/CSS)

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
- Strict mode enabled with full type checking
- ES2022 target with ESNext modules
- Column-major matrix convention (consistent with WebGPU)
- Custom math utilities (no external 3D math libraries)
- Private methods prefixed with `_` (in some files)
- Explicit return types on public methods

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

## Browser Requirements

- **Chrome** 113+ (recommended)
- **Edge** 113+
- **Firefox Nightly** with WebGPU flag enabled
- **Safari Technology Preview**

WebGPU requires a secure context (HTTPS or localhost).

## Testing

**There are currently no tests in this project.** No test framework (Jest, Vitest, Playwright, etc.) is configured, and no test files exist.

If you add tests, the recommended approach is:
- Use **Vitest** (aligns with the Vite build system)
- Place tests next to source files (`*.test.ts`) or in a `tests/` directory
- Priority test areas:
  1. `src/utils/math.ts` — matrix operations, vector math, frustum extraction
  2. `src/data/TLELoader.ts` — TLE parsing logic
  3. `src/core/SatelliteGPUBuffer.ts` — CPU-side position/velocity calculations
  4. `src/camera/CameraController.ts` — camera state calculations for each view mode

## Deployment

The `deploy.py` script expects a `dist/` directory (created by `npm run build`):

```bash
npm run build
python deploy.py
```

**Security Note**: The deploy script contains hardcoded credentials (username `ford442`, password `GoogleBez12!`, host `1ink.us`) and should be refactored to use environment variables or a separate secrets file.

Target configuration:
- Host: `1ink.us`
- Remote path: `test.1ink.us/zephyr`
- Username: `ford442`

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
5. **No Automated Tests**: The project has no unit tests, integration tests, or end-to-end tests

## Security Considerations

- **deploy.py contains hardcoded credentials** (`GoogleBez12!`) — Must be refactored to use environment variables before any production use
- No sensitive data in frontend code
- WebGPU requires secure context (HTTPS or localhost)

## Development Tips

### Adding New View Modes
1. Add entry to `VIEW_MODES` array in `src/types/constants.ts`
2. Add button to `#controls` div in `index.html`
3. Update `setViewMode()` method in `CameraController.ts`
4. Add camera logic in `calculateCamera()` method
5. Update `estimateVisibleSatellites()` in `main.ts` if needed

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
3. Update `setPatternMode()` in `main.ts` if pattern param semantics change

### Adding New Animation Patterns
1. Create WGSL shader in `src/shaders/animations/`
2. Export from `src/shaders/animations/index.ts`
3. Add UI button in `index.html` under `#animation-controls`
4. Wire up in `UIManager.ts` and `main.ts`

### Ground Observer Development
1. Presets are defined in `GroundObserverCamera.ts`
2. Overlay CSS classes are in `src/styles/ground-observer.css`
3. Preset buttons are in `index.html` inside `#ground-preset-selector`

## File Dependencies Graph

```
main.ts
├── WebGPUContext
├── SatelliteGPUBuffer
├── RenderPipeline
│   ├── shaders/index.ts
│   ├── SmileV2Pipeline
│   ├── PostProcessStack
│   └── RenderTargets
├── CameraController
│   └── utils/math.ts
├── GroundObserverCamera
├── UIManager
├── PerformanceProfiler
├── TLELoader
└── types/constants.ts
```
