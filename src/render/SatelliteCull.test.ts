import { describe, expect, it } from 'vitest';
import { extractFrustum, mat4lookAt, mat4mul, mat4persp } from '@/utils/math.js';
import {
  isAboveHorizon,
  isSatelliteVisibleCpu,
  needsHorizonCull,
  sphereInFrustum,
} from '@/render/SatelliteCullCpu.js';
import { CONSTANTS } from '@/types/constants.js';

describe('SatelliteCullCpu', () => {
  it('rejects satellites beyond distance cull', () => {
    const cam: [number, number, number] = [0, 0, CONSTANTS.EARTH_RADIUS_KM + 1];
    const farSat: [number, number, number] = [200000, 0, CONSTANTS.ORBIT_RADIUS_KM];
    const view = mat4lookAt(cam, [0, 0, 0], [0, 1, 0]);
    const proj = mat4persp(Math.PI / 3, 16 / 9, 10, 500000);
    const frustum = extractFrustum(mat4mul(proj, view));

    expect(
      isSatelliteVisibleCpu({
        satIdx: 0,
        satPos: farSat,
        cameraPos: cam,
        viewMode: 3,
        isGroundView: true,
        distanceCullKm: 5000,
        frustum,
        selectedSatellite: -1,
      }),
    ).toBe(false);
  });

  it('force-includes selected satellite', () => {
    const cam: [number, number, number] = [0, 0, CONSTANTS.EARTH_RADIUS_KM + 1];
    const farSat: [number, number, number] = [200000, 0, CONSTANTS.ORBIT_RADIUS_KM];
    const view = mat4lookAt(cam, [0, 0, 0], [0, 1, 0]);
    const proj = mat4persp(Math.PI / 3, 16 / 9, 10, 500000);
    const frustum = extractFrustum(mat4mul(proj, view));

    expect(
      isSatelliteVisibleCpu({
        satIdx: 42,
        satPos: farSat,
        cameraPos: cam,
        viewMode: 3,
        isGroundView: true,
        distanceCullKm: 5000,
        frustum,
        selectedSatellite: 42,
      }),
    ).toBe(true);
  });

  it('applies horizon culling for ground and skyline modes', () => {
    expect(needsHorizonCull(3, true)).toBe(true);
    expect(needsHorizonCull(5, false)).toBe(true);
    expect(needsHorizonCull(1, false)).toBe(false);

    const observer: [number, number, number] = [CONSTANTS.EARTH_RADIUS_KM, 0, 0];
    const belowHorizon: [number, number, number] = [
      CONSTANTS.EARTH_RADIUS_KM * 0.5,
      0,
      -CONSTANTS.ORBIT_RADIUS_KM,
    ];
    expect(isAboveHorizon(belowHorizon, observer)).toBe(false);
  });

  it('rejects spheres fully outside a frustum plane', () => {
    const planes = [
      new Float32Array([1, 0, 0, 1000]),
      new Float32Array([-1, 0, 0, 1000]),
      new Float32Array([0, 1, 0, 1000]),
      new Float32Array([0, -1, 0, 1000]),
      new Float32Array([0, 0, 1, 1000]),
      new Float32Array([0, 0, -1, 1000]),
    ];
    expect(sphereInFrustum([0, 0, 0], 10, planes)).toBe(true);
    expect(sphereInFrustum([5000, 0, 0], 10, planes)).toBe(false);
  });
});
