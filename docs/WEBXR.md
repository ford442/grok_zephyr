# WebXR (Immersive VR)

Standing among the constellation via WebXR. **Stage 2 ships on the WebGL2 fallback renderer**; WebGPU + `XRGPUBinding` is a planned follow-on.

## Requirements

- Browser with WebXR (`navigator.xr`) and `immersive-vr` support (Quest Browser, Chrome + WebXR emulator, etc.)
- **WebGL renderer**: `?renderer=webgl` (or `localStorage['zephyr.renderer'] = 'webgl'`)
- Secure context (HTTPS or localhost)
- Optional: reduce load with `&sats=200000` on lower-end headsets

## Entering VR

1. Open the app with WebGL, e.g. `http://localhost:5173/?renderer=webgl`
2. When immersive-vr is supported, an **ENTER VR** button appears next to the cinematic controls
3. Click **ENTER VR** (user gesture required by the UA)
4. Look around from the default **720 km horizon** anchor
5. **Exit** via the headset system UI or the button (shows **EXIT VR** while active)

On WebGPU sessions the button is visible when XR is supported but **disabled**, with a tooltip to switch to `?renderer=webgl`.

## Comfort anchors (no smooth locomotion)

Snap points only (avoids locomotion sickness):

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

- `src/camera/ViewDescriptor.ts` — per-eye view/projection payload (shared mono + XR)
- `src/xr/*` — support detection, session manager, pose bridge (m→km), anchors, XR frame loop
- WebGL `renderEye` draws each eye into `XRWebGLLayer` viewports (bloom off in XR)
- Simulation clock continues to tick during the XR session

## Stereo debug (no headset)

Stage 1 groundwork allows building view descriptors for side-by-side experiments; full SBS debug flag can be layered on later. Prefer the WebXR emulator for end-to-end validation.

## Non-goals (current)

- WebGPU XR present (`XRGPUBinding`)
- Controller ray satellite picking (Stage 3)
- Free locomotion / smooth god-view orbit in VR

## Development

```bash
npm run dev
# open ?renderer=webgl
# Chrome WebXR API Emulator extension recommended for desktop
```

Unit tests: `src/xr/*.test.ts`, `src/camera/ViewDescriptor.test.ts`.
