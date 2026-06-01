import { describe, it, expect } from 'vitest';
import {
  v3,
  v4,
  v3len,
  v3norm,
  v3cross,
  v3dot,
  v3sub,
  v3add,
  v3scale,
  v3lerp,
  v3dist,
  mat4identity,
  mat4lookAt,
  mat4persp,
  mat4mul,
  mat4inv,
  extractFrustum,
  sphericalToCartesian,
  cartesianToSpherical,
  genSphere,
  clamp,
  smoothstep,
} from './math.js';

const EPS = 1e-5;

function expectClose(actual: number, expected: number, eps = EPS): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
}

function expectVecClose(actual: ArrayLike<number>, expected: ArrayLike<number>, eps = EPS): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expectClose(actual[i], expected[i], eps);
  }
}

function mulMat4Vec4(m: Float32Array, v: [number, number, number, number]): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

describe('math utilities', () => {
  it('creates vectors with v3 and v4', () => {
    expect(v3(1, 2, 3)).toEqual([1, 2, 3]);
    expect(v4(1, 2, 3, 4)).toEqual([1, 2, 3, 4]);
  });

  it('computes vector length and normalization', () => {
    expectClose(v3len([3, 4, 0]), 5);
    expectVecClose(v3norm([3, 4, 0]), [0.6, 0.8, 0]);
  });

  it('normalizes zero vector safely', () => {
    expectVecClose(v3norm([0, 0, 0]), [0, 0, 0]);
  });

  it('computes cross and dot products correctly', () => {
    expect(v3cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(v3dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('computes vector arithmetic helpers', () => {
    expect(v3sub([5, 6, 7], [1, 2, 3])).toEqual([4, 4, 4]);
    expect(v3add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(v3scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
    expect(v3lerp([0, 0, 0], [10, 20, 30], 0.25)).toEqual([2.5, 5, 7.5]);
    expectClose(v3dist([1, 2, 3], [4, 6, 3]), 5);
  });

  it('returns identity matrix', () => {
    expect(Array.from(mat4identity())).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  });

  it('multiplies matrices in column-major order (a * b)', () => {
    const scale = new Float32Array([
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      0, 0, 0, 1,
    ]);
    const translate = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      10, 20, 30, 1,
    ]);
    const point: [number, number, number, number] = [1, 1, 1, 1];

    const ts = mat4mul(translate, scale); // scale first, then translate
    const out = mulMat4Vec4(ts, point);
    expectVecClose(out, [12, 23, 34, 1]);
  });

  it('inverts diagonal scale matrix and round-trips to identity', () => {
    const scale = new Float32Array([
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      0, 0, 0, 1,
    ]);
    const inv = mat4inv(scale);
    const ident = mat4mul(scale, inv);
    expectVecClose(ident, mat4identity(), 1e-4);
  });

  it('returns original matrix when inversion is singular', () => {
    const singular = new Float32Array(16);
    const inv = mat4inv(singular);
    expect(inv).toBe(singular);
  });

  it('builds stable lookAt matrix for forward -Z camera', () => {
    const view = mat4lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    expectClose(view[0], 1);
    expectClose(view[5], 1);
    expectClose(view[10], 1);
    expectClose(view[14], -5);
  });

  it('builds WebGPU-style perspective matrix', () => {
    const fovy = Math.PI / 2;
    const aspect = 2;
    const near = 1;
    const far = 101;
    const p = mat4persp(fovy, aspect, near, far);
    expectClose(p[0], 0.5);
    expectClose(p[5], 1.0);
    expectClose(p[10], far / (near - far));
    expectClose(p[11], -1);
    expectClose(p[14], (near * far) / (near - far));
  });

  it('extracts six normalized frustum planes', () => {
    const view = mat4lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const proj = mat4persp(Math.PI / 3, 1, 0.1, 200);
    const vp = mat4mul(proj, view);
    const planes = extractFrustum(vp);
    expect(planes).toHaveLength(6);
    for (const p of planes) {
      const len = Math.hypot(p[0], p[1], p[2]);
      expectClose(len, 1, 1e-4);
    }
  });

  it('converts spherical/cartesian coordinates round-trip', () => {
    const cart = sphericalToCartesian(10, Math.PI / 2, Math.PI / 4);
    const sph = cartesianToSpherical(cart[0], cart[1], cart[2]);
    expectClose(sph.radius, 10, 1e-4);
    expectClose(sph.theta, Math.PI / 2, 1e-4);
    expectClose(sph.phi, Math.PI / 4, 1e-4);
  });

  it('generates sphere geometry with expected counts', () => {
    const rings = 4;
    const segments = 8;
    const sphere = genSphere(2, rings, segments);
    const vertexCount = (rings + 1) * (segments + 1);
    expect(sphere.vertices.length).toBe(vertexCount * 3);
    expect(sphere.normals.length).toBe(vertexCount * 3);
    expect(sphere.indices.length).toBe(rings * segments * 6);
  });

  it('clamps values and performs smoothstep interpolation', () => {
    expect(clamp(12, 0, 5)).toBe(5);
    expect(clamp(-2, 0, 5)).toBe(0);
    expectClose(smoothstep(0, 10, 0), 0);
    expectClose(smoothstep(0, 10, 10), 1);
    expectClose(smoothstep(0, 10, 5), 0.5);
  });
});
