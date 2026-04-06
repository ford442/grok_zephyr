/**
 * Sky Strips Compute Shader (Summary)
 * 
 * Full implementation is in sky_strips_compute.wgsl
 * This is a TypeScript export wrapper for consistency
 */

export const SKY_STRIPS_SHADER = /* wgsl */ `
// See src/shaders/sky_strips_compute.wgsl for full implementation
// This shader implements 6 pattern types:
// - PULSE: Sinusoidal brightness modulation
// - CHASE: Moving chase lights with trails
// - WAVE: Sine wave propagation
// - BEAT_SYNC: Audio-reactive pulsing
// - MORSE: Binary on/off patterns
// - SPARKLE: Random twinkle effects
`;
