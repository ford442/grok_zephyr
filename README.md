# 🚀 Grok Zephyr

**A blazing-fast WebGPU orbital simulation engine for visualizing constellations of 1M+ satellites in real-time.**

Grok Zephyr is a cutting-edge web application that brings large-scale satellite constellation visualization to your browser. Built with WebGPU and TypeScript, it provides stunning interactive views of orbital mechanics, real-time satellite tracking, and beautiful planetary rendering—all with exceptional performance.

## ✨ What Makes This Special

- **Million-Satellite Scale**: Render and simulate 1,000,000+ satellites in real-time using GPU-accelerated compute shaders
- **WebGPU First**: Modern, performant graphics API that puts the power of the GPU directly in your browser
- **Multiple View Modes**: Experience satellites from the ground horizon, as a god-like observer, or from the perspective of a satellite itself
- **Orbital Mechanics**: SGP4 (`satellite.js`) anchors real TLE orbits on CPU; GPU propagates osculating Keplerian elements. Art-directed Walker shells available via the Orbit Realism toggle.
- **Beautiful Visuals**: Includes Earth rendering, atmospheric glow effects, starfield backgrounds, and post-processing bloom effects
- **Zero Installation**: Runs directly in the browser—no native clients or heavy downloads required
- **Production Ready**: Modular TypeScript architecture designed for maintainability and extensibility

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18.0.0 or later
- A modern browser with WebGPU support (Chrome/Edge 113+, or Firefox Nightly)

### Installation & Running

```bash
# Clone and install dependencies
npm install

# Start development server with hot reload
npm run dev

# Open your browser to http://localhost:5173
```

## 📦 Build & Deployment

```bash
# Development: Hot reload, source maps, full TypeScript checking
npm run dev

# Production: Optimized build with minification (outputs to dist/)
npm run build

# Preview: Test production build locally
npm run preview

# Standalone: Single-file HTML build (experimental)
npm run build:standalone

# Type checking: Verify TypeScript correctness
npm run type-check

# Lint: ESLint + Knip (same checks as CI)
npm run lint
```

### GitHub Pages (production)

The live demo is published automatically by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. **Push to `main`** — after the [Test](.github/workflows/test.yml) workflow succeeds, the Deploy workflow builds `dist/` and publishes it to GitHub Pages.
2. **Manual deploy** — in the repo on GitHub, open **Actions → Deploy → Run workflow**.

**One-time repo setup** (maintainers):

1. **Settings → Pages → Build and deployment** — set **Source** to **GitHub Actions**.
2. After the first successful deploy, the site URL appears on the Pages settings screen (typically `https://<org-or-user>.github.io/<repo>/`).

The Vite build uses `base: './'`, so asset paths work on GitHub Pages without extra configuration. `public/.nojekyll` disables Jekyll processing for the uploaded artifact.

To verify a production build locally before merging:

```bash
npm run build && npm run preview
```

## 🎮 Usage & Features

### Camera Controls

The simulation offers three distinct viewing experiences:

1. **Horizon View (Default)** - Positioned 720km above Earth's surface for a realistic atmosphere-layer perspective
2. **God View** - Free-floating camera with mouse controls for exploring the entire orbital system
3. **Fleet POV** - First-person perspective from a satellite's viewpoint

### Interactive Elements

- Real-time satellite tracking with TLE data loading
- Performance monitoring with FPS counter and GPU metrics
- Responsive UI for camera switching and simulation control
- Visual feedback for orbital elements and satellite positions

## 🏗️ Architecture

This project uses a modular, well-organized TypeScript architecture:

```
src/
├── core/              # GPU context and buffer management
├── render/            # 6-pass rendering pipeline (compute, scene, bloom, composite)
├── camera/            # Multiple camera view modes
├── physics/           # Orbital mechanics and propagation
├── shaders/           # WGSL compute and fragment shaders
├── ui/                # Interactive HUD and controls
└── utils/             # Math, performance profiling, and helpers
```

Full architecture details are documented in [ARCHITECTURE.md](./ARCHITECTURE.md).

## 🛠️ Tech Stack

- **Language**: TypeScript 5.3+ (strict mode)
- **Graphics API**: WebGPU with WGSL shaders
- **Build Tool**: Vite 5.0+ (lightning-fast builds)
- **Physics**: satellite.js 5.0+ (SGP4 CPU anchor → GPU Keplerian propagation)
- **Styling**: Modern CSS with responsive design

## 📊 Performance

Grok Zephyr is optimized for high-performance visualization:

- **GPU-Accelerated Compute**: Orbital propagation runs entirely on GPU
- **Efficient Rendering**: 6-pass pipeline with frustum culling and distance-based LOD
- **Memory-Optimized**: Double-buffered GPU storage for 1M+ satellites
- **FPS Monitoring**: Built-in performance profiler with moving averages

Typical performance on modern GPUs:

- 1M satellites: 60+ FPS
- Bloom post-processing: Real-time at 1080p+
- GPU queries: Sub-millisecond per frame

## 🌐 Browser Compatibility

| Browser         | Status          | Notes                             |
| --------------- | --------------- | --------------------------------- |
| Chrome 113+     | ✅ Full Support | Best performance and stability    |
| Edge 113+       | ✅ Full Support | Chromium-based, same as Chrome    |
| Firefox Nightly | ⚠️ Experimental | WebGPU flag required              |
| Safari          | ⏳ Coming Soon  | WebGPU implementation in progress |

**Important**: WebGPU requires a secure context (HTTPS or localhost). Most features require dedicated GPU hardware.

### Renderer backends (WebGPU + WebGL2 fallback)

The app is WebGPU-first but ships a **toggleable WebGL2 fallback renderer** for
debugging, CI, and agent/Playwright inspection (WebGPU output cannot be read back
in headless browsers).

| Goal                   | URL                                                  |
| ---------------------- | ---------------------------------------------------- |
| WebGL2 renderer        | `?renderer=webgl`                                    |
| WebGPU (default)       | `?renderer=webgpu`                                   |
| Reduce satellite count | `?renderer=webgl&sats=100000`                        |
| Debug helpers          | `?renderer=webgl&debug=wireframe,lod,points,nobloom` |

The choice persists in `localStorage['zephyr.renderer']`. When the WebGL path is
active, `window.zephyrGL` exposes `setDebug()`, `getDebug()`, and `capture()` for
scripted inspection. The WebGL path **shares** the orbital data + Keplerian math
(`src/core/OrbitalElements.ts`) and the camera with the WebGPU path, propagating
all 1,048,576 satellites in the vertex shader. See
**[docs/WEBGL_FALLBACK.md](./docs/WEBGL_FALLBACK.md)** for details, the WGSL→GLSL
mapping, and WebGL→WebGPU porting notes for large-scale simulations.

### WebGPU feature and fallback notes

- `timestamp-query` is requested when the adapter supports it, which enables GPU timing in `PerformanceProfiler`
- The app validates critical adapter limits up front before allocating the 1,048,576-satellite storage buffers
- If the browser or GPU cannot satisfy the required buffer/workgroup limits, the app now fails fast with an on-page compatibility message instead of continuing into a broken initialization path
- Resize is handled both by an explicit `window.resize` listener and a render-loop safety check to catch DPR/layout changes

### Current validation status

- `npm run build` is the main verified repository validation command today
- There is currently no dedicated automated WebGPU test suite in the repository yet

## 📝 Data & Configuration

The project includes sample Starlink TLE (Two-Line Element) data in `/public/tle/`. Load a catalog with `?tle=starlink` (or any CelesTrak shorthand / direct URL). Toggle orbit realism in the UI (**ORBIT REALISM → SGP4**) or via `?realism=1`:

- **SHELLS** (default): art-directed Walker shells — the cinematic 1M-satellite look
- **SGP4**: CPU SGP4 (`satellite.js`) anchors osculating Keplerian elements; the GPU compute shader propagates real catalog orbits and re-anchors periodically to bound drift

You can also:

- Replace with real TLE data from space-track.org
- Implement custom data loaders for different formats
- Create visualizations for any satellite constellation

## 🎨 Customization

### Easy Wins

- Modify colors in shader files (`.wgsl`)
- Adjust camera parameters in `CameraController.ts`
- Configure performance thresholds in `PerformanceProfiler.ts`
- Customize UI layout in `UIManager.ts`

### Advanced Extensions

- Implement additional view modes
- Add satellite filtering and search
- Create timeline scrubbing for historical data
- Export visualizations to video formats
- Integrate with live orbital prediction APIs

## 📚 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Detailed system design and module descriptions
- **[docs/WEBGL_FALLBACK.md](./docs/WEBGL_FALLBACK.md)** - WebGL2 fallback renderer, usage, and WebGL→WebGPU porting notes
- **[AGENTS.md](./AGENTS.md)** - AI agent configurations and swarm logic
- **[SWARM_PROMPT.md](./SWARM_PROMPT.md)** - Multi-agent collaboration specifications
- **[initial_plan.md](./initial_plan.md)** - Project genesis and design decisions
- **[update_plan.md](./update_plan.md)** - Recent updates and roadmap

## 🤝 Contributing

This is an active project with exciting opportunities for contribution:

- **Bug Reports**: Found an issue? Open a GitHub issue with reproduction steps
- **Feature Requests**: Have an idea? We'd love to hear it
- **Performance Improvements**: Help us optimize rendering and computation
- **Documentation**: Improve guides, examples, and inline comments
- **New Features**: Implement view modes, data sources, or analysis tools

### Labels & Issue Organization

We maintain a comprehensive label system for organizing issues and PRs. See [LABELS.md](./LABELS.md) for details on our label categories, colors, and usage guidelines. Labels help us track:

- Visual upgrades and rendering work
- Performance improvements
- Accessibility enhancements
- Priority levels (P0, P1, P2)
- Area-specific work (camera, UI, UX, etc.)

## 📄 License

See LICENSE file for details.

## 🙏 Acknowledgments

- Inspired by the Grok platform and SpaceX's Colossus vision
- Built on WebGPU specifications and modern web standards
- Uses satellite.js for accurate orbital mechanics

---

**Ready to explore the cosmos?** Start with `npm run dev` and discover what's possible! 🌌
