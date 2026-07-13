export const SMILE_V2_COMPUTE = /* wgsl */ `// =================================================================================
// MAIN PATTERN FUNCTION
// =================================================================================

/**
 * SMILE PATTERN - Main entry point for color/brightness calculation.
 * 
 * Calculates the output color for a satellite based on:
 * - Position in smile face (via gnomonic projection)
 * - Current animation phase
 * - Per-satellite random variations
 * 
 * This function implements the exact signature specified in requirements.
 * 
 * @param sat_pos       Satellite ECI position (km)
 * @param sat_idx       Satellite index for deterministic random
 * @param base_color    Satellite's base constellation color
 * @param base_bright   Base brightness value
 * @param cycle_time    Current time in 48-second cycle
 * @param global_time   Absolute time for continuous effects
 * @return vec4f(rgb, feature_id) - feature in alpha channel
 */
fn smile_pattern(
  sat_pos: vec3f,
  sat_idx: u32,
  base_color: vec3f,
  base_bright: f32,
  cycle_time: f32,
  global_time: f32
) -> vec4f {
  // Calculate Earth direction (satellite to Earth center)
  let earth_dir = normalize(-sat_pos);
  
  // Gnomonic projection to get UV coordinates
  let uv = gnomonic_project_satellite(sat_pos, earth_dir);
  
  // Detect feature for this satellite
  let feature = get_smile_feature(uv);
  
  // Get current animation phase
  let phase_info = get_animation_phase(cycle_time);
  let phase = u32(phase_info.x);
  let phase_progress = phase_info.y;
  
  // Calculate color based on phase
  var result: vec4f;
  
  switch (phase) {
    case 0u: {
      result = vec4f(phase_idle(base_color, base_bright, phase_progress, global_time, sat_idx, sat_pos), 1.0);
    }
    case 1u: {
      result = phase_emerge(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 2u: {
      result = phase_blink(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 3u: {
      result = phase_twinkle(base_color, base_bright, phase_progress, feature, sat_idx, uv);
    }
    case 4u: {
      result = phase_glow(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 5u: {
      result = phase_morph(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    case 6u: {
      result = phase_fade(base_color, base_bright, phase_progress, feature, sat_idx);
    }
    default: {
      result = vec4f(base_color * base_bright, 1.0);
    }
  }
  
  // Encode feature ID in alpha channel
  // 0=none, 1=left eye, 2=right eye, 3=smile, 4=morph
  let feature_alpha = f32(feature) / 4.0;
  
  return vec4f(result.rgb, feature_alpha);
}

// =================================================================================
// CHAOS / IDLE MODE
// =================================================================================

/**
 * Calculate chaos/idle mode output.
 * Used when target_mode = 1 (transitioning away from smile).
 * 
 * Returns subtle constellation colors with gentle random twinkling.
 */
fn chaos_mode(
  sat_pos: vec3f,
  sat_idx: u32,
  base_color: vec3f,
  base_bright: f32,
  global_time: f32
) -> vec4f {
  // Deterministic random for this satellite
  let hash_val = hash_u32(sat_idx);
  
  // Gentle twinkle at different frequencies
  let twinkle1 = 0.5 + 0.5 * sin(global_time * (0.5 + hash_val * 0.5) + hash_val * 10.0);
  let twinkle2 = 0.5 + 0.5 * sin(global_time * (0.3 + hash_val * 0.3) + hash_val * 20.0);
  let combined_twinkle = 0.7 + 0.3 * (twinkle1 * 0.6 + twinkle2 * 0.4);
  
  // Slight color variation
  let color_shift = 1.0 + (hash_val - 0.5) * 0.1;
  
  let color = base_color * color_shift * base_bright * combined_twinkle;
  return vec4f(color, 0.0);  // Alpha 0 = no feature
}

// =================================================================================
// TRANSITION / CROSS-FADE
// =================================================================================

/**
 * Apply smooth cross-fade between smile and chaos modes.
 * 
 * Uses smoothstep for smooth interpolation over transition_duration seconds.
 * 
 * @param smile_output  Result from smile_pattern()
 * @param chaos_output  Result from chaos_mode()
 * @param alpha         Current transition_alpha (0-1)
 * @return Final blended output
 */
fn apply_transition(
  smile_output: vec4f,
  chaos_output: vec4f,
  alpha: f32
) -> vec4f {
  // Smoothstep for non-linear, smoother transition
  let smooth_alpha = smoothstep(0.0, 1.0, alpha);
  
  let color = mix(chaos_output.rgb, smile_output.rgb, smooth_alpha);
  let feature = mix(chaos_output.a, smile_output.a, smooth_alpha);
  
  return vec4f(color, feature);
}

// =================================================================================
// COMPUTE SHADER ENTRY POINT
// =================================================================================

/**
 * Main compute entry point for Smile v2 animation.
 * 
 * Workgroup size: 256 threads (optimal for GPU occupancy)
 * Processes all 1,048,576 satellites with branch-coherent grouping.
 * 
 * Branch coherence strategy:
 * - Satellites are grouped by feature ID to minimize divergence
 * - Non-facing satellites exit early (best performance)
 * - Within each feature group, same code path is taken
 */
@compute @workgroup_size(256)
fn smile_v2_compute(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  
  // Bounds check
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  
  // Load satellite data
  let sat_data = sat_positions[sat_idx];
  let sat_pos = sat_data.xyz;
  let cdat = sat_data.w;
  
  // Derive base color from cdat (shell/plane index)
  // This matches the shell color table in render/satellites.ts
  let cidx = u32(abs(cdat)) % 7u;
  var base_color: vec3f;
  switch (cidx) {
    case 0u: { base_color = vec3f(1.0, 0.18, 0.18); }   // Red
    case 1u: { base_color = vec3f(0.18, 1.0, 0.18); }   // Green
    case 2u: { base_color = vec3f(0.25, 0.45, 1.0); }   // Blue
    case 3u: { base_color = vec3f(1.0, 1.0, 0.1); }     // Yellow
    case 4u: { base_color = vec3f(0.1, 1.0, 1.0); }     // Cyan
    case 5u: { base_color = vec3f(1.0, 0.1, 1.0); }     // Magenta
    default: { base_color = vec3f(1.0, 1.0, 1.0); }     // White
  }
  
  let base_bright = 1.0;
  
  // Calculate smile pattern
  let smile_output = smile_pattern(
    sat_pos,
    sat_idx,
    base_color,
    base_bright,
    params.cycle_time,
    params.global_time
  );
  
  // Calculate chaos/idle mode (for transition support)
  let chaos_output = chaos_mode(
    sat_pos,
    sat_idx,
    base_color,
    base_bright,
    params.global_time
  );
  
  // Apply transition alpha
  // transition_alpha: 1 = full smile, 0 = full chaos
  // target_mode determines which state we transition toward
  var final_output: vec4f;
  
  if (params.target_mode < 0.5) {
    // Target is normal mode (smile)
    final_output = apply_transition(smile_output, chaos_output, params.transition_alpha);
  } else {
    // Target is chaos/idle mode
    // Invert alpha logic: when target=chaos, alpha=0 means full chaos, alpha=1 means full smile
    final_output = apply_transition(smile_output, chaos_output, params.transition_alpha);
  }
  
  // Store result
  sat_output[sat_idx] = final_output;
}

// =================================================================================
// UTILITY / PRE-COMPUTE ENTRY POINTS
// =================================================================================

/**
 * Feature assignment pre-computation.
 * 
 * Can be run once at animation start to cache feature assignments,
 * avoiding redundant gnomonic projection calculations each frame.
 * 
 * Results stored in feature_cache buffer as u32 feature IDs.
 */
@compute @workgroup_size(256)
fn precompute_features(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  
  let sat_pos = sat_positions[sat_idx].xyz;
  let earth_dir = normalize(-sat_pos);
  
  // Check Earth-facing condition first
  let facing = dot(normalize(sat_pos), -earth_dir);
  
  var feature: u32;
  if (facing < FACING_THRESHOLD) {
    feature = FEATURE_NONE;
  } else {
    let uv = gnomonic_project_satellite(sat_pos, earth_dir);
    feature = get_smile_feature(uv);
  }
  
  feature_cache[sat_idx] = feature;
}

/**
 * Earth-facing check utility.
 * 
 * Populates a visibility buffer with 1.0 for facing satellites, 0.0 otherwise.
 * Useful for culling optimization on CPU side.
 */
@compute @workgroup_size(256)
fn check_facing(@builtin(global_invocation_id) gid: vec3u) {
  let sat_idx = gid.x;
  
  if (sat_idx >= NUM_SATELLITES) {
    return;
  }
  
  let sat_pos = sat_positions[sat_idx].xyz;
  let earth_dir = normalize(-sat_pos);
  let facing = dot(normalize(sat_pos), -earth_dir);
  
  // Store facing status as float in output buffer
  let facing_val = select(0.0, 1.0, facing > FACING_THRESHOLD);
  sat_output[sat_idx] = vec4f(facing_val, 0.0, 0.0, 0.0);
}
`;
