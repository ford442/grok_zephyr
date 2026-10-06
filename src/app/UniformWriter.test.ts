import { describe, expect, it } from 'vitest';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { packSceneUniforms } from '@/app/UniformWriter.js';
import { viewDescriptorFromCameraState } from '@/camera/ViewDescriptor.js';
import type { CameraState } from '@/camera/cameraTypes.js';
import { SCENE_UNI_BYTE_SIZE, SCENE_UNI_LAYOUT } from '@/shaders/schemas/sceneUni.js';
import { stageMatrixFromCameraState } from '@/xr/XrAnchors.js';
import { mat4Identity, viewDescriptorForXrEye } from '@/xr/XrPoseBridge.js';
import { mat4frustum } from '@/utils/math.js';

const anchor: CameraState = {
  position: [7091, 0, 0],
  target: [7200, 50, 20],
  up: [0, 0, 1],
  fov: (60 * Math.PI) / 180,
  near: 10,
  far: 500000,
};

function fakeRuntime(viewModeIndex = 1): AppRuntime {
  return {
    camera: { getViewModeIndex: () => viewModeIndex },
    simulation: {
      currentPhysicsMode: 2,
      realismMode: false,
      sunMode: 'art',
      earthRotationEnabled: false,
      clock: { simTime: 120, rate: 10, simUtcMs: Date.UTC(2026, 0, 1) },
    },
    buffers: null,
  } as unknown as AppRuntime;
}

function field(name: string) {
  const f = SCENE_UNI_LAYOUT.byName.get(name);
  if (!f) throw new Error(`missing ${name}`);
  return f;
}

function f32At(bytes: ArrayBuffer, name: string, count: number): number[] {
  return Array.from(new Float32Array(bytes, field(name).offset, count));
}

function u32At(bytes: ArrayBuffer, name: string): number {
  return new Uint32Array(bytes, field(name).offset, 1)[0];
}

/** Stereo eye 32 mm either side of the anchor, symmetric-ish off-axis frusta (m, XR convention). */
function eye(eyeIndex: 0 | 1) {
  const ipdHalfM = 0.032;
  const viewMatrix = mat4Identity();
  viewMatrix[12] = eyeIndex === 0 ? ipdHalfM : -ipdHalfM;
  const inner = eyeIndex === 0 ? 0.9 : 1.1;
  const outer = eyeIndex === 0 ? 1.1 : 0.9;
  const projectionMatrix = mat4frustum(-outer * 0.1, inner * 0.1, -0.1, 0.1, 0.1, 1000);
  return viewDescriptorForXrEye(stageMatrixFromCameraState(anchor), {
    viewMatrix,
    projectionMatrix,
    viewportWidth: 1832,
    viewportHeight: 1920,
    eyeIndex,
  });
}

describe('packSceneUniforms', () => {
  it('emits one 272-byte Uni block', () => {
    const desc = viewDescriptorFromCameraState(anchor, 1280, 720);
    const bytes = packSceneUniforms(fakeRuntime(), 1.5, 0.016, desc);
    expect(bytes.byteLength).toBe(SCENE_UNI_BYTE_SIZE);
    expect(SCENE_UNI_BYTE_SIZE).toBe(272);
  });

  it('packs the camera view mode, or the override, into view_flags bits 0-15', () => {
    const desc = viewDescriptorFromCameraState(anchor, 1280, 720);
    const mono = packSceneUniforms(fakeRuntime(1), 1.5, 0.016, desc);
    expect(u32At(mono, 'view_mode') & 0xffff).toBe(1);
    // physics mode (J2 = 2) stays in bits 17-19
    expect((u32At(mono, 'view_mode') >> 17) & 0x7).toBe(2);

    const xr = packSceneUniforms(fakeRuntime(1), 1.5, 0.016, desc, { viewModeOverride: 0 });
    expect(u32At(xr, 'view_mode') & 0xffff).toBe(0);
    expect((u32At(xr, 'view_mode') >> 17) & 0x7).toBe(2);
  });

  it('gives each XR eye its own view_proj, camera_pos, frustum and screen size', () => {
    const rt = fakeRuntime();
    const left = eye(0);
    const right = eye(1);
    const l = packSceneUniforms(rt, 2, 0.011, left, { viewModeOverride: 0 });
    const r = packSceneUniforms(rt, 2, 0.011, right, { viewModeOverride: 0 });

    expect(f32At(l, 'view_proj', 16)).toEqual(Array.from(left.viewProjection));
    expect(f32At(r, 'view_proj', 16)).toEqual(Array.from(right.viewProjection));
    expect(f32At(l, 'view_proj', 16)).not.toEqual(f32At(r, 'view_proj', 16));

    // Eyes sit at the anchor; 64 mm IPD is below f32 resolution at 7,000 km,
    // so stereo comes from the per-eye view/projection, not camera_pos.
    const lPos = f32At(l, 'camera_pos', 3);
    expect(lPos[0]).toBeCloseTo(anchor.position[0], 1);
    expect(lPos[1]).toBeCloseTo(anchor.position[1], 1);
    expect(lPos[2]).toBeCloseTo(anchor.position[2], 1);

    expect(f32At(l, 'frustum', 24)).toEqual(left.frustum.flatMap((p) => Array.from(p)).map(Math.fround));
    expect(f32At(r, 'frustum', 24)).toEqual(right.frustum.flatMap((p) => Array.from(p)).map(Math.fround));
    expect(f32At(l, 'screen_size', 2)).toEqual([1832, 1920]);
  });

  it('shares time and sim fields across eyes', () => {
    const rt = fakeRuntime();
    const l = packSceneUniforms(rt, 2, 0.011, eye(0));
    const r = packSceneUniforms(rt, 2, 0.011, eye(1));
    for (const name of ['time', 'delta_time', 'sim_time', 'time_scale', 'earth_rotation_rad']) {
      expect(f32At(l, name, 1)).toEqual(f32At(r, name, 1));
    }
    expect(f32At(l, 'sun_position', 4)).toEqual(f32At(r, 'sun_position', 4));
  });
});
