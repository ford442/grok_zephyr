# AGENTS.md - Grok Zephyr / Colossus Fleet

## Project Overview

**Grok Zephyr** (also referred to as **Colossus Fleet**) is a WebGPU-powered orbital simulation featuring 1,048,576 simulated satellites. The project visualizes a massive satellite constellation in Earth orbit at 550km altitude, inspired by the Grok, SpaceX, and Colossus project concepts.

The simulation renders a real-time light show with RGB beam projections from satellites, viewable from multiple camera perspectives including a 720km horizon vantage point, free-floating "God View", and first-person "Fleet POV".

## Technology Stack

| Component | Technology |
|-----------|------------|
| Graphics API | WebGPU |
| Shading Language | WGSL (WebGPU Shading Language) |
| Frontend | TypeScript 5.3+ |
| Build Tool | Vite 5.0+ |
| Math Utilities | Custom column-major matrix implementation |
| Physics | Custom Keplerian orbital mechanics (with SGP4 stubs) |
| Package Manager | npm |
| Deployment | Python 3 + Paramiko (SFTP) |

## Project Structure

```
grok_zephyr/
├── index.html                 # Main HTML entry point
├── package.json               # npm dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite build configuration with custom plugins
├── deploy.py                  # SFTP deployment script (expects build/ directory)
├── git.sh                     # Git helper script
├── README.md                  # Brief project description
├── AGENTS.md                  # This file
├── initial_plan.md            # Design documentation and planning
├── SWARM_PROMPT.md            # AI prompt context
├── ARCHITECTURE.md            # Architecture documentation
├── src/
│   ├── main.ts                # Application entry point (GrokZephyrApp class)
│   ├── styles.css             # Global styles and UI theming
│   ├── types/
│   │   ├── index.ts           # Core TypeScript interfaces and types
│   │   ├── constants.ts       # Simulation and rendering constants
│   │   └── shaders.ts         # Shader-related types
│   ├── core/
│   │   ├── WebGPUContext.ts   # WebGPU adapter/device initialization
│   │   └── SatelliteGPUBuffer.ts  # GPU buffer management for 1M satellites
│   ├── render/
│   │   └── RenderPipeline.ts  # 6-pass rendering pipeline
│   ├── camera/
│   │   └── CameraController.ts # View modes and camera math
│   ├── ui/
│   │   └── UIManager.ts       # HUD updates and control buttons
│   ├── utils/
│   │   ├── math.ts            # 3D math utilities (vectors, matrices)
│   │   └── PerformanceProfiler.ts  # FPS and timing metrics
│   ├── physics/
│   │   ├── OrbitalPropagator.ts    # Keplerian propagation
│   │   ├── Propagator.ts           # Advanced propagation (SGP4/J2)
│   │   └── index.ts
│   ├── data/
│   │   ├── ConstellationLoader.ts  # Walker constellation generation
│   │   └── TLELoader.ts            # TLE data parsing
│   ├── matrix/
│   │   └── ColorMatrix.ts          # RGB color management
│   └── shaders/
│       ├── index.ts           # Shader code (WGSL strings)
│       ├── uniforms.wgsl      # Shared uniform struct
│       ├── orbital_compute.wgsl   # Compute shader for positions
│       ├── stars.wgsl         # Starfield background
│       ├── earth.wgsl         # Earth sphere rendering
│       ├── atmosphere.wgsl    # Atmospheric limb glow
│       ├── satellites.wgsl    # Satellite billboards
│       ├── bloom_threshold.wgsl   # Bloom extraction
│       ├── bloom_blur.wgsl    # Gaussian blur
│       └── composite.wgsl     # Final tonemapping
├── public/                    # Static assets
└── dist/                      # Build output (generated)
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (port 5173)
npm run dev

# Build for production
npm run build

# Build standalone single-file version
npm run build:standalone

# Preview production build
npm run preview

# Type check without emitting
npm run type-check
```

## Architecture Details

### Rendering Pipeline (6 Passes)

1. **Compute Pass**: Update 1,048,576 satellite positions via compute shader (16,384 workgroups × 64 threads)
2. **Scene Pass**: Render to HDR texture (stars → Earth → atmosphere → satellites)
3. **Bloom Threshold**: Extract bright pixels to bloom texture
4. **Bloom Horizontal Blur**: Gaussian blur pass
5. **Bloom Vertical Blur**: Gaussian blur pass  
6. **Composite Pass**: Tonemap HDR + bloom to swapchain with ACES approximation

### Simulation Constants

```typescript
const NUM_SATELLITES = 1048576;    // 2^20 satellites
const EARTH_RADIUS_KM = 6371.0;    // km - Earth radius
const ORBIT_RADIUS_KM = 6921.0;    // km - 550km altitude orbit
const CAMERA_RADIUS_KM = 7091.0;   // km - 720km altitude camera
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
[120-123] view_mode:      u32          // View mode index
[124-127] pad0:           u32          // Padding
[128-223] frustum:        array<vec4f,6>  // Frustum planes
[224-231] screen_size:    vec2f        // Screen dimensions
[232-239] pad1:           vec2f        // Padding
```

### View Modes

| Mode | ID | Description |
|------|-----|-------------|
| 720km Horizon | 0 | Camera at 720km altitude on +X axis, looking along constellation |
| God View | 1 | Orbiting free camera with mouse controls (drag to rotate, scroll to zoom) |
| Fleet POV | 2 | Camera follows satellite #0 in first-person |

### Constellation Configuration

The simulation uses a Walker constellation pattern with multiple inclination shells:
- 53° - main Starlink-like shell
- 70° - polar coverage
- 97.6° - sun-synchronous
- 30° - equatorial

## Key Files Reference

### Core Application

**src/main.ts**: Main application class `GrokZephyrApp` that orchestrates:
- WebGPU initialization
- Buffer management
- Render loop
- Camera and UI coordination

**src/core/WebGPUContext.ts**: WebGPU abstraction layer handling:
- Adapter and device creation
- Canvas context configuration
- Buffer creation helpers
- Error handling with `WebGPUError` class

**src/core/SatelliteGPUBuffer.ts**: GPU memory manager for:
- 16MB orbital elements buffer (read-only)
- 16MB position buffer (read-write storage)
- 256-byte uniform buffer
- Double-buffering support (optional)
- CPU-side position calculation for camera tracking

### Rendering

**src/render/RenderPipeline.ts**: Complete rendering system with:
- Pipeline creation for all shader stages
- Render target management (HDR, depth, bloom)
- Bind group setup
- 6-pass encoding methods

### Camera System

**src/camera/CameraController.ts**: Camera management:
- Three view modes with smooth transitions
- God view mouse controls (orbit + zoom)
- Fleet POV satellite tracking
- View-projection matrix calculation

## Vite Configuration Features

The `vite.config.ts` includes two custom plugins:

1. **wgslPlugin**: Handles `.wgsl` file imports as strings with `#import` preprocessing
2. **standalonePlugin**: Generates `grok-zephyr.standalone.html` (single-file build with inlined JS/CSS)

Path aliases configured:
- `@/*` → `src/*`
- `@/shaders/*` → `src/shaders/*`
- `@/core/*` → `src/core/*`
- etc.

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

## Browser Requirements

- **Chrome** 113+ (recommended)
- **Edge** 113+
- **Firefox Nightly** with WebGPU flag enabled
- **Safari Technology Preview**

WebGPU requires a secure context (HTTPS or localhost).

## Deployment

The `deploy.py` script expects a `build/` directory (created by `npm run build`):

```bash
npm run build
python deploy.py
```

**Security Note**: The deploy script contains hardcoded credentials that should be moved to environment variables.

Target configuration:
- Host: `1ink.us`
- Remote path: `test.1ink.us/zephyr`
- Username: `ford442`

## Performance Considerations

- **Compute Shader**: Dispatches 16,384 workgroups for 1M satellites
- **Frustum Culling**: Done in vertex shader to degenerate invisible satellites
- **Distance Culling**: Satellites >14,000km from camera are not rendered
- **HDR Rendering**: Uses `rgba16float` format for intermediate buffers
- **Texture Views**: Cached to avoid `createView()` calls every frame

## Known Limitations and TODOs

1. **TLE Loading**: The TLE parser exists but is not wired into the main simulation
2. **SGP4 Propagation**: Currently using simplified Keplerian mechanics; full SGP4 implementation is stubbed
3. **J2 Perturbations**: Not yet implemented in the compute shader
4. **GPU Timing**: Only works if the browser supports `timestamp-query` feature
5. **Standalone Build**: Creates a single HTML file but requires manual deployment

## Security Considerations

- **deploy.py contains hardcoded credentials** - Should be refactored to use environment variables
- No sensitive data in frontend code
- WebGPU requires secure context (HTTPS or localhost)

## Development Tips

### Adding New View Modes
1. Add entry to `VIEW_MODES` array in `src/types/constants.ts`
2. Add button to `#controls` div in `index.html`
3. Update `setViewMode()` method in `CameraController.ts`
4. Add camera logic in `calculateCamera()` method

### Modifying Orbital Mechanics
- Orbital elements generated in `SatelliteGPUBuffer.generateOrbitalElements()`
- Compute shader in `src/shaders/index.ts` (`ORBITAL_CS`)
- CPU-side position calculation in `calculateSatellitePosition()` for camera tracking

### Shader Development
- Shaders are defined as template literals in `src/shaders/index.ts`
- WGSL files exist in `src/shaders/` but are not directly loaded (future enhancement)
- Check browser console for shader compilation errors

## File Dependencies Graph

```
main.ts
├── WebGPUContext
├── SatelliteGPUBuffer
├── RenderPipeline
│   └── shaders/index.ts
├── CameraController
│   └── utils/math.ts
├── UIManager
├── PerformanceProfiler
└── types/constants.ts
```
