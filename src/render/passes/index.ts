/**
 * Render Passes - Modular pass encoding
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';
import type { RenderTargets, PipelineBindGroups, Pipelines } from '../pipelines/types.js';

/** Pass encoding context */
export interface PassContext {
  context: WebGPUContext;
  buffers: SatelliteBufferSet;
  renderTargets: RenderTargets;
  bindGroups: PipelineBindGroups;
  pipelines: Pipelines;
  width: number;
  height: number;
}

/**
 * Compute Pass - Orbital position calculation
 */
export function encodeComputePass(
  encoder: GPUCommandEncoder,
  { buffers, bindGroups, pipelines }: PassContext
): void {
  const pass = encoder.beginComputePass({ label: 'Compute Pass' });
  
  pass.setPipeline(pipelines.compute);
  pass.setBindGroup(0, bindGroups.compute);
  pass.dispatchWorkgroups(Math.ceil(1048576 / 64));
  
  pass.end();
}

/**
 * Scene Pass - Render stars, earth, atmosphere, satellites
 */
export function encodeScenePass(
  encoder: GPUCommandEncoder,
  { renderTargets, bindGroups, pipelines }: PassContext
): void {
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTargets.hdrView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }],
    depthStencilAttachment: {
      view: renderTargets.depthView,
      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store'
    },
    label: 'Scene Pass'
  });
  
  // Stars (full screen quad)
  pass.setPipeline(pipelines.stars);
  pass.setBindGroup(0, bindGroups.stars);
  pass.draw(3);
  
  // Earth
  pass.setPipeline(pipelines.earth);
  pass.setBindGroup(0, bindGroups.earth);
  // draw Earth...
  
  // Atmosphere (additive)
  pass.setPipeline(pipelines.atmosphere);
  pass.setBindGroup(0, bindGroups.atmosphere);
  // draw atmosphere...
  
  // Satellites
  pass.setPipeline(pipelines.satellites);
  pass.setBindGroup(0, bindGroups.satellites);
  pass.draw(6, 1048576); // 6 vertices per satellite, 1M instances
  
  pass.end();
}

/**
 * Post-Process Pass - Bloom + Composite
 */
export function encodePostProcessPass(
  encoder: GPUCommandEncoder,
  { renderTargets, bindGroups, pipelines }: PassContext,
  outputView: GPUTextureView
): void {
  // Bloom threshold
  const thresholdPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTargets.bloomAView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }],
    label: 'Bloom Threshold Pass'
  });
  
  thresholdPass.setPipeline(pipelines.bloomThreshold);
  thresholdPass.setBindGroup(0, bindGroups.bloomThreshold);
  thresholdPass.draw(3);
  thresholdPass.end();
  
  // Horizontal blur
  const hBlurPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTargets.bloomBView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }],
    label: 'Bloom H-Blur Pass'
  });
  
  hBlurPass.setPipeline(pipelines.bloomBlur);
  hBlurPass.setBindGroup(0, bindGroups.bloomHorizontal);
  hBlurPass.draw(3);
  hBlurPass.end();
  
  // Vertical blur + composite
  const compositePass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }],
    label: 'Composite Pass'
  });
  
  compositePass.setPipeline(pipelines.composite);
  compositePass.setBindGroup(0, bindGroups.composite);
  compositePass.draw(3);
  compositePass.end();
}
