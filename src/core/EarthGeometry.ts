import { CONSTANTS } from '@/types/constants.js';
import { genSphere } from '@/utils/math.js';
import type { WebGPUContext } from '@/core/WebGPUContext.js';
import type { EarthMesh } from '@/webgl/WebGLRenderer.js';

export interface EarthGeometryBuffers {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

export function buildEarthMesh(): EarthMesh {
  const sphere = genSphere(CONSTANTS.EARTH_RADIUS_KM, 64, 64);
  const vertexCount = sphere.vertices.length / 3;
  const interleaved = new Float32Array(vertexCount * 6);
  for (let i = 0; i < vertexCount; i++) {
    interleaved[i * 6 + 0] = sphere.vertices[i * 3 + 0];
    interleaved[i * 6 + 1] = sphere.vertices[i * 3 + 1];
    interleaved[i * 6 + 2] = sphere.vertices[i * 3 + 2];
    interleaved[i * 6 + 3] = sphere.normals[i * 3 + 0];
    interleaved[i * 6 + 4] = sphere.normals[i * 3 + 1];
    interleaved[i * 6 + 5] = sphere.normals[i * 3 + 2];
  }
  return { interleaved, indices: sphere.indices };
}

export function createEarthGeometry(context: WebGPUContext): EarthGeometryBuffers {
  const sphere = genSphere(CONSTANTS.EARTH_RADIUS_KM, 64, 64);

  const indexCount = sphere.indices.length;
  const vertexCount = sphere.vertices.length / 3;
  const interleaved = new Float32Array(vertexCount * 6);

  for (let i = 0; i < vertexCount; i++) {
    interleaved[i * 6 + 0] = sphere.vertices[i * 3 + 0];
    interleaved[i * 6 + 1] = sphere.vertices[i * 3 + 1];
    interleaved[i * 6 + 2] = sphere.vertices[i * 3 + 2];
    interleaved[i * 6 + 3] = sphere.normals[i * 3 + 0];
    interleaved[i * 6 + 4] = sphere.normals[i * 3 + 1];
    interleaved[i * 6 + 5] = sphere.normals[i * 3 + 2];
  }

  const vertexBuffer = context.createVertexBuffer(interleaved.byteLength);
  context.writeBuffer(vertexBuffer, interleaved);

  const indexBuffer = context.createIndexBuffer(sphere.indices.byteLength);
  context.writeBuffer(indexBuffer, sphere.indices);

  return { vertexBuffer, indexBuffer, indexCount };
}
