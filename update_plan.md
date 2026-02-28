# Update Plan: Grok Zephyr / Colossus Fleet

## Current Status

✅ **1,048,576 satellites** via WebGPU compute shader  
✅ **6-pass HDR pipeline** with bloom  
✅ **4 camera modes** (Horizon, God, Fleet POV, Ground)  
✅ **Procedural Earth** with limb glow and night lights  
✅ **Ground view** with horizon culling and terrain  

🔴 **Missing**: Laser beams projecting to Earth surface  
🔴 **Issue**: Satellites invisible/tiny at god view distances  

---

## Phase 1: Quick Visibility Fix (5 minutes)

### 1.1 Fix Billboard Sizing
**File**: `src/shaders/index.ts` in `SAT_SHADER`

Replace:
```wgsl
let bsize = clamp(1200.0/max(dist,50.0), 0.4, 60.0);
```

With:
```wgsl
// Sqrt falloff for better visibility at planetary scales
let bsize = 800.0 / sqrt(max(dist, 80.0));
bsize = clamp(bsize, 0.6, 80.0);
```

### 1.2 Fix Distance Culling
**File**: `src/shaders/index.ts` in `SAT_SHADER`

Replace:
```wgsl
if (dist > 14000.0) { visible = false; }
```

With:
```wgsl
if (dist > 120000.0) { visible = false; }  // Support extreme zoom out
```

---

## Phase 2: Laser Beams — The Big Feature

### Architecture Overview

**Technique**: Instanced camera-aligned ribbons (triangle strips)
- No geometry shaders needed
- 4 vertices per beam instance
- Camera-facing perpendicular basis via cross product
- Perfect for bloom/glow

**Data Flow**:
```
Satellite positions (storage buffer)
    ↓
Compute shader: populate beams (start/end positions)
    ↓
Render pipeline: instanced triangle strips
    ↓
Bloom composite → glowing beams
```

### Step-by-Step Implementation

### 2.1 Add Beam Storage Buffer
**File**: `src/core/SatelliteGPUBuffer.ts`

Add to interface and initialization:
```typescript
export interface SatelliteBufferSet {
  // ... existing buffers ...
  /** Active beams storage (start vec4 + end vec4 per beam) */
  beams: GPUBuffer;
  /** Number of active beams uniform */
  beamCount: GPUBuffer;
}

// Constants
const MAX_BEAMS = 65536;  // ~65k beams = 4MB

// In initialize():
const beams = this.context.createBuffer(
  MAX_BEAMS * 4 * 4 * 2,  // 2 vec4f per beam
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
);

const beamCount = this.context.createUniformBuffer(16); // u32 count + padding
```

### 2.2 Create Beam Compute Shader
**File**: `src/shaders/index.ts`

Add new shader:
```typescript
export const BEAM_COMPUTE_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct Beam {
  start : vec4f,  // xyz = sat pos, w = intensity (0-1)
  end   : vec4f,  // xyz = target pos, w = hue (0-360)
};

@group(0) @binding(1) var<storage, read> sat_pos : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> beams : array<Beam>;
@group(0) @binding(3) var<uniform> beam_count : u32;

const EARTH_RADIUS_KM : f32 = 6371.0;
const MAX_BEAMS : u32 = 65536u;

// Helper: HSL to RGB
fn hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x / 360.0;
  let s = hsl.y;
  let l = hsl.z;
  
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs(fract(h * 6.0) * 2.0 - 1.0));
  let m = l - c * 0.5;
  
  var rgb : vec3f;
  if (h < 1.0/6.0) { rgb = vec3f(c, x, 0.0); }
  else if (h < 2.0/6.0) { rgb = vec3f(x, c, 0.0); }
  else if (h < 3.0/6.0) { rgb = vec3f(0.0, c, x); }
  else if (h < 4.0/6.0) { rgb = vec3f(0.0, x, c); }
  else if (h < 5.0/6.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  
  return rgb + m;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= MAX_BEAMS) { return; }
  
  // Every 16th satellite fires a beam (density control)
  let satIdx = i * 16u;
  if (satIdx >= 1048576u) { 
    beams[i].start.w = 0.0; // disable
    return; 
  }
  
  let sat = sat_pos[satIdx];
  let pos = sat.xyz;
  let dir = normalize(pos);  // Radial direction
  
  // Target: Earth surface along radial line
  let target = dir * EARTH_RADIUS_KM;
  
  // Add subtle motion/chaos
  let time = uni.time;
  let chaos = vec3f(
    sin(time + f32(i) * 0.1) * 50.0,
    cos(time * 0.7 + f32(i) * 0.13) * 50.0,
    sin(time * 0.3 + f32(i) * 0.07) * 30.0
  );
  
  // Rainbow cycling based on time and index
  let hue = fract(time * 0.05 + f32(i) / 65536.0) * 360.0;
  
  beams[i].start = vec4f(pos, 0.9);           // intensity
  beams[i].end = vec4f(target + chaos, hue);
}
`;
```

### 2.3 Create Beam Render Shader
**File**: `src/shaders/index.ts`

```typescript
export const BEAM_RENDER_SHADER = UNIFORM_STRUCT + /* wgsl */ `
struct Beam {
  start : vec4f,
  end   : vec4f,
};

@group(0) @binding(1) var<storage, read> beams : array<Beam>;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) lineCoord : vec2f,  // x = along beam (0-1), y = across (-1 to 1)
  @location(1) intensity : f32,
  @location(2) hue : f32,
};

// HSL to RGB (same as compute)
fn hsl_to_rgb(h: f32, s: f32, l: f32) -> vec3f {
  let hf = h / 360.0;
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs(fract(hf * 6.0) * 2.0 - 1.0));
  let m = l - c * 0.5;
  
  var rgb : vec3f;
  let hp = hf * 6.0;
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  
  return rgb + m;
}

@vertex
fn vs_main(
  @builtin(instance_index) inst : u32,
  @builtin(vertex_index) vtx : u32
) -> VSOut {
  let beam = beams[inst];
  
  // Skip disabled beams
  if (beam.start.w <= 0.0) {
    var dummy : VSOut;
    dummy.pos = vec4f(0.0, 0.0, 0.0, 0.0);
    return dummy;
  }
  
  let start = beam.start.xyz;
  let end = beam.end.xyz;
  let hue = beam.end.w;
  
  let dir = end - start;
  let len = length(dir);
  let dirN = dir / len;
  
  // Camera-facing basis
  let camFwd = normalize(uni.camera_pos.xyz - start);
  let right = normalize(cross(dirN, camFwd));
  
  // Triangle strip vertices: 4 verts per beam
  // vtx: 0=BL, 1=BR, 2=TL, 3=TR
  let along = f32(vtx / 2u);      // 0.0 or 1.0
  let across = f32(vtx % 2u) * 2.0 - 1.0;  // -1.0 or 1.0
  
  let width = 6.0;  // km
  let worldPos = start + dir * along + right * (across * width * 0.5);
  
  var out : VSOut;
  out.pos = uni.view_proj * vec4f(worldPos, 1.0);
  out.lineCoord = vec2f(along, across);
  out.intensity = beam.start.w;
  out.hue = hue;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4f {
  // Soft edge falloff
  let dist = abs(in.lineCoord.y);
  let edgeAlpha = 1.0 - smoothstep(0.0, 0.8, dist);
  
  // Color from hue
  let col = hsl_to_rgb(in.hue, 1.0, 0.5);
  
  // HDR boost for bloom
  let hdrCol = col * in.intensity * 5.0;
  
  return vec4f(hdrCol, edgeAlpha * in.intensity);
}
`;
```

### 2.4 Update RenderPipeline
**File**: `src/render/RenderPipeline.ts`

Add beam pipeline and bind groups:
```typescript
export interface Pipelines {
  // ... existing pipelines ...
  beam: GPURenderPipeline;
}

export interface PipelineBindGroups {
  // ... existing bind groups ...
  beam: GPUBindGroup;
  beamCompute: GPUBindGroup;
}

// In createPipelines():
this.pipelines.beam = device.createRenderPipeline({
  layout: device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      }),
    ],
  }),
  vertex: {
    module: this.context.createShaderModule(SHADERS.beamRender, 'beam-render'),
    entryPoint: 'vs_main',
  },
  fragment: {
    module: this.context.createShaderModule(SHADERS.beamRender, 'beam-render'),
    entryPoint: 'fs_main',
    targets: [{ format: RENDER.HDR_FORMAT, blend: additiveBlend }],
  },
  primitive: { 
    topology: 'triangle-strip',
    stripIndexFormat: undefined,  // Non-indexed strip
  },
  depthStencil: {
    format: RENDER.DEPTH_FORMAT,
    depthWriteEnabled: false,
    depthCompare: 'less',
  },
});

// Beam compute pipeline
this.pipelines.beamCompute = device.createComputePipeline({
  layout: device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      }),
    ],
  }),
  compute: {
    module: this.context.createShaderModule(SHADERS.beamCompute, 'beam-compute'),
    entryPoint: 'main',
  },
});
```

### 2.5 Add Beam Rendering to Scene Pass
**File**: `src/render/RenderPipeline.ts`

In `encodeScenePass()`, after satellites:
```typescript
// Satellites
pass.setPipeline(this.pipelines.satellites);
pass.setBindGroup(0, this.bindGroups.satellites);
pass.draw(6, CONSTANTS.NUM_SATELLITES);

// Laser beams (65k max, 4 verts each = 4 vertices per instance via triangle strip)
pass.setPipeline(this.pipelines.beam);
pass.setBindGroup(0, this.bindGroups.beam);
pass.draw(4, MAX_BEAMS);  // 4 vertices per beam instance
```

### 2.6 Add Beam Compute Pass
**File**: `src/render/RenderPipeline.ts`

Add new method:
```typescript
encodeBeamComputePass(encoder: GPUCommandEncoder): void {
  if (!this.pipelines || !this.bindGroups) return;
  
  const pass = encoder.beginComputePass();
  pass.setPipeline(this.pipelines.beamCompute);
  pass.setBindGroup(0, this.bindGroups.beamCompute);
  pass.dispatchWorkgroups(Math.ceil(MAX_BEAMS / 256));
  pass.end();
}
```

### 2.7 Update Main Render Loop
**File**: `src/main.ts`

Add beam compute pass:
```typescript
// Pass 1: Compute orbital positions
this.pipeline.encodeComputePass(encoder);

// Pass 1.5: Compute beam positions
this.pipeline.encodeBeamComputePass(encoder);

// Pass 2: Scene rendering
// ...
```

---

## Phase 3: Logo/Pattern Formation (After Beams Work)

### Procedural Logo Mask
In the beam compute shader, add pattern logic:
```wgsl
// Sample "Grok" text using SDF or pre-baked points
let logoUV = sphere_to_uv(dir);  // Convert direction to Earth UV
let logoMask = sample_grok_sdf(logoUV);

if (logoMask > 0.0) {
  beams[i].start.w = 0.9;  // Enable
} else {
  beams[i].start.w = 0.0;  // Disable
}
```

### Pre-baked Logo Points
Alternative: Generate ~10k points on Earth's night side forming "GROK" or "X" logo, assign each to nearest satellite.

---

## Phase 4: Ground View Sky Polish

Simple rayleigh gradient in ground terrain shader or separate sky pass:
```wgsl
let viewDir = normalize(worldPos - camera_pos);
let horizon = dot(viewDir, vec3f(0,0,1));  // up vector
let sky = mix(vec3f(0.0, 0.05, 0.2), vec3f(0.4, 0.7, 1.0), pow(1.0 - horizon, 2.0));
```

---

## Implementation Order

1. **Phase 1** (5 min): Visibility fixes → test immediately
2. **Phase 2.1-2.3** (30 min): Beam shaders and buffers
3. **Phase 2.4-2.7** (20 min): Pipeline integration
4. **Test**: Should see 65k glowing rainbow beams!
5. **Phase 3** (30 min): Logo formation
6. **Phase 4** (10 min): Sky polish

**Total: ~1.5 hours to legendary status**

---

## Troubleshooting Notes

**Beams not visible?**
- Check HDR_FORMAT supports alpha (rgba16float does)
- Verify additiveBlend state is set
- Check beam.start.w > 0 in compute
- Ensure view_proj includes the beams

**Beams flickering?**
- May be z-fighting with Earth - disable depth write

**Performance issues?**
- Reduce MAX_BEAMS to 32768 or 16384
- Only update beams every N frames (interleave)
