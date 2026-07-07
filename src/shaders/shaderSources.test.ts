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

  it('canonical satellite shader uses God-only LOD bands and shell emphasis', () => {
    const sat = SHADERS.render.satellites;
    expect(sat).toContain('GOD_LOD_NEAR_KM');
    expect(sat).toContain('GOD_LOD_MID_KM');
    expect(sat).toContain('isGodView');
    expect(sat).toContain('shellIdx == 0u');
  });

  it('canonical satellite shader uses Fleet POV near-field LOD and velocity stretch', () => {
    const sat = SHADERS.render.satellites;
    expect(sat).toContain('FLEET_LOD_NEAR_KM');
    expect(sat).toContain('isFleetView');
    expect(sat).toContain('host_velocity');
    expect(sat).toContain('uni.time_scale');
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

  it('moon foreground shader grounds the lunar surface in Moon View', () => {
    const moon = SHADERS.render.moonForeground;
    expect(moon).toContain('isMoonView');
    expect(moon).toContain('FOREGROUND_HEIGHT');
    expect(moon).toContain('EARTH_ANG_RAD');
  });

  it('moon earth disk reinforces the blue marble at correct angular size', () => {
    const disk = SHADERS.render.moonEarthDisk;
    expect(disk).toContain('EARTH_ANG_RAD');
    expect(disk).toContain('Earthshine on the night hemisphere');
    expect(disk).toContain('isMoonView');
  });

  it('earth shader adds earthshine for Moon View', () => {
    expect(SHADERS.render.earth).toContain('earthshine');
    expect(SHADERS.render.earth).toContain('blue-marble');
    expect(SHADERS.render.stars).toContain('earthDiskGlow');
    expect(SHADERS.render.stars).toContain('earthMask');
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

  it('skyline shader uses per-floor HDR windows, depth fog, and street sodium', () => {
    const skyline = SHADERS.render.skyline;
    expect(skyline).toContain('fn applyCityFog');
    expect(skyline).toContain('fn softWindowMask');
    expect(skyline).toContain('fn facadeCornerAO');
    expect(skyline).toContain('floorBright');
    expect(skyline).toContain('hdrCore');
    expect(skyline).toContain('clamp((2.05');
    expect(skyline).toContain('sodium');
    expect(skyline).toContain('roofEquip');
    expect(skyline).toContain('camera_enu');
    expect(skyline).toContain('flicker');
    expect(skyline).toContain('recessShade');
  });

  it('beam shaders encode pattern personality and per-view intensity', () => {
    const ribbon = SHADERS.render.beam;
    const compute = SHADERS.compute.beam;
    const vol = SHADERS.render.volumetricBeam;
    expect(ribbon).toContain('fn viewBeamScale');
    expect(ribbon).toContain('fn groundProjectionTint');
    expect(ribbon).toContain('fn beamPalette');
    expect(ribbon).toContain('atmScatter');
    expect(ribbon).toContain('dropout');
    expect(compute).toContain('fn patternPulse');
    expect(compute).toContain('fn patternThickness');
    expect(compute).toContain('dropout');
    expect(vol).toContain('fn patternVolScales');
    expect(vol).toContain('fn patternVolPulse');
    expect(vol).toContain('viewBeamScale');
  });

  it('viewBeamScale in ribbon shader matches BeamPatternProfile table', () => {
    const ribbon = SHADERS.render.beam;
    expect(ribbon).toContain('case 2u: { return 0.4; }');
    expect(ribbon).toContain('case 3u: { return 0.6; }');
    expect(ribbon).toContain('case 4u: { return 1.3; }');
  });
});
