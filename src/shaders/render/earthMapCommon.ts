/**
 * Earth photometric plate bindings, shared by the orbital Earth shader and the
 * Ground View horizon shader so both sample one set of textures — there is no
 * second Earth (src/render/EarthTextures.ts, docs/EARTH_MAPS.md).
 *
 * Both shaders bind this as @group(1). The bindings are always present:
 * unloaded slots hold a 1x1 placeholder and `earthMaps.flags` is 0, which
 * selects each shader's original procedural path.
 */

export const EARTH_MAP_BINDINGS = /* wgsl */ `
struct EarthMapSettings {
  // Bit 0 albedo, bit 1 night lights, bit 2 clouds. 0 = fully procedural.
  flags: u32,
  cloud_speed: f32,
  night_gain: f32,
  cloud_gain: f32,
}

@group(1) @binding(0) var earthMapSampler: sampler;
@group(1) @binding(1) var albedoMap: texture_2d<f32>;
@group(1) @binding(2) var nightMap: texture_2d<f32>;
@group(1) @binding(3) var cloudMap: texture_2d<f32>;
@group(1) @binding(4) var<uniform> earthMaps: EarthMapSettings;

// Equirectangular UV from body-frame lat/lon. v = 0 is the north pole row,
// matching how the Blue Marble and VIIRS plates are laid out.
fn equirectUV(lat: f32, lon: f32) -> vec2f {
  return vec2f(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
}
`;
