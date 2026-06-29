/**
 * Guards against drift in canonical TypeScript shader exports (see #74).
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from './index.js';

describe('shader source of truth', () => {
  it('canonical satellite shader uses distance LOD kernel tiers', () => {
    expect(SHADERS.render.satellites).toContain('fn resolveLodKernel');
    expect(SHADERS.render.satellites).toContain('LOD_NEAR_KM');
    expect(SHADERS.render.satellites).toContain('MOON_BILLBOARD_SCALE');
    expect(SHADERS.render.satellites).toContain('world_dist');
  });

  it('canonical bloom threshold supports optional shipping floors', () => {
    const bloom = SHADERS.render.postProcess.bloomThreshold;
    expect(bloom).toContain('enforce_floors');
    expect(bloom).toContain('max(tuni.threshold, 1.5)');
    expect(bloom).not.toContain('smoothstep(0.75, 1.4, lum)');
  });

  it('canonical bloom threshold attenuates star mid-band vs satellite cores', () => {
    const bloom = SHADERS.render.postProcess.bloomThreshold;
    expect(bloom).toContain('fn sourceBloomWeight');
    expect(bloom).toContain('sourceBloomWeight(luminance)');
  });

  it('canonical composite layers star vs satellite bloom using scene luminance', () => {
    const composite = SHADERS.render.postProcess.composite;
    expect(composite).toContain('compositeBloom(bloom, scene');
    expect(composite).toContain('starMix');
    expect(composite).toContain('satMix');
  });

  it('pattern animation uses tiered vertex bright for bloom floor 1.5', () => {
    expect(SHADERS.render.satellites).toContain('fn patternVertexBright');
    expect(SHADERS.render.satellites).toContain('PATTERN_TIER_HERO');
    expect(SHADERS.render.satellites).toContain('pattern_feature');
    expect(SHADERS.render.satellites).not.toContain('out.bright *= 2.5');
  });

  it('pattern modes use tiered vertex bright, not blanket 2.5× boost', () => {
    const sat = SHADERS.render.satellites;
    expect(sat).toContain('struct PatternSample');
    expect(sat).toContain('PATTERN_TIER_BG');
    expect(sat).toContain('params.pattern_mode > 0u');
  });

  it('canonical stars shader caps HDR for sub-bloom magnitude distribution', () => {
    expect(SHADERS.render.stars).toContain('fn starHdrLuminance');
    expect(SHADERS.render.stars).toContain('groundStarScale');
  });
});
