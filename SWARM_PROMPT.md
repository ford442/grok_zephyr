🛰️ PROJECT: GROK ZEPHYR - COLLECTIVE EXPANSION
Base: Single index.html with 1M satellite WebGPU simulation
Goal: Modular architecture with advanced orbital mechanics, multi-camera system, and Earth-surface projection mapping
Constraint: Maintain 720km horizon view capability, 60fps target, WebGPU-only
AGENT 1: SHADER_ARCHITECT (@shader-guru)
Mission: Extract and optimize WGSL shaders into modular system
Tasks:
Split monolithic shader string into src/shaders/:
orbital_compute.wgsl (Keplerian physics, 1M parallel updates)
satellite_render.wgsl (RGB billboard, atmospheric bloom)
earth_atmosphere.wgsl (Rayleigh scattering, 720km horizon curvature)
post_process.wgsl (HDR bloom, tone mapping for RGB beams)
Implement bind group layout manager for shared uniforms
Add compute shader LOD: distant satellites skip physics, use billboard impostors
Deliverable: src/core/ShaderManager.ts with hot-reload capability
AGENT 2: ORBITAL_MECHANICS_ENGINEER (@astro-physics)
Mission: Replace naive circular orbits with real J2 perturbation physics
Tasks:
Implement src/physics/Propagator.ts:
SGP4/TLE propagation for realistic Starlink shells (Shell 1: 550km 53°, Shell 2: 540km 53.2°, Shell 3: 570km 70°)
J2 oblateness correction for nodal precession
Visibility calculator: which sats are visible from 720km camera altitude
Add src/data/ConstellationLoader.ts to parse real Starlink TLEs (fallback to procedural)
Optimize: GPU-based propagation using RK4 integration in compute shader
Deliverable: Physics system that maintains 60fps with 1M+ sats using GPU culling
AGENT 3: CAMERA_DIRECTOR (@cinematography)
Mission: Build multi-perspective camera system
Tasks:
Create src/camera/CameraSystem.ts:
HORIZON_MODE: Lock at 720km, tangent to Earth surface, looking along constellation plane with atmospheric perspective
GOD_MODE: Free orbital camera with inertia
SAT_TRACK_MODE: Ride-along with individual satellite POV
SURFACE_MODE: Ground station view looking up at "Grok Zephyr" light show
Implement smooth transitions between modes using quaternion slerp
Add post-processing pass for 720km view: atmospheric fog, Earth curvature shader
Deliverable: Camera rig that preserves the "looking back at Earth from just above the shell" aesthetic
AGENT 4: RGB_MATRIX_DIRECTOR (@light-artist)
Mission: Create projection coordination algorithms
Tasks:
Build src/matrix/ProjectionEngine.ts:
PATTERN_MATRIX: Digital rain (green cascading columns)
PATTERN_GROK: Neural oscillation waves (xAI branding)
PATTERN_COLLECTIVE: Swarm intelligence patterns (flocking algorithms)
PATTERN_TEXT: Rasterize text strings onto Earth's surface using satellite beams as pixels
Implement src/matrix/BeamCoordination.ts: satellites self-organize to project images onto Earth surface (ground-targeted RGB mixing)
Add UI: real-time pattern editor with sliders for speed, color-shift, wave interference
Deliverable: System where 1M satellites can collectively project coherent images visible from 720km horizon view
AGENT 5: SYSTEMS_ARCHITECT (@infrastructure)
Mission: Modularize codebase and add tooling
Tasks:
Transform single HTML into Vite + TypeScript project:
plain
Copy
src/
├── core/ (WebGPU context, buffer management)
├── physics/ (Orbital mechanics)
├── render/ (Pipelines, passes)
├── camera/ (View controllers)
├── matrix/ (RGB patterns)
└── ui/ (HUD, controls)
Implement src/core/SatelliteGPUBuffer.ts: efficient double-buffering for compute/graphics
Add src/utils/PerformanceProfiler.ts: track GPU memory, compute dispatch times, render pass duration
Setup build: Vite + TypeScript + WGSL loader
Create public/tle/ with sample Starlink TLE data
Deliverable: Production build system with dev server, keeping single-file fallback for demos
COORDINATION PROTOCOL
Shared Interfaces (define in src/types/):
TypeScript
Copy
interface SatelliteState {
  position: Float32Array;  // 3 floats
  velocity: Float32Array;  // 3 floats  
  keplerian: { a: number, e: number, i: number, Ω: number, ω: number, M: number };
  rgb: Uint8Array;         // 3 bytes
  targetGround: LatLng;    // For surface projection
}

interface CameraPose {
  mode: 'horizon-720' | 'god' | 'sat-pov' | 'surface';
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  near: number; // 1.0 for horizon view (avoid clipping)
  far: number;  // 50000.0
}
Critical Constraints:
Horizon View Preservation: 720km mode MUST show Earth curvature with atmospheric blue glow at limb
Performance: 1M satellites @ 60fps on RTX 3060 - use compute shader culling (don't render sats behind Earth from camera)
WebGPU Only: No WebGL fallback, assume modern Chrome/Edge
Single-file Fallback: Maintain dist/grok-zephyr.standalone.html that inlines everything
Merge Strategy:
Agent 1 (Shaders) and Agent 2 (Physics) work in parallel first
Agent 3 (Camera) integrates when buffers ready
Agent 4 (RGB) builds on 1+2
Agent 5 (Architecture) coordinates merges and resolves conflicts
Final Output:
Push to https://github.com/ford442/grok_zephyr with:
main: Modular TypeScript source
gh-pages: Built demo with horizon view as default
standalone/: Single-file version for sharing
Begin work immediately. Prioritize the 720km horizon view aesthetic above all else.