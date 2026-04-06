/**
 * Smile from the Moon v2 Shader (Summary)
 * 
 * Full implementation is in animations/smile_v2.wgsl
 * This is a TypeScript export wrapper for consistency
 */

// The full shader is loaded from the .wgsl file directly
// This export serves as a marker for the build system
export const SMILE_V2_SHADER = /* wgsl */ `
// See src/shaders/animations/smile_v2.wgsl for full implementation
// This shader implements a 48-second 7-phase smile animation:
// - Phase 0 (4s): Idle breathing
// - Phase 1 (6s): Emerge - fade in
// - Phase 2 (8s): Blink - alternating eye blinks  
// - Phase 3 (10s): Twinkle - sparkle wave
// - Phase 4 (8s): Glow - full brightness pulse
// - Phase 5 (8s): Morph - transform to X/GROK
// - Phase 6 (4s): Fade - dissolve with trails
`;
