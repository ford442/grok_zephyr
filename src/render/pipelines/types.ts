/**
 * Pipeline Types and Interfaces
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { SatelliteBufferSet } from '@/core/SatelliteGPUBuffer.js';

/** Render targets for HDR pipeline */
export interface RenderTargets {
  hdr: GPUTexture;
  depth: GPUTexture;
  bloomA: GPUTexture;
  bloomB: GPUTexture;
  hdrView: GPUTextureView;
  depthView: GPUTextureView;
  bloomAView: GPUTextureView;
  bloomBView: GPUTextureView;
}

/** Pipeline bind groups */
export interface PipelineBindGroups {
  compute: GPUBindGroup;
  beamCompute: GPUBindGroup;
  stars: GPUBindGroup;
  earth: GPUBindGroup;
  atmosphere: GPUBindGroup;
  satellites: GPUBindGroup;
  beam: GPUBindGroup;
  groundTerrain: GPUBindGroup;
  bloomThreshold: GPUBindGroup;
  bloomHorizontal: GPUBindGroup;
  bloomVertical: GPUBindGroup;
  composite: GPUBindGroup;
}

/** All render pipelines */
export interface Pipelines {
  compute: GPUComputePipeline;
  beamCompute: GPUComputePipeline;
  stars: GPURenderPipeline;
  earth: GPURenderPipeline;
  atmosphere: GPURenderPipeline;
  satellites: GPURenderPipeline;
  beam: GPURenderPipeline;
  groundTerrain: GPURenderPipeline;
  bloomThreshold: GPURenderPipeline;
  bloomBlur: GPURenderPipeline;
  composite: GPURenderPipeline;
}

/** Pipeline creation context */
export interface PipelineContext {
  context: WebGPUContext;
  buffers: SatelliteBufferSet;
  linearSampler: GPUSampler;
}

/** Base pipeline interface */
export interface Pipeline {
  create(context: PipelineContext): GPUComputePipeline | GPURenderPipeline;
  createBindGroup?(context: PipelineContext, pipeline: GPUPipelineBase, ...args: unknown[]): GPUBindGroup;
}
