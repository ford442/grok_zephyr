# WebGL2 Fallback Renderer

Grok Zephyr is WebGPU-first: 1,048,576 satellites are propagated on a GPU compute
shader and drawn through a multi-pass HDR pipeline. That output lives in a WebGPU
swapchain that **headless browsers, Playwright, and agents cannot read back**,
which makes automated and visual debugging of orbital geometry, Earth/atmosphere,
glow, and bloom difficult.

The **WebGL2 fallback renderer** renders the *same simulation* through a
readback-friendly WebGL2 path so the scene can be screenshotted and inspected by
CI and agents, and so the project can serve as a working reference when porting
large-scale GPU compute + rendering features.

## Usage

| Action | How |
|--------|-----|
| Use the WebGL2 renderer | `?renderer=webgl` |
| Force WebGPU (default) | `?renderer=webgpu` |
| Persisted choice | Either value is saved to `localStorage['zephyr.renderer']` and used on the next load |
| Reduce satellite count | `&sats=100000` (clamped to `[1, 1048576]`; default is the full constellation) |
| Pick a view mode | `&mode=0..4` (0 horizon, 1 god, 2 fleet, 3 ground, 4 moon) |
| Load real TLE data | `&tle=starlink` (shared with the WebGPU path) |
| Debug flags | `&debug=wireframe,lod,points,noearth,nostars,nobloom,nosats` |
| Image tuning (dev) | `&bloomThreshold=1.8&bloomKnee=0.05&bloomIntensity=1.6&satCore=0.35&satFalloff=0.08` |
| Disable shader floors | `&dev=1` — sliders use the full configured range (no `max(threshold, 1.5)` clamp) |

Example: `http://localhost:5173/?renderer=webgl&cam=god&mode=1&sats=400000&debug=lod&bloomThreshold=1.6`

### Scripting surface (agents / Playwright)

When the WebGL path is active, `window.zephyrGL` is exposed:

```js
window.zephyrGL.getDebug();                 // current debug options
window.zephyrGL.setDebug({ showBloom:false }); // toggle a pass at runtime
window.zephyrGL.capture();                  // PNG data URL of the current canvas
window.zephyrGL.renderer.hdrEnabled;        // true if RGBA16F targets are available
```

`preserveDrawingBuffer` is enabled on the WebGL2 context, so `canvas.toDataURL()`
and `gl.readPixels()` both return the rendered frame.

### Image tuning panel

The **IMAGE TUNING** collapsible section in the controls panel (WebGPU and WebGL)
adjusts bloom threshold, knee, composite intensity, and satellite core radius/falloff
at runtime. Values persist in `localStorage['zephyr.imageTuning']`.

Query params seed the initial session (overriding stored values when present):

Per-view tuning profiles (`src/core/ViewTuningProfile.ts`) override bloom threshold,
knee, intensity, satellite kernel, halo strength, and distance cull per camera mode.
Profiles blend smoothly during mode transitions; the HUD `Tuning` line shows the
active profile. Dev IMAGE TUNING sliders override profiles when moved.

| Param | Range | Default | Maps to |
|-------|-------|---------|---------|
| `bloomThreshold` | 0.5–3.0 | 1.5 | Bloom bright-pass cutoff |
| `bloomKnee` | 0.01–0.3 | 0.05 | Soft knee around threshold |
| `bloomIntensity` | 0–3.0 | 2.25 | Composite bloom multiplier |
| `satCore` | 0.20–0.55 | 0.40 | Satellite `smoothstep` outer edge |
| `satFalloff` | 0.02–0.30 | 0.10 | Satellite `smoothstep` inner edge |
| `dev` | `1` | off | Disables shipping shader floors for full slider range |

An on-screen debug panel (bottom-right, "◈ WEBGL2") mirrors these toggles.

### Visual regression tests (Playwright)

Headless WebGL captures guard against bloom washout, satellite kernel drift, and
other appearance regressions that unit tests cannot see.

```bash
# Install browsers once (Chromium + SwiftShader software GL)
npx playwright install chromium --with-deps

# Run against committed baselines
npm run test:visual

# Regenerate baselines after an intentional visual change
npm run test:visual:update
```

**Harness URL params** (used by `tests/visual/webgl-views.spec.ts`):

| Param | Purpose |
|-------|---------|
| `renderer=webgl` | Boot the readback-friendly path |
| `sats=30000` | Reduced constellation for CI speed |
| `seed=42` | Deterministic Walker shell jitter |
| `demo=0` | Disable auto demo cinematic |
| `simTime=180` | Fixed orbital phase |
| `timescale=0` | Freeze simulation after load |
| `mode=0..4` | View mode (horizon / god / fleet / ground / moon) |
| `ground=houseWindow` | Ground observer preset when `mode=3` |

Each scene captures the canvas via `window.zephyrGL.capture()` after 120 warmup
frames. Assertions combine:

1. **Golden PNG** comparison (`tests/visual/baselines/*.png`) with a per-scene
   pixel-diff ceiling tolerant of SwiftShader noise.
2. **Mean luminance** and **bright-pixel ratio** bands (`*.json` sidecars) so bloom
   floor removal or alpha falloff widening fails even when pixels differ slightly.

A dedicated **bloom pass guard** toggles `showBloom` off via `window.zephyrGL.setDebug`
and asserts mid-tone energy drops — proving the bloom stack is active. Shipping
appearance (threshold floors, satellite kernel) is guarded by the golden baselines.

CI runs `npm run test:visual` on every push/PR (`.github/workflows/test.yml`)
using Chromium with `--use-angle=swiftshader`.

## What is shared vs. reimplemented

**Shared (single source of truth):**
- Orbital element data + Keplerian math — `src/core/OrbitalElements.ts`. Both the
  WebGPU `SatelliteGPUBuffer` and the WebGL renderer use this; there is no second
  copy of the orbit generation, TLE parsing, or position/velocity formulae.
- Camera — `CameraController` (`calculateCamera`, `buildViewProjection`) drives
  both backends, so all five view modes and the idle cinematic behave identically.
- Earth geometry — `genSphere()` from `src/utils/math.ts`.

**Reimplemented in GLSL ES 3.00** (`src/webgl/shaders.ts`):
- Satellite billboards, Earth + atmosphere, starfield, bloom, ACES tonemap + grade.
- Distance-based satellite LOD kernels (near / mid / far) match `src/shaders/render/satellites.ts`.

**Not (yet) ported to WebGL:** volumetric god-ray beams, ribbon trails, TAA,
motion blur, depth-of-field, and the J2 / RK4 physics modes. The WebGL path uses
the *simple-mode* circular propagation only. These are intentionally WebGPU-only;
the WebGL renderer is a reference/inspection tool, not a feature-parity clone.

## Architecture

```
main.ts (GrokZephyrApp)
  ├─ backend = resolveRendererBackend()          // ?renderer / localStorage
  ├─ initialize()
  │     └─ backend === 'webgl' → initializeWebGL()  (skips all WebGPU setup)
  └─ renderWebGL()  loop → WebGLRenderer.renderFrame(frame)

src/webgl/
  rendererSelection.ts  backend + ?sats resolution
  glUtils.ts            context, program compile/link, FBO/texture helpers
  shaders.ts            GLSL ES 3.00 sources (mirror of the WGSL passes)
  WebGLRenderer.ts      orchestrator: starfield → Earth → satellites → bloom → composite
  WebGLDebug.ts         ?debug parsing, on-screen panel, window.zephyrGL
```

### Per-frame data flow

`renderWebGL` reuses the exact WebGPU frame setup (timing, demo cinematic, camera
state) and passes a compact `WebGLFrame` to the renderer:

```ts
{ viewProj, cameraPos, sunDir, simTime, time, backgroundMode }
```

`viewProj` is the column-major matrix from `CameraController.buildViewProjection`,
used directly as a GLSL `mat4` (`uniformMatrix4fv(loc, false, m)`).

### The "simplified compute fallback"

The WGSL compute pass (`orbital_compute.wgsl`) writes a position buffer that the
satellite vertex shader reads. WebGL2 has no compute shaders, so the WebGL path
**moves the simple-mode propagation into the satellite vertex shader**. Orbital
elements `(raan, inclination, meanAnomaly0, shellData)` are uploaded once as a
per-vertex attribute; each `GL_POINTS` vertex computes its own position:

```glsl
M   = meanAnomaly0 + meanMotion(shell) * uSimTime;
pos = orbitR(shell) * rotate(raan, inclination, M);
```

This keeps the full 1,048,576-satellite set entirely on the GPU with **zero
per-frame CPU work** — `gl.drawArrays(GL_POINTS, 0, count)` in a single call. The
formula is identical to `OrbitalElements.calculatePosition()`; an invariant test
(`OrbitalElements.test.ts`) asserts every satellite stays on its shell radius.

## Porting notes: WebGL2 reference → WebGPU compute at scale

When using this WebGL path as a reference for a WebGPU port (or vice-versa):

| Concern | WebGL2 (fallback) | WebGPU (production) |
|---------|-------------------|---------------------|
| Propagation | per-vertex in the vertex shader | compute shader → storage buffer, read by the vertex shader |
| Per-instance data | vertex attribute (`vertexAttribPointer`) or a data texture sampled by `gl_VertexID`/`gl_InstanceID` | `storage` buffer indexed by `instance_index` |
| Draw | `drawArrays(POINTS, 0, N)` (1 call) | `draw(6, N)` instanced billboards |
| HDR target | `RGBA16F` via `EXT_color_buffer_float` (falls back to `RGBA8`) | native `rgba16float` |
| Frustum cull / LOD | in the vertex shader or on CPU | in the compute pass (writes visibility into position.w) |
| Bloom | threshold + 2× separable Gaussian (half-res) | Kawase dual-filter pyramid (up to 5 levels) |

Rule of thumb: anything WebGPU does in a **compute dispatch over a storage
buffer** maps to either a WebGL **vertex-shader computation over an instanced
attribute** (when each output is consumed by exactly one draw vertex) or a
**transform-feedback / data-texture** pass (when outputs must be read back or
shared across passes). Prototype geometry and shading bugs in WebGL2 where you
can `readPixels`, then port the validated math into WGSL.
