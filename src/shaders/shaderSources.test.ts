/**
 * Guards against drift in canonical TypeScript shader exports (see #74).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SHADERS } from './index.js';
import { SGP4_RE_KM, SGP4_XKE } from '@/physics/sgp4NearEarth.js';
import { buildBloomDownsample } from './render/postProcess/bloomDownsample.js';

/**
 * `SHADERS.*` leaves still authored as TypeScript template strings. Anything
 * not listed here must come from a module that imports a `.wgsl` file, so a
 * new template-string shader fails CI until it is migrated or listed with a
 * reason. Keep reasons to one line.
 */
const TS_TEMPLATE_ALLOWLIST: Record<string, string> = {
  uniformStruct: 'generated from SCENE_UNI_SCHEMA; .wgsl files get it via #import "uniforms.wgsl"',
  'compute.satelliteCull': 'not yet migrated — cold path, only built with ?cull',
  'render.satellitesPick': 'not yet migrated — picking pass, rebuilt from satellites layout',
  'render.ground': 'not yet migrated — Ground View only',
  'render.skyline': 'not yet migrated — Ground View only',
  'render.volumetricBeam': 'not yet migrated — cinematic tier only',
  'render.moonForeground': 'not yet migrated — Moon View only',
  'render.moonEarthDisk': 'not yet migrated — Moon View only',
  'render.postProcess.bloomThreshold': 'struct emitted from THRESHOLD_UNI_SCHEMA in TS',
  'render.postProcess.bloomBlur': 'not yet migrated — small bloom kernel',
  'render.postProcess.bloomDownsample': 'f16/f32 variants built by buildBloomDownsample()',
  'render.postProcess.bloomUpsample': 'struct emitted from KAWASE_UNI_SCHEMA in TS',
  'render.postProcess.dofDownsample': 'not yet migrated — cinematic tier only',
  'render.postProcess.dofBlur': 'not yet migrated — cinematic tier only',
  'render.postProcess.dofComposite': 'not yet migrated — cinematic tier only',
  'render.postProcess.autoExposureHistogram': 'not yet migrated — small compute',
  'render.postProcess.autoExposureAdapt': 'not yet migrated — small compute',
  'render.postProcess.motionBlur': 'not yet migrated — cinematic tier only',
};

/** Barrel modules backing each `SHADERS` namespace. */
const BARRELS: Record<string, string> = {
  compute: './compute/index.ts',
  render: './render/index.ts',
  'render.postProcess': './render/postProcess/index.ts',
  animations: './animations/index.ts',
};

function shaderLeaves(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    shaderLeaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** Resolve `SHADERS.<path>` to the TS module that defines it, via the barrels. */
function sourceModuleFor(path: string): URL | null {
  const dot = path.lastIndexOf('.');
  const barrel = BARRELS[path.slice(0, dot)];
  if (!barrel) return null;
  const barrelUrl = new URL(barrel, import.meta.url);
  const key = path.slice(dot + 1);
  const exportRe = /export\s*\{([^}]*)\}\s*from\s*'([^']+)\.js'/g;
  for (const [, names, from] of readFileSync(barrelUrl, 'utf8').matchAll(exportRe)) {
    const exported = names.split(',').map((n) => n.trim().split(/\s+as\s+/).pop());
    if (exported.includes(key)) return new URL(`${from}.ts`, barrelUrl);
  }
  return null;
}

describe('shader source of truth', () => {
  it('every SHADERS export is a .wgsl module or on the TS template allowlist', () => {
    const leaves = shaderLeaves(SHADERS);
    const offenders = leaves.filter((path) => {
      if (path in TS_TEMPLATE_ALLOWLIST) return false;
      const module = sourceModuleFor(path);
      return !module || !/from\s*'[^']+\.wgsl'/.test(readFileSync(module, 'utf8'));
    });
    expect(offenders).toEqual([]);
    // Stale entries (migrated or removed shaders) must be dropped from the list.
    expect(Object.keys(TS_TEMPLATE_ALLOWLIST).filter((p) => !leaves.includes(p))).toEqual([]);
    for (const path of Object.keys(TS_TEMPLATE_ALLOWLIST)) {
      const module = sourceModuleFor(path);
      if (module) {
        expect(/from\s*'[^']+\.wgsl'/.test(readFileSync(module, 'utf8')), path).toBe(false);
      }
    }
  });

  it('hot shaders are authored as .wgsl with generated uniforms via #import', () => {
    const wgsl = (rel: string) => {
      const url = new URL(rel, import.meta.url);
      expect(existsSync(url), rel).toBe(true);
      return readFileSync(url, 'utf8');
    };
    for (const rel of [
      './compute/beam.wgsl',
      './compute/conjunction.wgsl',
      './compute/isl.wgsl',
      './render/beam.wgsl',
      './render/atmosphere.wgsl',
      './render/earth.wgsl',
      './render/stars.wgsl',
      './render/conjunction.wgsl',
      './render/conjunctionDensity.wgsl',
      './render/isl.wgsl',
    ]) {
      expect(wgsl(rel), rel).toContain('#import "uniforms.wgsl"');
    }
    expect(wgsl('./render/earth.wgsl')).toContain('#import "terrainCommon.wgsl"');
    expect(wgsl('./animations/smileV2.wgsl')).toContain('#import "smileV2Compute.wgsl"');
    expect(SHADERS.animations.smileV2).not.toMatch(/^\s*#import/m);
    expect(SHADERS.animations.smileV2).toContain('fn smile_v2_compute');
    expect(SHADERS.animations.smileV2).toContain('array<u32>');
    expect(SHADERS.render.earth).toContain('struct Uni');
    expect(SHADERS.render.beamCulled).toContain('fn vs_culled');
    expect(SHADERS.render.satellitesCulled).toContain('fn vs_culled');
  });

  it('authors orbital, satellites, and composite as WGSL files', () => {
    const orbital = readFileSync(new URL('./compute/orbital.wgsl', import.meta.url), 'utf8');
    const satellites = readFileSync(new URL('./render/satellites.wgsl', import.meta.url), 'utf8');
    const composite = readFileSync(
      new URL('./render/postProcess/composite.wgsl', import.meta.url),
      'utf8',
    );
    expect(orbital).toContain('#import "uniforms.wgsl"');
    expect(satellites).toContain('#import "uniforms.wgsl"');
    expect(composite).toContain('#import "uni_struct.wgsl"');
    expect(composite).toContain('#import "bloom_composite.wgsl"');
  });

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

  it('orbital compute uses a pipeline-constant fleet guard', () => {
    expect(SHADERS.compute.orbital).toContain('override num_satellites');
    expect(SHADERS.compute.orbital).toContain('if (i >= num_satellites)');
  });

  it('orbital compute discards sats not yet active in the growth era', () => {
    expect(SHADERS.compute.orbital).toContain('active_from');
    expect(SHADERS.compute.orbital).toContain('growth.enabled');
    expect(SHADERS.compute.orbital).toContain('era_day');
  });

  it('ISL compute uses plane-neighbor topology independent of beam patterns', () => {
    const isl = SHADERS.compute.isl;
    expect(isl).toContain('walkerNeighbor');
    expect(isl).toContain('MAX_ISL_LINKS');
    expect(isl).toContain('131072u');
    expect(SHADERS.render.isl).toContain('focused');
    expect(SHADERS.render.isl).not.toContain('beamPalette');
  });

  it('orbital compute branches on packed physics mode bits', () => {
    const orbital = SHADERS.compute.orbital;
    expect(orbital).toContain('PHYSICS_MODE_SHIFT');
    expect(orbital).toContain('keplerianJ2Position');
    expect(orbital).toContain('physicsMode >= 1u');
  });

  it('generated Uni and bloom structs are present in shader sources', () => {
    expect(SHADERS.uniformStruct).toContain('struct Uni');
    expect(SHADERS.uniformStruct).toContain('sun_position');
    expect(SHADERS.render.postProcess.bloomThreshold).toContain('struct ThresholdUni');
    expect(SHADERS.render.postProcess.bloomDownsample).toContain('struct KawaseUni');
    expect(SHADERS.render.postProcess.composite).toContain('struct BloomCompositeUni');
    expect(SHADERS.render.postProcess.composite).toContain('struct Uni');
  });

  it('bloom downsample f16 path enables shader-f16 and keeps the f32 fallback', () => {
    expect(SHADERS.render.postProcess.bloomDownsample).not.toContain('enable f16');
    const f16 = buildBloomDownsample(true);
    expect(f16.startsWith('enable f16;')).toBe(true);
    expect(f16).toContain('vec3<f16>');
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
    expect(skyline).toContain('displayType');
    expect(skyline).toContain('facadeMeta');
    expect(skyline).toContain('fn ledMatrixDisplay');
    expect(skyline).toContain('fn laserScanDisplay');
    expect(skyline).toContain('fn spotlightDisplay');
    expect(skyline).toContain('fn neonStripDisplay');
    expect(skyline).toContain('fn facadeDisplayColor');
    expect(skyline).toContain('displayFilter');
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

  it('orbital mode 3 near-earth SGP4 kernel mirrors sgp4NearEarth.ts constants and layout', () => {
    const orbital = SHADERS.compute.orbital;
    expect(orbital).toContain('@group(0) @binding(7) var<storage, read> sgp4_elem');
    expect(orbital).toContain('fn sgp4NearEarth(');
    expect(orbital).toContain('physicsMode == 3u && realismOn');
    const constant = (name: string) =>
      Number(new RegExp(`const ${name}\\s*:\\s*f32\\s*=\\s*([-0-9.e]+)`).exec(orbital)?.[1]);
    expect(Math.abs(constant('SGP4_XKE') - SGP4_XKE)).toBeLessThan(1e-9);
    expect(constant('SGP4_RE_KM')).toBe(SGP4_RE_KM);
    expect(Math.abs(constant('SGP4_J3OJ2') - -0.00000253881 / 0.001082616)).toBeLessThan(1e-9);
  });
});
