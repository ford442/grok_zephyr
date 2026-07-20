export const SMILE_V2_PHASES = /* wgsl */ `// =================================================================================
// ANIMATION PHASE CALCULATIONS
// =================================================================================

/**
 * Calculate animation phase and local progress within phase.
 * 
 * @param cycle_time Current time in cycle [0, 48]
 * @return vec2f(phase_index, phase_progress)
 */
fn get_animation_phase(cycle_time: f32) -> vec2f {
  var phase: f32 = 0.0;
  var progress: f32 = 0.0;
  
  if (cycle_time < PHASE_1_START) {
    // Phase 0: Idle
    phase = 0.0;
    progress = cycle_time / PHASE_0_IDLE;
  } else if (cycle_time < PHASE_2_START) {
    // Phase 1: Emerge
    phase = 1.0;
    progress = (cycle_time - PHASE_1_START) / PHASE_1_EMERGE;
  } else if (cycle_time < PHASE_3_START) {
    // Phase 2: Blink
    phase = 2.0;
    progress = (cycle_time - PHASE_2_START) / PHASE_2_BLINK;
  } else if (cycle_time < PHASE_4_START) {
    // Phase 3: Twinkle
    phase = 3.0;
    progress = (cycle_time - PHASE_3_START) / PHASE_3_TWINKLE;
  } else if (cycle_time < PHASE_5_START) {
    // Phase 4: Glow
    phase = 4.0;
    progress = (cycle_time - PHASE_4_START) / PHASE_4_GLOW;
  } else if (cycle_time < PHASE_6_START) {
    // Phase 5: Morph
    phase = 5.0;
    progress = (cycle_time - PHASE_5_START) / PHASE_5_MORPH;
  } else {
    // Phase 6: Fade
    phase = 6.0;
    progress = (cycle_time - PHASE_6_START) / PHASE_6_FADE;
  }
  
  return vec2f(phase, clamp(progress, 0.0, 1.0));
}

/**
 * Generate deterministic random value from satellite index.
 * Used for twinkling and other per-satellite variations.
 */
fn hash_u32(n: u32) -> f32 {
  // PCG hash variant for good distribution
  var state: u32 = n * 747796405u + 2891336453u;
  var word: u32 = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  word = (word >> 22u) ^ word;
  return f32(word) / 4294967295.0;  // Normalize to [0, 1]
}

/**
 * PHASE 0: IDLE
 * Subtle breathing, satellites at base brightness.
 * No smile visible yet.
 */
fn phase_idle(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  global_time: f32,
  sat_idx: u32,
  sat_pos: vec3f
) -> vec3f {
  // Very subtle global breathing
  let breathe = 1.0 + sin(global_time * 0.5) * 0.05;
  return base_color * base_bright * breathe;
}

/**
 * PHASE 1: EMERGE
 * Smile fades in from base color to target colors.
 * Ease-out cubic interpolation for smooth appearance.
 */
fn phase_emerge(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Smooth ease-out: 1 - (1 - t)^3
  let t = 1.0 - pow(1.0 - progress, 3.0);
  
  var target_color: vec3f;
  var target_bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_RIGHT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_SMILE_CURVE: {
      target_color = COLOR_GOLDEN;
      target_bright = 1.0;
    }
    default: {
      // Non-feature satellites dim slightly
      target_color = base_color * 0.7;
      target_bright = base_bright * 0.8;
    }
  }
  
  let color = mix(base_color * base_bright, target_color * target_bright, t);
  return vec4f(color, 1.0);
}

/**
 * PHASE 2: BLINK
 * Eyes blink in alternating sequence.
 * Left eye blinks at 25% and 75% of phase.
 * Right eye blinks at 0%, 50%, and 100% (opposite).
 */
fn phase_blink(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      // Blink at 0.25 and 0.75
      let blink_phase = fract(progress * 2.0);
      let blink = 1.0 - smoothstep(0.45, 0.5, blink_phase) * smoothstep(0.55, 0.5, blink_phase);
      color = COLOR_AMBER;
      bright = 1.2 * blink;
    }
    case FEATURE_RIGHT_EYE: {
      // Blink at 0.0, 0.5, 1.0 (offset by 0.5)
      let blink_phase = fract(progress * 2.0 + 0.5);
      let blink = 1.0 - smoothstep(0.45, 0.5, blink_phase) * smoothstep(0.55, 0.5, blink_phase);
      color = COLOR_AMBER;
      bright = 1.2 * blink;
    }
    case FEATURE_SMILE_CURVE: {
      // Smile maintains steady golden glow
      color = COLOR_GOLDEN;
      bright = 1.0 + sin(progress * 6.28318) * 0.1;  // Subtle pulse
    }
    default: {
      color = base_color * 0.7;
      bright = base_bright * 0.8;
    }
  }
  
  return vec4f(color * bright, 1.0);
}

/**
 * PHASE 3: TWINKLE
 * Traveling sparkle wave moves left to right across smile.
 * Individual random twinkles on smile satellites.
 */
fn phase_twinkle(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32,
  uv: vec2f
) -> vec4f {
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE, FEATURE_RIGHT_EYE: {
      // Eyes maintain steady glow
      color = COLOR_AMBER;
      bright = 1.1 + sin(progress * 4.0) * 0.1;
    }
    case FEATURE_SMILE_CURVE: {
      // Traveling wave from left to right
      // Normalize x position to [0, 1]
      let normalized_x = (uv.x - SMILE_X_MIN) / (SMILE_X_MAX - SMILE_X_MIN);
      
      // Wave position moves with progress
      let wave_pos = fract(progress * 3.0);  // 3 waves per phase
      let dist_to_wave = abs(normalized_x - wave_pos);
      
      // Sparkle boost when near wave
      let wave_sparkle = 1.0 + smoothstep(0.15, 0.0, dist_to_wave) * 0.6;
      
      // Individual random twinkle
      let hash_val = hash_u32(sat_idx);
      let individual_twinkle = 1.0 + sin(hash_val * 100.0 + progress * 15.0) * 0.2;
      
      color = COLOR_GOLDEN;
      bright = 1.0 * wave_sparkle * individual_twinkle;
    }
    default: {
      color = base_color * 0.7;
      bright = base_bright * 0.8;
    }
  }
  
  return vec4f(color * bright, 1.0);
}

/**
 * PHASE 4: GLOW
 * Full brightness pulse, all features glow intensely.
 * Warm color shift from amber/golden toward warm white.
 */
fn phase_glow(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Intense pulse: 1.0 -> 1.5 -> 1.0
  let pulse = 1.0 + sin(progress * 3.14159) * 0.5;
  
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE, FEATURE_RIGHT_EYE: {
      // Shift from amber toward warm white
      let eye_color = mix(COLOR_AMBER, COLOR_WARM_WHITE, pulse - 1.0);
      color = eye_color;
      bright = 1.2 * pulse;
    }
    case FEATURE_SMILE_CURVE: {
      // Shift from golden toward warm white
      let smile_color = mix(COLOR_GOLDEN, COLOR_WARM_WHITE, pulse - 1.0);
      color = smile_color;
      bright = 1.0 * pulse;
    }
    default: {
      // Non-feature satellites catch some ambient glow
      color = base_color;
      bright = base_bright * (0.8 + pulse * 0.2);
    }
  }
  
  return vec4f(color * bright, 1.0);
}

/**
 * PHASE 5: MORPH
 * Transform to X logo or "GROK" text in center region.
 * Features outside morph region fade to support the morph target.
 */
fn phase_morph(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Smooth morph transition
  let morph_t = smoothstep(0.0, 1.0, progress);
  
  var color: vec3f;
  var bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE, FEATURE_RIGHT_EYE: {
      // Eyes fade to support morph
      let dim = 1.0 - morph_t * 0.7;
      color = COLOR_AMBER * dim;
      bright = 1.2 * dim;
    }
    case FEATURE_SMILE_CURVE: {
      // Smile fades to support morph
      let dim = 1.0 - morph_t * 0.6;
      color = COLOR_GOLDEN * dim;
      bright = 1.0 * dim;
    }
    case FEATURE_MORPH_TARGET: {
      // Morph target brightens and pulses
      if (params.morph_mode == 0u) {
        // X logo - black with cyan outline
        color = mix(COLOR_X_LOGO, COLOR_CYAN_ACCENT, morph_t * 0.5);
      } else {
        // GROK text - purple glow
        color = mix(COLOR_WARM_WHITE, COLOR_GROK_GLOW, morph_t);
      }
      bright = 1.5 + sin(progress * 6.28318 * 2.0) * 0.3;
    }
    default: {
      color = base_color * 0.5;
      bright = base_bright * 0.6;
    }
  }
  
  return vec4f(color * bright, 1.0);
}

/**
 * PHASE 6: FADE
 * Fade back to idle state.
 * Ease-in interpolation for smooth disappearance.
 */
fn phase_fade(
  base_color: vec3f,
  base_bright: f32,
  progress: f32,
  feature: u32,
  sat_idx: u32
) -> vec4f {
  // Ease-in: t^2
  let t = progress * progress;
  
  var target_color: vec3f;
  var target_bright: f32;
  
  switch (feature) {
    case FEATURE_LEFT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_RIGHT_EYE: {
      target_color = COLOR_AMBER;
      target_bright = 1.2;
    }
    case FEATURE_SMILE_CURVE: {
      target_color = COLOR_GOLDEN;
      target_bright = 1.0;
    }
    case FEATURE_MORPH_TARGET: {
      if (params.morph_mode == 0u) {
        target_color = COLOR_X_LOGO;
      } else {
        target_color = COLOR_GROK_GLOW;
      }
      target_bright = 1.5;
    }
    default: {
      target_color = base_color * 0.7;
      target_bright = base_bright * 0.8;
    }
  }
  
  let color = mix(target_color * target_bright, base_color * base_bright, t);
  return vec4f(color, 1.0);
}
`;
