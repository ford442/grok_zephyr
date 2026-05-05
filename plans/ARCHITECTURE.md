# Grok Zephyr - Modular Architecture

## Project Structure

```
grok_zephyr/
├── index.html                    # Entry HTML (updated)
├── package.json                  # Vite + TypeScript build scripts
├── vite.config.ts                # Vite config with WGSL loader
├── tsconfig.json                 # Strict TypeScript configuration
├── scripts/
│   └── build-standalone.ts       # Standalone HTML build script
├── public/
│   ├── tle/
│   │   └── starlink_sample.txt   # Sample Starlink TLE data
│   └── textures/                 # (for future texture assets)
└── src/
    ├── main.ts                   # Application entry point
    ├── styles.css                # Main stylesheet
    ├── types/
    │   ├── index.ts              # Shared TypeScript interfaces
    │   └── constants.ts          # Simulation constants
    ├── core/
    │   ├── WebGPUContext.ts      # GPU initialization & management
    │   └── SatelliteGPUBuffer.ts # Buffer management for 1M satellites
    ├── render/
    │   └── RenderPipeline.ts     # 6-pass render pipeline
    ├── camera/
    │   └── CameraController.ts   # View mode controllers
    ├── ui/
    │   └── UIManager.ts          # HUD & controls
    ├── utils/
    │   ├── math.ts               # 3D math utilities
    │   └── PerformanceProfiler.ts # FPS & performance tracking
    ├── shaders/
    │   ├── uniforms.wgsl         # Shared uniform struct
    │   ├── orbital_compute.wgsl  # Orbital mechanics compute
    │   ├── stars.wgsl            # Starfield background
    │   ├── earth.wgsl            # Earth sphere
    │   ├── atmosphere.wgsl       # Atmospheric limb glow
    │   ├── satellites.wgsl       # Satellite billboards
    │   ├── bloom_threshold.wgsl  # Bloom extraction
    │   ├── bloom_blur.wgsl       # Gaussian blur
    │   ├── composite.wgsl        # Tonemapping composite
    │   └── index.ts              # Shader exports
    ├── physics/
    │   └── OrbitalPropagator.ts  # Placeholder for SGP4
    ├── data/
    │   └── TLELoader.ts          # TLE data loader
    └── matrix/
        └── ColorMatrix.ts        # RGB projection patterns
```

## Key Features

### Build System
- **Vite** for fast development and optimized production builds
- **TypeScript** with strict type checking
- **WGSL loader** plugin for importing shader files as strings
- **Standalone build** mode to generate single-file HTML

### Core Infrastructure
- **WebGPUContext**: Adapter/device initialization with proper limits for 1M satellites
- **SatelliteGPUBuffer**: Double-buffered GPU storage for orbital elements and positions
- **RenderPipeline**: 6-pass rendering (compute → scene → bloom → composite)

### Camera System
Three view modes:
1. **720km Horizon** - Camera at 720km altitude (default)
2. **God View** - Orbiting free camera with mouse controls
3. **Fleet POV** - First-person satellite view

### Performance
- **PerformanceProfiler**: FPS counter with moving average
- **GPU timestamp queries** (when supported)
- **Frustum culling** in vertex shader
- **Distance-based LOD** for satellites

## Build Commands

```bash
# Development server
npm run dev

# Production build
npm run build

# Standalone single-file build
npm run build:standalone

# Type checking
npm run type-check

# Preview production build
npm run preview
```

## WebGPU Requirements

- Chrome 113+ or Edge 113+
- Firefox Nightly with WebGPU flag
- Secure context (HTTPS or localhost)

## Migration from Single-File

The original `index.html` (~1,200 lines) has been refactored into:
- Modular TypeScript classes
- Separate WGSL shader files
- Type-safe interfaces
- Maintainable architecture

The original `index.html` is preserved for reference.
