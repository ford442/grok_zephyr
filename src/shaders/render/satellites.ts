import satelliteWgsl from './satellites.wgsl';

export const satellites = satelliteWgsl;

export const satellitesCulled = satellites.replace(
  'struct VOut {',
  `@group(0) @binding(6) var<storage, read> visible_indices : array<u32>;

struct VOut {`,
).replace(
  `@vertex
fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  return satellite_vs(vi, ii);
}`,
  `@vertex
fn vs_culled(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  return satellite_vs(vi, visible_indices[ii]);
}`,
);
