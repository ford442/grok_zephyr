/** Laser Beam Shader — pattern-distinct ribbon beams with per-view intensity. WGSL source: ./beam.wgsl */
import source from './beam.wgsl';

export const BEAM_SHADER = source;

export const BEAM_CULLED_SHADER = BEAM_SHADER.replace(
  '@group(0) @binding(1) var<storage, read> beams : array<vec4f>;',
  `@group(0) @binding(1) var<storage, read> beams : array<vec4f>;
@group(0) @binding(2) var<storage, read> visible_beam_indices : array<u32>;`,
).replace(
  `@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  return beam_vs(instance, vi);
}`,
  `@vertex
fn vs_culled(@builtin(vertex_index) vi: u32, @builtin(instance_index) instance: u32) -> VOut {
  return beam_vs(visible_beam_indices[instance], vi);
}`,
);
