# WebXR (Immersive VR)

Standing among the constellation via WebXR. **Stage 3 presents the WebGPU frame graph** through `XRGPUBinding` when the browser has it, so you keep Keplerian/J2, ISL, volumetric beams and trails. When the browser has no binding, VR falls back to **Stage 2 on the WebGL2 renderer** (`?renderer=webgl`).

## Requirements

- A browser with WebXR (`navigator.xr`) and `immersive-vr` support, such as Quest Browser or Chrome with a WebXR emulator
- A secure context (HTTPS or localhost)
- **WebGPU path (default renderer):** the UA must expose `XRGPUBinding`, the WebXR/WebGPU interop that Chrome may still keep behind a flag or origin trial. Detection is a hard runtime check, `typeof XRGPUBinding === 'function'`.
- **WebGL fallback:** `?renderer=webgl`, or `localStorage['zephyr.renderer'] = 'webgl'`
- Optional: lower the load on low-end headsets with `&sats=200000`

## Entering VR

1. Open the app. The default renderer is WebGPU. For the fallback, add `?renderer=webgl`.
2. When immersive-vr is supported, an **ENTER VR** button appears next to the cinematic controls.
3. Click **ENTER VR**. The UA requires a user gesture.
4. Look around from the default **720 km horizon** anchor.
5. **Exit** through the headset system UI or the button, which reads **EXIT VR** while a session is active.

The button's state:

| Renderer | `XRGPUBinding` | Button |
|----------|----------------|--------|
| WebGPU | present, xrCompatible adapter | enabled (WebGPU stereo) |
| WebGPU | missing, or `?xr=0` | disabled, with a tooltip that points at `?renderer=webgl` |
| WebGL | any | enabled (WebGL stereo, Stage 2) |

## Comfort anchors (no smooth locomotion)

Snap points only, to avoid locomotion sickness. These work the same on both backends:

| Input | Action |
|-------|--------|
| Controller trigger / button 0–1 | Cycle to next anchor |
| `[` / `PageUp` | Previous anchor |
| `]` / `PageDown` | Next anchor |
| `1` | Horizon 720 km |
| `2` | GEO overview (~42,164 km radius) |
| `3` | Ground station (active station if set, else default ground) |

Snaps blend over ~0.4 s.

## Architecture notes

- `src/camera/ViewDescriptor.ts`: per-eye view/projection payload, shared by mono and XR.
- `src/xr/*`: support detection, session manager, pose bridge (m→km, off-axis z∈[0,1] projection), anchors, frame loops.
- The simulation clock (and SGP4 re-anchoring) keeps ticking during an XR session.

### Stage 3: WebGPU (`XRGPUBinding`)

- **Adapter:** an `XRGPUBinding` can only wrap a device that came from an `xrCompatible` adapter, and that flag is fixed at `requestAdapter`.
  - `bootWebGPU` passes `xrCompatible: true` when `navigator.xr` and `XRGPUBinding` both exist. `?xr=0` opts out.
  - If no XR-capable adapter exists, boot proceeds normally and Enter VR stays disabled.
- **Session:** `immersive-vr` with `requiredFeatures: ['webgpu', 'local-floor' | 'local']` and `optionalFeatures: ['layers']`.
- **Presentation:** `WebGPUContext.configureForXr(session)` creates one projection layer in `binding.getPreferredColorFormat()`, with no layer depth because the frame graph owns its depth target. It then calls `updateRenderState({ layers: [layer] })`.
  - The canvas swapchain is never the XR layer.
  - On exit, `restoreCanvasPresentation()` re-asserts the canvas configuration. `handleResize()` then sizes the targets back to the canvas and the mono loop restarts, with no reload. Device loss during XR goes through the app's existing `recoverContext` recovery.
- **Per-eye frame (`src/xr/XrGpuFrameLoop.ts`):**
  1. Both eyes' scene `Uni` blocks are packed with `packSceneUniforms` (view mode forced to horizon, as in Stage 2) into a 544-byte side buffer.
  2. Before each eye, `copyBufferToBuffer` swaps that eye's block into the shared scene uniform buffer. Copies are ordered within the encoder, so the ~25 bind groups and the cached scene render bundle stay as they are, and **one submit carries both eyes**.
  3. Order of work in that encoder:
     - view-independent compute (orbital, beams, ISL, conjunctions) runs once
     - per eye: frustum cull → scene → bloom → composite into `subImage.colorTexture.createView(subImage.getViewDescriptor())` at `subImage.viewport`
  4. Side-by-side layouts load and scissor rather than clear, so one eye doesn't wipe the other.
  5. Anything a second pass in the same encoder must see reset has to be reset *inside* the encoder. The cull counters are zeroed with `encoder.clearBuffer`, not `queue.writeBuffer`, so each eye's compaction starts at 0.
- **Shared targets:** HDR, depth and bloom targets are resized once to the eye viewport and reused for each eye in turn. WebGPU has no multiview.
- **Composite format:** XR uses a composite pipeline variant per layer format (`RenderPipeline.getCompositePipelineForFormat`). The WGSL override `output_encoding` forces SDR output: gamma-encoded for a `unorm` layer, linear for an `-srgb` layer.
- **XR quality:**
  - Bloom is clamped to 2 levels (`XrQuality.applyXrQualityGpu`) and restored on exit.
  - Depth of field, motion blur, TAA and the post-process stack are skipped, because each carries single-view history.
  - Auto-exposure adapts once per frame (eye 0), so both eyes share one exposure.
- **Not drawn in XR:** ground terrain, skyline, moon and god-view overlays (the scene is horizon-style from every anchor). Light Brush paint stays visible, but strokes need a desktop pointer.

### Stage 2: WebGL fallback

- WebGL `renderEye` draws each eye into `XRWebGLLayer` viewports, with bloom off in XR.

## Stereo debug (no headset)

Stage 1 groundwork can build view descriptors for side-by-side experiments. A full SBS debug flag can come later. Use the WebXR emulator for end-to-end validation.

## Non-goals (current)

- Controller ray satellite picking (Stage 3b). `BrushController` already accepts a world-space ray for it.
- Free locomotion / smooth god-view orbit in VR
- AR (`immersive-ar`)
- An OffscreenCanvas / worker encode split. It is optional, and VR never waits on it.

## Development

```bash
npm run dev
# WebGPU XR: default URL in a UA with XRGPUBinding
# WebGL XR: ?renderer=webgl
# Chrome WebXR API Emulator extension recommended for desktop
```

Unit tests: `src/xr/*.test.ts`, `src/camera/ViewDescriptor.test.ts`, `src/app/UniformWriter.test.ts`, `src/render/passes/CompositePass.test.ts`.

The headless SwiftShader VM can't complete WebGPU frames, so verify the WebGPU XR runtime on real hardware.
