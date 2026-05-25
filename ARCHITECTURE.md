# Grok Zephyr Architecture

## Overview

Grok Zephyr is a Vite + TypeScript WebGPU application that simulates and renders a 1,048,576-satellite constellation in real time. The app keeps orbital state, pattern data, and render targets on the GPU, then drives a multi-pass render pipeline from `src/main.ts`.

## Runtime flow

1. `src/main.ts` creates `WebGPUContext`, `SatelliteGPUBuffer`, `RenderPipeline`, camera, UI, and profiling services.
2. `src/core/WebGPUContext.ts` requests a high-performance adapter, enables supported optional features such as `timestamp-query`, validates required limits, and configures the canvas swapchain.
3. `src/core/SatelliteGPUBuffer.ts` allocates the large storage buffers for orbital elements, positions, colors, patterns, beams, and trails.
4. `src/render/RenderPipeline.ts` runs compute passes to update positions/beam data, then renders the scene into HDR targets before bloom and final composite.
5. `src/ui/UIManager.ts` reflects view mode, quality, and performance state back into the HUD.

## Source layout

```text
src/
├── main.ts                # App bootstrap, render loop, resize/error handling
├── core/                  # WebGPU init and large GPU buffer management
├── render/                # Compute + scene + post-process pipeline orchestration
├── camera/                # Horizon, god, fleet, ground, and moon camera logic
├── data/                  # TLE parsing/loading
├── physics/               # CPU-side orbital propagation helpers
├── shaders/               # WGSL shader sources grouped by domain
├── ui/                    # HUD and control wiring
├── utils/                 # Math and performance profiling
└── types/                 # Shared TypeScript types and constants
```

## Render pipeline

The main frame flow is:

1. Orbital compute pass
2. Beam compute pass
3. Scene or ground-scene render pass into HDR targets
4. Optional trail pass
5. Bloom threshold + blur passes
6. Composite pass into the canvas swapchain texture

Key formats:

- HDR render targets: `rgba16float`
- Depth: `depth24plus`
- Presentation/swapchain: `navigator.gpu.getPreferredCanvasFormat()`

## WebGPU requirements

The app is tuned for the fixed 1,048,576-satellite mode and validates the adapter before allocating buffers:

- Large storage buffers up to ~32 MB each
- Compute dispatch of `ceil(NUM_SATELLITES / 64)` workgroups
- Optional `timestamp-query` support for GPU profiling

If those requirements are not met, initialization stops with a compatibility message instead of attempting partial startup.

## Data sources

- Default mode procedurally generates a Walker-style constellation
- `?tle=` query parameters can load real TLE groups through `src/data/TLELoader.ts`
- Real TLE sets are padded back up to the fixed GPU fleet size

## Validation

- Build: `npm run build`
- Type check: `npm run type-check`

There is currently no dedicated automated WebGPU test suite in the repository.
