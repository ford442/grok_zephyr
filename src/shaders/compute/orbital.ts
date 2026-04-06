/**
 * Orbital Mechanics Compute Shader
 * Multi-shell satellite position calculation
 */

import { UNIFORM_STRUCT } from '../uniforms.js';

export const ORBITAL_CS = UNIFORM_STRUCT + /* wgsl */ `
@group(0) @binding(1) var<storage,read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage,read_write> sat_pos  : array<vec4f>;

// Multi-shell orbit radii (km from Earth center)
const ORBIT_RADII_KM = array<f32,3>(6711.0, 6921.0, 7521.0);

// Mean motion (rad/s) for each shell
const MEAN_MOTIONS = array<f32,3>(0.001153, 0.001097, 0.000946);

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }

  let e    = orb_elem[i];
  let raan = e.x;
  let inc  = e.y;
  let m0   = e.z;
  let shellData = e.w;
  
  let shellDataU = u32(shellData);
  let shellIndex = shellDataU >> 8u;
  let colorIndex = f32(shellDataU & 255u);
  
  let orbitR = ORBIT_RADII_KM[shellIndex];
  let meanMotion = MEAN_MOTIONS[shellIndex];

  let M  = m0 + meanMotion * uni.time;
  let cM = cos(M); let sM = sin(M);
  let cR = cos(raan); let sR = sin(raan);
  let cI = cos(inc);  let sI = sin(inc);

  let x = orbitR * (cR*cM - sR*sM*cI);
  let y = orbitR * (sR*cM + cR*sM*cI);
  let z = orbitR * sM * sI;

  sat_pos[i] = vec4f(x, y, z, colorIndex);
}
`;
