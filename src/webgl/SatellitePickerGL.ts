/**
 * WebGL2 satellite picking via RGB-encoded IDs in a 16×16 FBO.
 */

import type { WebGLFrame, WebGLRenderer } from '@/webgl/WebGLRenderer.js';

const PICK_SIZE = 16;

export function pickSatelliteWebGL(
  renderer: WebGLRenderer,
  frame: WebGLFrame,
  clientX: number,
  clientY: number,
): number {
  return renderer.pickSatelliteAt(frame, clientX, clientY, PICK_SIZE);
}

export function decodePickColor(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}
