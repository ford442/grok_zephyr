/**
 * Atmospheric Limb Glow Shader
 * 
 * Renders atmospheric glow using additive blending.
 * Uses a larger sphere than Earth with front-face culling.
 */

#import "uniforms.wgsl"

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
};

const ATM_SCALE: f32 = 6471.0 / 6371.0; // 100km atmosphere

@vertex
fn vs(v: VIn) -> VOut {
  var out: VOut;
  let p = v.pos * ATM_SCALE;
  out.cp = uni.view_proj * vec4f(p, 1.0);
  out.wp = p;
  out.n  = v.nrm;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let N = normalize(in.n);
  let V = normalize(uni.camera_pos.xyz - in.wp);
  
  // Rim lighting for limb effect
  let rim   = 1.0 - abs(dot(N, V));
  let limb  = pow(rim, 3.5);
  let limb2 = pow(rim, 7.0);

  // Atmospheric colors
  let blue = vec3f(0.08, 0.38, 1.0) * limb * 2.8;
  let teal = vec3f(0.0, 0.7, 0.45) * limb2 * 0.6;
  let alpha = limb * 0.85;
  
  return vec4f(blue + teal, alpha);
}
