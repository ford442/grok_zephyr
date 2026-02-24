# AGENTS.md - Grok Zephyr / Colossus Fleet

## Project Overview

**Grok Zephyr** (also referred to as **Colossus Fleet**) is a WebGPU-powered orbital simulation featuring 1,048,576 simulated satellites. The project visualizes a massive satellite constellation in Earth orbit, inspired by the Grok, SpaceX, and Colossus project concepts.

The simulation renders a real-time light show with RGB beam projections from satellites orbiting at 550km altitude, viewable from multiple camera perspectives including a 720km horizon vantage point.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Graphics API | WebGPU |
| Shading Language | WGSL (WebGPU Shading Language) |
| Frontend | Vanilla HTML5 + JavaScript (ES6+) |
| Math Utilities | Custom column-major matrix implementation |
| Deployment | Python 3 + Paramiko (SFTP) |

## Project Structure

```
grok_zephyr/
├── index.html          # Main simulation (~1200 lines, single-file application)
├── deploy.py           # SFTP deployment script
├── git.sh              # Git helper script (add, commit, push)
├── initial_plan.md     # Design documentation and planning
├── README.md           # Brief project description
└── AGENTS.md           # This file
```

**Note**: This is a single-file application. All shaders, math utilities, and rendering logic are contained within `index.html`.

## Key Files

### index.html
The main application file containing:
- **WGSL Shaders**: Compute shader for orbital mechanics, vertex/fragment shaders for rendering
- **JavaScript Classes**: `ColossusSimulation` - main simulation controller
- **Math Utilities**: Custom 3D math (vectors, matrices, frustum extraction)
- **UI Elements**: Fixed-position UI overlay with stats and view mode buttons

### deploy.py
Python deployment script that uploads the `build/` directory to a remote server via SFTP.
- Target: `test.1ink.us/zephyr`
- Requires: `paramiko` library
- Expects a `build/` directory to exist before deployment

## Architecture

### Rendering Pipeline (6 Passes)

1. **Compute Pass**: Update 1,048,576 satellite positions via compute shader
2. **Scene Pass**: Render to HDR texture (stars → Earth → atmosphere → satellites)
3. **Bloom Threshold**: Extract bright pixels to bloom texture
4. **Bloom Horizontal Blur**: Gaussian blur pass
5. **Bloom Vertical Blur**: Gaussian blur pass  
6. **Composite Pass**: Tonemap HDR + bloom to swapchain

### Shader Modules

| Shader | Purpose |
|--------|---------|
| `ORBITAL_CS` | Compute shader: updates satellite positions using Keplerian orbital mechanics |
| `STARS_SHADER` | Fullscreen starfield background |
| `EARTH_SHADER` | Earth sphere with procedural land/ocean and city lights |
| `ATM_SHADER` | Atmospheric limb glow (additive blend) |
| `SAT_SHADER` | Satellite billboards with distance attenuation and color patterns |
| `BLOOM_THRESHOLD_SHADER` | Extract bright pixels for bloom effect |
| `BLOOM_BLUR_SHADER` | Separable Gaussian blur (H/V passes) |
| `COMPOSITE_SHADER` | Final tonemapping with ACES approximation |

### Buffer Layout

```
Uniform Buffer (256 bytes):
  [0-63]    view_proj:      mat4x4f
  [64-79]   camera_pos:     vec4f
  [80-95]   camera_right:   vec4f
  [96-111]  camera_up:      vec4f
  [112-115] time:           f32
  [116-119] delta_time:     f32
  [120-123] view_mode:      u32
  [124-127] pad0:           u32
  [128-223] frustum:        array<vec4f,6>
  [224-231] screen_size:    vec2f
  [232-239] pad1:           vec2f
```

## Simulation Constants

```javascript
const NUM_SAT       = 1048576;   // 2^20 satellites
const EARTH_R       = 6371.0;    // km - Earth radius
const ORBIT_R       = 6921.0;    // km - 550km altitude orbit
const CAM_R         = 7091.0;    // km - 720km altitude camera
const MEAN_MOTION   = 0.001097;  // rad/s - orbital angular velocity
const NUM_PLANES    = 1024;      // orbital planes
const SAT_PER_PLANE = 1024;      // satellites per plane
```

## View Modes

| Mode | ID | Description |
|------|-----|-------------|
| 720km Horizon | 0 | Camera at 720km altitude on +X axis, looking along constellation |
| God View | 1 | Orbiting free camera with mouse controls |
| Fleet POV | 2 | Camera follows satellite #0 in first-person |

## Running the Project

### Local Development

Since this is a static HTML file with no build step:

```bash
# Option 1: Python HTTP server
python -m http.server 8080

# Option 2: Node.js http-server
npx http-server -p 8080

# Option 3: VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

Then open `http://localhost:8080/index.html` in a WebGPU-enabled browser.

### Browser Requirements

- **Chrome** 113+ (recommended)
- **Edge** 113+
- **Firefox Nightly** with WebGPU flag enabled
- **Safari Technology Preview**

### Deployment

The `deploy.py` script expects a `build/` directory:

```bash
# Create build directory and copy files
mkdir -p build
cp index.html build/

# Deploy via SFTP
python deploy.py
```

**Note**: The deploy script contains hardcoded credentials that should be moved to environment variables for security.

## Code Style Guidelines

### JavaScript
- Uses ES6+ features (const, let, arrow functions, template literals)
- `'use strict'` mode enabled
- Column-major matrix convention (consistent with WebGPU)
- Custom math utilities (no external libraries)

### WGSL
- Structured binding layouts with explicit offsets
- Workgroup size of 64 for compute shaders
- Uniform struct shared across shaders via string concatenation

### Naming Conventions
- Constants: `UPPER_SNAKE_CASE`
- Classes: `PascalCase`
- Methods/Variables: `camelCase`
- Private methods: `_leadingUnderscore`
- Shaders: `UPPER_SNAKE_CASE` constants containing WGSL strings

## Performance Considerations

- **Compute Shader**: Dispatches 16,384 workgroups (64 threads each) for 1M satellites
- **Frustum Culling**: Done in vertex shader to degenerate invisible satellites
- **Distance Culling**: Satellites >14,000km from camera are not rendered
- **HDR Rendering**: Uses `rgba16float` format for intermediate buffers
- **Texture Views**: Cached to avoid `createView()` calls every frame

## Security Considerations

- **deploy.py contains hardcoded credentials** - Should be refactored to use environment variables
- No sensitive data in `index.html`
- WebGPU requires secure context (HTTPS or localhost)

## Development Notes

### Adding New View Modes
1. Add button to `#controls` div in HTML
2. Update `setView()` method in `ColossusSimulation` class
3. Add camera logic in `_writeUniforms()` method

### Modifying Orbital Mechanics
- Orbital elements generated in `genOrbitalElements()`
- Compute shader `ORBITAL_CS` updates positions
- CPU-side position calculation in `cpuSatPos()` for camera tracking

### Shader Hot-Reloading
Since shaders are embedded as strings, modifications require page refresh. For development:
1. Edit WGSL string constants in `index.html`
2. Refresh browser
3. Check browser console for shader compilation errors

## Known Limitations

- Single-file architecture limits modularity
- No TypeScript type checking
- No automated testing
- Hardcoded deployment credentials
- No CI/CD pipeline configured
