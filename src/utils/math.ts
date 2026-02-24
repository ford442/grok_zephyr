/**
 * Grok Zephyr - Math Utilities
 * 
 * Custom 3D math functions using column-major matrix convention
 * consistent with WebGPU.
 */

import type { Vec3, Vec4, Mat4 } from '@/types/index.js';

/**
 * Create a 3D vector
 */
export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

/**
 * Create a 4D vector
 */
export function v4(x: number, y: number, z: number, w: number): Vec4 {
  return [x, y, z, w];
}

/**
 * Vector length
 */
export function v3len(a: Vec3): number {
  return Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
}

/**
 * Normalize vector
 */
export function v3norm(a: Vec3): Vec3 {
  const len = v3len(a) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

/**
 * Cross product
 */
export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Dot product
 */
export function v3dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Vector subtraction
 */
export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Vector addition
 */
export function v3add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * Vector scaling
 */
export function v3scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * Linear interpolation between vectors
 */
export function v3lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Distance between two vectors
 */
export function v3dist(a: Vec3, b: Vec3): number {
  return v3len(v3sub(a, b));
}

/**
 * Create identity matrix
 */
export function mat4identity(): Mat4 {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * Create look-at matrix (column-major)
 * 
 * Creates a view matrix looking from 'eye' toward 'target'
 * with 'up' defining the camera's up direction.
 */
export function mat4lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = v3norm(v3sub(target, eye));
  const r = v3norm(v3cross(f, up));
  const u = v3cross(r, f);

  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -v3dot(r, eye), -v3dot(u, eye), v3dot(f, eye), 1,
  ]);
}

/**
 * Create perspective projection matrix (WebGPU style)
 * 
 * WebGPU uses z in [0, 1] range (different from OpenGL's [-1, 1])
 */
export function mat4persp(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const range = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * range, -1,
    0, 0, near * far * range, 0,
  ]);
}

/**
 * Matrix multiplication (column-major)
 * 
 * Returns a * b (apply b first, then a)
 */
export function mat4mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[r + k * 4] * b[k + c * 4];
      }
      out[r + c * 4] = sum;
    }
  }
  
  return out;
}

/**
 * 4x4 matrix inversion (column-major)
 * 
 * Standard cofactor expansion method.
 */
export function mat4inv(m: Mat4): Mat4 {
  const out = new Float32Array(16);
  
  const [
    m00, m10, m20, m30,
    m01, m11, m21, m31,
    m02, m12, m22, m32,
    m03, m13, m23, m33,
  ] = m;

  const det =
    m00 * (m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31))
    - m01 * (m10 * (m22 * m33 - m23 * m32) - m12 * (m20 * m33 - m23 * m30) + m13 * (m20 * m32 - m22 * m30))
    + m02 * (m10 * (m21 * m33 - m23 * m31) - m11 * (m20 * m33 - m23 * m30) + m13 * (m20 * m31 - m21 * m30))
    - m03 * (m10 * (m21 * m32 - m22 * m31) - m11 * (m20 * m32 - m22 * m30) + m12 * (m20 * m31 - m21 * m30));

  if (!det) return m;
  
  const di = 1 / det;

  out[0] = (m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31)) * di;
  out[1] = (-m01 * (m22 * m33 - m23 * m32) + m02 * (m21 * m33 - m23 * m31) - m03 * (m21 * m32 - m22 * m31)) * di;
  out[2] = (m01 * (m12 * m33 - m13 * m32) - m02 * (m11 * m33 - m13 * m31) + m03 * (m11 * m32 - m12 * m31)) * di;
  out[3] = (-m01 * (m12 * m23 - m13 * m22) + m02 * (m11 * m23 - m13 * m21) - m03 * (m11 * m22 - m12 * m21)) * di;
  out[4] = (-m10 * (m22 * m33 - m23 * m32) + m12 * (m20 * m33 - m23 * m30) - m13 * (m20 * m32 - m22 * m30)) * di;
  out[5] = (m00 * (m22 * m33 - m23 * m32) - m02 * (m20 * m33 - m23 * m30) + m03 * (m20 * m32 - m22 * m30)) * di;
  out[6] = (-m00 * (m12 * m33 - m13 * m32) + m02 * (m10 * m33 - m13 * m30) - m03 * (m10 * m32 - m12 * m30)) * di;
  out[7] = (m00 * (m12 * m23 - m13 * m22) - m02 * (m10 * m23 - m13 * m20) + m03 * (m10 * m22 - m12 * m20)) * di;
  out[8] = (m10 * (m21 * m33 - m23 * m31) - m11 * (m20 * m33 - m23 * m30) + m13 * (m20 * m31 - m21 * m30)) * di;
  out[9] = (-m00 * (m21 * m33 - m23 * m31) + m01 * (m20 * m33 - m23 * m30) - m03 * (m20 * m31 - m21 * m30)) * di;
  out[10] = (m00 * (m11 * m33 - m13 * m31) - m01 * (m10 * m33 - m13 * m30) + m03 * (m10 * m31 - m11 * m30)) * di;
  out[11] = (-m00 * (m11 * m23 - m13 * m21) + m01 * (m10 * m23 - m13 * m20) - m03 * (m10 * m21 - m11 * m20)) * di;
  out[12] = (-m10 * (m21 * m32 - m22 * m31) + m11 * (m20 * m32 - m22 * m30) - m12 * (m20 * m31 - m21 * m30)) * di;
  out[13] = (m00 * (m21 * m32 - m22 * m31) - m01 * (m20 * m32 - m22 * m30) + m02 * (m20 * m31 - m21 * m30)) * di;
  out[14] = (-m00 * (m11 * m32 - m12 * m31) + m01 * (m10 * m32 - m12 * m30) - m02 * (m10 * m31 - m11 * m30)) * di;
  out[15] = (m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20)) * di;

  return out;
}

/**
 * Extract frustum planes from view-projection matrix
 * 
 * Returns 6 planes in format [nx, ny, nz, d] where
 * the plane equation is nx*x + ny*y + nz*z + d = 0
 */
export function extractFrustum(vp: Mat4): Float32Array[] {
  // Extract rows from column-major matrix
  const row = (i: number): number[] => [vp[i], vp[i + 4], vp[i + 8], vp[i + 12]];
  const r0 = row(0);
  const r1 = row(1);
  const r2 = row(2);
  const r3 = row(3);

  const planes = [
    [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]], // Left
    [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]], // Right
    [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]], // Bottom
    [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]], // Top
    [r2[0], r2[1], r2[2], r2[3]],                                  // Near (WebGPU z=0)
    [r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]], // Far
  ];

  // Normalize planes
  return planes.map((p) => {
    const len = Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2) || 1;
    return new Float32Array([p[0] / len, p[1] / len, p[2] / len, p[3] / len]);
  });
}

/**
 * Spherical to Cartesian coordinates
 */
export function sphericalToCartesian(
  radius: number,
  theta: number,
  phi: number
): Vec3 {
  return [
    radius * Math.sin(theta) * Math.cos(phi),
    radius * Math.sin(theta) * Math.sin(phi),
    radius * Math.cos(theta),
  ];
}

/**
 * Cartesian to spherical coordinates
 */
export function cartesianToSpherical(x: number, y: number, z: number): {
  radius: number;
  theta: number;
  phi: number;
} {
  const radius = Math.sqrt(x * x + y * y + z * z);
  return {
    radius,
    theta: Math.acos(z / radius),
    phi: Math.atan2(y, x),
  };
}

/**
 * Generate UV sphere geometry
 */
export function genSphere(
  radius: number,
  rings: number,
  segments: number
): {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
} {
  const verts: number[] = [];
  const norms: number[] = [];
  const idxs: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const theta = (r * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let s = 0; s <= segments; s++) {
      const phi = (s * 2 * Math.PI) / segments;
      const x = radius * sinTheta * Math.cos(phi);
      const y = radius * sinTheta * Math.sin(phi);
      const z = radius * cosTheta;

      verts.push(x, y, z);
      norms.push(x / radius, y / radius, z / radius);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      idxs.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    vertices: new Float32Array(verts),
    normals: new Float32Array(norms),
    indices: new Uint32Array(idxs),
  };
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Smoothstep interpolation
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Hash function for deterministic randomness
 */
export function hash(n: number): number {
  return Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;
}

/**
 * 2D hash function
 */
export function hash2(x: number, y: number): number {
  return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
}

export default {
  v3, v4, v3len, v3norm, v3cross, v3dot, v3sub, v3add, v3scale,
  v3lerp, v3dist, mat4identity, mat4lookAt, mat4persp, mat4mul, mat4inv,
  extractFrustum, sphericalToCartesian, cartesianToSpherical, genSphere,
  clamp, smoothstep, hash, hash2,
};
