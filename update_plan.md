# Update Plan: Ground Level View & RGB Communication

## Current Issue: Ground Level View Cannot See Satellites

### Problem Summary
The Ground View mode (`view_mode: 3`) positions the camera on Earth's surface at radius 6371.0 km, looking radially outward toward the satellite constellation at 550km altitude (6921.0 km radius). However, satellites are not visible despite the "Visible" counter showing non-zero values.

### Root Cause Analysis

#### 1. **The "Fake Horizon" Obstruction**
The rendering pipeline draws elements in this order:
1. Stars (background)
2. **Earth** (radius 6371 km, opaque sphere)
3. **Atmosphere** (radius 6471 km, additive blended sphere)
4. Satellites (billboards)

When the camera is at ground level (position: [6371, 0, 0]), it is:
- **Inside** the Earth sphere (radius 6371 km) - the camera sits exactly on the surface
- **Inside** the atmosphere sphere (radius 6471 km, extending 100km above surface)

The current Earth and atmosphere shaders do not perform any clipping or camera-inside handling. The camera looks outward through the Earth/atmosphere meshes, which can cause:
- Z-fighting or depth buffer issues at the camera position
- Back-face rendering of the atmosphere sphere creating an opaque "shell" effect
- Satellites being depth-tested against the atmosphere/Earth geometry

#### 2. **Distance Culling in Satellite Shader**
The satellite shader (`satellites.wgsl`) has a hard distance cull:
```wgsl
var visible = dist <= 14000.0;
```

At ground level, the minimum distance to any satellite is ~550km (if directly overhead), but typical distances to visible satellites range from 1000km to 3000km. This should be within range, so the culling is not the primary issue.

#### 3. **Frustum Culling Issues**
The Ground View camera looks radially outward (`target: [6921, 0, 0]`). The frustum planes are calculated from the view-projection matrix. If the near plane is too close to the camera position or the far plane clips early, satellites may be culled.

Current Ground View config:
- `near: 1.0` (1 km - should be fine)
- `far: 50000` (50,000 km - definitely fine)
- `fov: 60° * π/180`

### Why Satellites Show "Visible" Count but Aren't Rendered

The "Visible" counter in the UI likely counts satellites that pass the compute shader or CPU-side visibility tests but fail during actual fragment rendering. The issue is likely:

1. **Depth buffer clearing order**: If the depth buffer from Earth/atmosphere rendering persists, satellites may fail depth tests
2. **Blend state**: Satellites use additive/high-alpha blending that may not composite correctly against the atmosphere
3. **Billboard orientation**: Satellites are camera-facing billboards. From ground level looking up, they may be edge-on or behind the atmosphere glow

---

## Implementation Roadmap

### Phase 1: Fix Ground Level Visibility

#### 1.1 Render Order Fix
**File**: `src/render/RenderPipeline.ts`

Modify the scene render pass to handle ground-level camera:
- When camera radius < atmosphere radius (inside atmosphere):
  - Option A: Disable Earth rendering entirely (camera inside)
  - Option B: Render only back-faces of atmosphere with inverted depth test
  - Option C: Add "ground perspective" flag to skip Earth/atmosphere rendering

#### 1.2 Satellite Shader Modifications
**File**: `src/shaders/satellites.wgsl`

Update visibility logic for ground observers:
```wgsl
// Add elevation angle calculation
let to_sat = normalize(wp - cam);
let up = normalize(cam);  // Radial up from Earth center
let elevation = asin(dot(to_sat, up));

// Only show satellites above horizon (elevation > 0)
visible = visible && (elevation > -0.1);  // -0.1 rad margin for atmospheric refraction
```

#### 1.3 Atmosphere Rendering for Ground View
**File**: `src/shaders/atmosphere.wgsl`

When camera is inside atmosphere sphere:
- Switch to ray-marching approach instead of mesh rendering
- Or disable atmosphere rendering and use skybox gradient

#### 1.4 Add Horizon Clipping
**File**: `src/shaders/satellites.wgsl`

```wgsl
// Earth horizon calculation for ground observer
let earth_radius = 6371.0;
let cam_altitude = length(cam) - earth_radius;
let cam_to_sat = wp - cam;
let cam_dist = length(cam_to_sat);

// Line-sphere intersection for horizon test
let a = dot(cam_to_sat, cam_to_sat);
let b = 2.0 * dot(cam, cam_to_sat);
let c = dot(cam, cam) - earth_radius * earth_radius;
let discriminant = b*b - 4.0*a*c;

// Satellite is visible if no intersection with Earth sphere (above horizon)
let above_horizon = discriminant < 0.0 || 
                    (-b - sqrt(max(0.0, discriminant))) / (2.0*a) > 1.0;
visible = visible && above_horizon;
```

### Phase 2: RGB Communication Protocol Design

#### 2.1 Communication Concept
Satellites will transmit data to ground observers by modulating their RGB color channels. This mimics real optical communication concepts (like LiFi or lasercom) but simplified for visualization.

#### 2.2 Data Encoding Scheme

**Frame Structure**:
```
[PREAMBLE] [SYNC] [LENGTH] [DATA...] [CHECKSUM]
```

| Field | Description | Duration |
|-------|-------------|----------|
| PREAMBLE | Alternating R-G-B pattern (3 blinks) | 300ms |
| SYNC | White flash | 100ms |
| LENGTH | 8 bits, MSB first, encoded in R channel intensity | 800ms |
| DATA | N bytes, 2 bits per color channel per frame | N * 400ms |
| CHECKSUM | Simple XOR of data bytes | 400ms |

**Bit Encoding per Channel**:
Each color channel (R, G, B) can encode 2 bits via intensity levels:
- 00 = Off (0.0 intensity)
- 01 = Dim (0.33 intensity)  
- 10 = Medium (0.66 intensity)
- 11 = Bright (1.0 intensity)

Per satellite, per frame: 6 bits total (2 bits × 3 channels)

#### 2.3 Image Transmission Protocol

For transmitting a simple 16x16 pixel image (256 pixels):
- Each pixel: RGB888 = 24 bits
- Total: 256 × 24 = 6144 bits
- At 6 bits/frame × 10 frames/second = 60 bits/second
- Transmission time: ~102 seconds (~1.7 minutes) per image

**Compression**: Use simple run-length encoding (RLE) for solid-color regions.

#### 2.4 Receiver Implementation (Ground View)

**Detection Algorithm**:
1. Track each satellite's color over time
2. Detect PREAMBLE pattern (R→G→B transition)
3. Lock onto SYNC and begin sampling
4. Sample each channel's intensity at frame intervals
5. Decode bits and reconstruct bytes
6. Validate CHECKSUM, display image

**Visual Feedback in UI**:
- Show "signal strength" bar for locked satellites
- Display incoming byte count
- Render received image in a panel

### Phase 3: Implementation Tasks

#### Task 3.1: Ground View Rendering Fix
- [ ] Add camera altitude detection to RenderPipeline
- [ ] Modify satellite shader to perform horizon culling
- [ ] Disable Earth mesh when camera is at/below surface
- [ ] Add atmospheric scattering shader for ground sky view
- [ ] Test with debug visualization of visible satellites

#### Task 3.2: RGB Encoding System
- [ ] Add `communication` module with encoding/decoding logic
- [ ] Define satellite data structures for image storage
- [ ] Implement preamble/sync detection in satellite shader
- [ ] Create CPU-side encoder for test images
- [ ] Add time-synchronized blinking to satellite shader

#### Task 3.3: Ground Receiver UI
- [ ] Add "Signal Monitor" panel to HUD
- [ ] Implement satellite lock-on mechanics
- [ ] Create image reconstruction buffer display
- [ ] Add progress bar for image download
- [ ] Show constellation map with transmitting satellites highlighted

#### Task 3.4: Content Pipeline
- [ ] Create 16x16 test images (pixel art style)
- [ ] Build image-to-satellite-data encoder tool
- [ ] Assign unique image payloads to satellite groups
- [ ] Add "message of the day" rotating content

---

## Technical Notes

### Shader Modifications Required

**satellites.wgsl** additions:
```wgsl
struct CommState {
  preamble_detected: bool,
  locked: bool,
  bit_buffer: u32,
  sample_timer: f32,
}

// In VS: decode comm state from satellite data
let comm_data = u32(cdat);  // Use upper bits for comm state
let is_transmitting = (comm_data >> 8) & 0x1;
let tx_phase = f32(comm_data >> 9) * 0.01;  // Encode phase

// Modulate color based on transmission
if (is_transmitting) {
  let bit_pattern = (comm_data >> 16) & 0x3F;  // 6 bits
  let r_level = f32((bit_pattern >> 4) & 0x3) / 3.0;
  let g_level = f32((bit_pattern >> 2) & 0x3) / 3.0;
  let b_level = f32(bit_pattern & 0x3) / 3.0;
  col = vec3f(r_level, g_level, b_level);
}
```

### Performance Considerations

- Blinking RGB requires per-satellite state updates (could use compute shader)
- Image data storage: 256 satellites × 256 bytes = 64KB (negligible)
- Detection sampling: Run at 30Hz in fragment shader (cheap)

### Future Enhancements

1. **Multiple Simultaneous Transmitters**: Use CDMA-style codes
2. **Directional Beams**: Satellites only transmit when facing ground station
3. **Error Correction**: Reed-Solomon or simple parity
4. **Animated GIFs**: Delta-frame encoding for motion
5. **Interactive Responses**: Ground user can "reply" via mouse clicks

---

## Files to Modify (Summary for Copilot)

| File | Changes Needed |
|------|----------------|
| `src/camera/CameraController.ts` | Update `calculateGroundView()` to position camera 100m above surface, reduce near plane to 0.1 |
| `src/shaders/index.ts` | 1. Update `UNIFORM_STRUCT` to rename `pad0` to `is_ground_view`<br>2. Update `SAT_SHADER` to add horizon culling and RGB test pattern |
| `src/shaders/uniforms.wgsl` | Rename `pad0` to `is_ground_view` in Uni struct |
| `src/main.ts` | 1. Update `writeUniforms()` to set `is_ground_view` flag at u32[31]<br>2. Add conditional to call `encodeGroundScenePass` for ground view mode |

---

## Detailed Implementation Instructions for Copilot

### Task 1: Fix Ground View Camera Position

**File**: `src/camera/CameraController.ts`

**Change**: Modify `calculateGroundView()` to position camera slightly above Earth's surface to avoid z-fighting with the Earth mesh.

**Current**:
```typescript
private calculateGroundView(): CameraState {
  return {
    position: [CONSTANTS.EARTH_RADIUS_KM, 0, 0],
    target: [CONSTANTS.ORBIT_RADIUS_KM, 0, 0],
    up: [0, 0, 1],
    fov: CAMERA.DEFAULT_FOV,
    near: 1.0,
    far: CAMERA.FAR_PLANE,
  };
}
```

**New**:
```typescript
private calculateGroundView(): CameraState {
  // Position camera 0.1 km (100m) above surface to avoid z-fighting
  const surface_altitude = 0.1;
  return {
    position: [CONSTANTS.EARTH_RADIUS_KM + surface_altitude, 0, 0],
    target: [CONSTANTS.ORBIT_RADIUS_KM, 0, 0],
    up: [0, 0, 1],
    fov: CAMERA.DEFAULT_FOV,
    near: 0.1,  // Reduce near plane for closer rendering
    far: CAMERA.FAR_PLANE,
  };
}
```

---

### Task 2: Add Horizon Culling to Satellite Shader

**File**: `src/shaders/index.ts` - modify the `SAT_SHADER` constant

**Changes**:

1. In the vertex shader body, after the frustum cull loop (around line 196-201 in SAT_SHADER), add Earth radius constant and horizon culling:

**Add constant at the top of the shader function**:
```wgsl
const EARTH_RADIUS_KM: f32 = 6371.0;
```

**After the frustum cull, add horizon culling**:
```wgsl
  var visible = true;
  if (dist > 14000.0) { visible = false; }
  if (visible) {
    for (var p=0u; p<6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) { visible=false; break; }
    }
  }
  
  // Ground view: only show satellites above horizon
  if (visible && uni.is_ground_view != 0u) {
    // Line-sphere intersection test for Earth occlusion
    // Ray from camera to satellite: cam + t * (wp - cam)
    let ray_dir = wp - cam;
    let ray_len_sq = dot(ray_dir, ray_dir);
    
    // Quadratic coefficients for ray-sphere intersection
    // |cam + t * ray_dir|^2 = EARTH_RADIUS_KM^2
    let a = ray_len_sq;
    let b = 2.0 * dot(cam, ray_dir);
    let c = dot(cam, cam) - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
    
    let discriminant = b * b - 4.0 * a * c;
    
    // If discriminant >= 0, ray intersects Earth sphere
    // Check if intersection is between camera (t=0) and satellite (t=1)
    if (discriminant >= 0.0) {
      let sqrt_disc = sqrt(discriminant);
      let t1 = (-b - sqrt_disc) / (2.0 * a);
      let t2 = (-b + sqrt_disc) / (2.0 * a);
      
      // If either intersection is between camera and satellite, it's occluded
      if ((t1 > 0.0 && t1 < 1.0) || (t2 > 0.0 && t2 < 1.0)) {
        visible = false;
      }
    }
  }
```

---

### Task 3: Update Uniform Buffer Structure

**File**: `src/shaders/index.ts` and `src/shaders/uniforms.wgsl`

**Change**: Rename `pad0` to `is_ground_view` in the `UNIFORM_STRUCT` and in `uniforms.wgsl`.

The uniform buffer is currently 256 bytes. The is_ground_view field can use existing padding at offset 124 (replaces `pad0`). No size change needed.

**In `src/shaders/index.ts` - update UNIFORM_STRUCT**:

**Current**:
```typescript
export const UNIFORM_STRUCT = /* wgsl */ `
struct Uni {
  view_proj      : mat4x4f,
  camera_pos     : vec4f,
  camera_right   : vec4f,
  camera_up      : vec4f,
  time           : f32,
  delta_time     : f32,
  view_mode      : u32,
  pad0           : u32,
  frustum        : array<vec4f,6>,
  screen_size    : vec2f,
  pad1           : vec2f,
};
...
```

**New**:
```typescript
export const UNIFORM_STRUCT = /* wgsl */ `
struct Uni {
  view_proj      : mat4x4f,
  camera_pos     : vec4f,
  camera_right   : vec4f,
  camera_up      : vec4f,
  time           : f32,
  delta_time     : f32,
  view_mode      : u32,
  is_ground_view : u32,  // was pad0
  frustum        : array<vec4f,6>,
  screen_size    : vec2f,
  pad1           : vec2f,
};
...
```

**Also update `src/shaders/uniforms.wgsl`** with the same change (replace `pad0` with `is_ground_view`).

---

### Task 4: Update Uniform Buffer Upload

**File**: `src/main.ts` in `writeUniforms()` method

**Change**: Set the `is_ground_view` flag at u32[31] (offset 124) based on camera altitude.

**Current code** (around line 231-232):
```typescript
// Time, delta time, view mode (112-123)
f32[28] = time;
f32[29] = deltaTime;
u32[30] = this.camera.getViewModeIndex();
u32[31] = 0;  // pad0
```

**New code**:
```typescript
// Time, delta time, view mode (112-123)
f32[28] = time;
f32[29] = deltaTime;
u32[30] = this.camera.getViewModeIndex();

// is_ground_view flag (offset 124) - 1 if camera is near/near surface
const cameraRadius = Math.sqrt(
  camera.position[0] * camera.position[0] +
  camera.position[1] * camera.position[1] +
  camera.position[2] * camera.position[2]
);
const isGroundView = cameraRadius < CONSTANTS.EARTH_RADIUS_KM + 100.0 ? 1 : 0;
u32[31] = isGroundView;
```

---

### Task 5: Use Ground Scene Pass for Ground View

**File**: `src/render/RenderPipeline.ts`

**Note**: There is already an `encodeGroundScenePass` method that skips Earth/Atmosphere and renders satellites first, then ground terrain. This should be used when in Ground View mode.

**Change**: The main render loop in `main.ts` should call `encodeGroundScenePass` instead of `encodeScenePass` when in Ground View.

In `src/main.ts`, find where `encodeScenePass` is called and add conditional logic:
```typescript
if (this.cameraController.getViewMode() === 'ground') {
  this.renderPipeline.encodeGroundScenePass(encoder);
} else {
  this.renderPipeline.encodeScenePass(
    encoder,
    this.earthMesh.vertexBuffer,
    this.earthMesh.indexBuffer,
    this.earthMesh.indexCount
  );
}
```

**Also Update**: `encodeGroundScenePass` to set the `is_ground_view` uniform flag before rendering.

The ground scene pass already does the right thing:
1. Renders satellites first (in the sky)
2. Renders ground terrain on top to occlude foreground

We just need to ensure the satellite shader performs horizon culling so only satellites above the horizon are visible.

---

### Task 6: Add RGB Test Pattern for Visibility Verification

**File**: `src/shaders/index.ts` - in `SAT_SHADER`

**Change**: Add a hardcoded RGB test pattern when in ground view to verify satellites are visible.

In the vertex shader, after calculating `col` and `bright`, add:
```wgsl
  // ... existing code that calculates col and bright ...
  
  // Test pattern: RGB cycling based on time and satellite index (ground view only)
  if (uni.is_ground_view != 0u) {
    let test_phase = uni.time * 2.0 + f32(ii) * 0.001;
    let cycle = fract(test_phase);
    
    if (cycle < 0.33) {
      col = vec3f(1.0, 0.0, 0.0);  // Red
    } else if (cycle < 0.66) {
      col = vec3f(0.0, 1.0, 0.0);  // Green
    } else {
      col = vec3f(0.0, 0.0, 1.0);  // Blue
    }
    
    // Make test pattern very bright to ensure visibility
    bright = 2.0;
  }
  
  o.color = col;
  o.bright = bright;
```

---

## Immediate Next Steps

1. **Verify Ground View camera position** - Ensure camera is slightly above surface (6371.1 km) not exactly at 6371.0 km to avoid z-fighting
2. **Add debug rendering** - Draw wireframe frustum and satellite bounding boxes
3. **Test without Earth/Atmosphere** - Temporarily disable to confirm satellites render
4. **Implement horizon culling** - Add the line-sphere intersection test to satellite shader
5. **Prototype RGB blinking** - Hardcode a test pattern in satellite shader to verify visibility
