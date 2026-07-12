/**
 * Scene pass encoders — stars, earth, atmosphere, satellites, ground, skyline
 */

import { CONSTANTS } from '@/types/constants.js';
import { MAX_BEAMS } from '../pipelines/types.js';
import type { PassContext } from './types.js';

export function encodeScenePass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  earthVertexBuffer: GPUBuffer,
  earthIndexBuffer: GPUBuffer,
  earthIndexCount: number,
  moonView = false,
): void {
  const { pipelines, bindGroups, renderTargets, width, height } = ctx;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTargets.hdrView,
      clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: renderTargets.depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  pass.setViewport(0, 0, width, height, 0, 1);

  pass.setPipeline(pipelines.stars);
  pass.setBindGroup(0, bindGroups.stars);
  pass.draw(3);

  const drawEarth = (): void => {
    pass.setPipeline(pipelines.earth);
    pass.setBindGroup(0, bindGroups.earth);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);
  };

  const drawAtmosphere = (): void => {
    pass.setPipeline(pipelines.atmosphere);
    pass.setBindGroup(0, bindGroups.atmosphere);
    pass.setVertexBuffer(0, earthVertexBuffer);
    pass.setIndexBuffer(earthIndexBuffer, 'uint32');
    pass.drawIndexed(earthIndexCount);
  };

  if (!moonView) {
    drawEarth();
    drawAtmosphere();
  }

  pass.setPipeline(pipelines.satellites);
  pass.setBindGroup(0, bindGroups.satellites);
  pass.draw(6, CONSTANTS.NUM_SATELLITES);

  pass.setPipeline(pipelines.beam);
  pass.setBindGroup(0, bindGroups.beam);
  pass.draw(4, MAX_BEAMS);

  if (moonView) {
    drawEarth();
    drawAtmosphere();
  }

  pass.end();
}

export function encodeTrailPass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  trailRenderer: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null,
): void {
  if (!trailRenderer) return;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx.renderTargets.hdrView,
      loadOp: 'load',
      storeOp: 'store',
    }],
  });

  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  trailRenderer.encodeRenderPass(pass, ctx.buffers.uniforms);
  pass.end();
}

export function encodeConstellationGuidesPass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  guides: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null,
): void {
  if (!guides) return;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx.renderTargets.hdrView,
      loadOp: 'load',
      storeOp: 'store',
    }],
  });

  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  guides.encodeRenderPass(pass, ctx.buffers.uniforms);
  pass.end();
}

export function encodeMoonOverlayPass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  ringGuide: { encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void } | null,
): void {
  const { pipelines, bindGroups, renderTargets, width, height } = ctx;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTargets.hdrView,
      loadOp: 'load',
      storeOp: 'store',
    }],
  });

  pass.setViewport(0, 0, width, height, 0, 1);

  pass.setPipeline(pipelines.moonEarthDisk);
  pass.setBindGroup(0, bindGroups.moonEarthDisk);
  pass.draw(6);

  if (ringGuide) {
    ringGuide.encodeRenderPass(pass, ctx.buffers.uniforms);
  }

  pass.setPipeline(pipelines.moonForeground);
  pass.setBindGroup(0, bindGroups.moonForeground);
  pass.draw(6);

  pass.end();
}

export function encodeGroundScenePass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
): void {
  const { pipelines, bindGroups, renderTargets, width, height } = ctx;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTargets.hdrView,
      clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: renderTargets.depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  pass.setViewport(0, 0, width, height, 0, 1);

  pass.setPipeline(pipelines.stars);
  pass.setBindGroup(0, bindGroups.stars);
  pass.draw(3);

  if (ctx.groundTerrainEnabled) {
    pass.setPipeline(pipelines.groundTerrain);
    pass.setBindGroup(0, bindGroups.groundTerrain);
    pass.draw(6);
  }

  pass.setPipeline(pipelines.satellites);
  pass.setBindGroup(0, bindGroups.satellites);
  pass.draw(6, CONSTANTS.NUM_SATELLITES);

  pass.setPipeline(pipelines.beam);
  pass.setBindGroup(0, bindGroups.beam);
  pass.draw(4, MAX_BEAMS);

  pass.end();
}

export function encodeSkylinePass(
  encoder: GPUCommandEncoder,
  ctx: PassContext,
  buildingCount: number,
): void {
  if (!ctx.skylineBindGroup) return;

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx.renderTargets.hdrView,
      loadOp: 'load',
      storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: ctx.renderTargets.depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1);
  pass.setPipeline(ctx.pipelines.skyline);
  pass.setBindGroup(0, ctx.skylineBindGroup);
  pass.draw(36, buildingCount);
  pass.end();
}
