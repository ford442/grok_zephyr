/**
 * Cached GPURenderBundle for static scene draw sequences.
 * Indirect buffer contents update each frame; bundle records drawIndirect commands only once.
 */

import { CONSTANTS } from '@/types/constants.js';
import { MAX_BEAMS } from './pipelines/types.js';
import type { SatelliteCullBuffers } from './SatelliteCullBuffers.js';
import type { FrameContext } from './passes/types.js';

export type SceneBundleVariant = 'standard' | 'moon' | 'ground';

export interface SceneBundleKey {
  variant: SceneBundleVariant;
  cullingEnabled: boolean;
  width: number;
  height: number;
  groundTerrainEnabled: boolean;
}

export class SceneRenderBundle {
  private bundle: GPURenderBundle | null = null;
  private key: SceneBundleKey | null = null;

  invalidate(): void {
    this.bundle = null;
    this.key = null;
  }

  getBundle(
    device: GPUDevice,
    ctx: FrameContext,
    key: SceneBundleKey,
    earthVertexBuffer: GPUBuffer,
    earthIndexBuffer: GPUBuffer,
    earthIndexCount: number,
    cullBuffers: SatelliteCullBuffers | null,
  ): GPURenderBundle {
    if (
      this.bundle &&
      this.key &&
      this.key.variant === key.variant &&
      this.key.cullingEnabled === key.cullingEnabled &&
      this.key.width === key.width &&
      this.key.height === key.height &&
      this.key.groundTerrainEnabled === key.groundTerrainEnabled
    ) {
      return this.bundle;
    }

    const colorFormats: GPUTextureFormat[] = ['rgba16float'];
    const depthStencilFormat: GPUTextureFormat = 'depth32float';

    const bundleEncoder = device.createRenderBundleEncoder({
      label: `scene-bundle-${key.variant}`,
      colorFormats,
      depthStencilFormat,
    });

    bundleEncoder.setPipeline(ctx.pipelines.stars);
    bundleEncoder.setBindGroup(0, ctx.bindGroups.stars);
    bundleEncoder.draw(3);

    const drawEarth = (): void => {
      bundleEncoder.setPipeline(ctx.pipelines.earth);
      bundleEncoder.setBindGroup(0, ctx.bindGroups.earth);
      bundleEncoder.setVertexBuffer(0, earthVertexBuffer);
      bundleEncoder.setIndexBuffer(earthIndexBuffer, 'uint32');
      bundleEncoder.drawIndexed(earthIndexCount);
    };

    const drawAtmosphere = (): void => {
      bundleEncoder.setPipeline(ctx.pipelines.atmosphere);
      bundleEncoder.setBindGroup(0, ctx.bindGroups.atmosphere);
      bundleEncoder.setVertexBuffer(0, earthVertexBuffer);
      bundleEncoder.setIndexBuffer(earthIndexBuffer, 'uint32');
      bundleEncoder.drawIndexed(earthIndexCount);
    };

    if (key.variant === 'ground') {
      if (key.groundTerrainEnabled) {
        bundleEncoder.setPipeline(ctx.pipelines.groundTerrain);
        bundleEncoder.setBindGroup(0, ctx.bindGroups.groundTerrain);
        bundleEncoder.draw(6);
      }
    } else if (key.variant !== 'moon') {
      drawEarth();
      drawAtmosphere();
    }

    if (key.cullingEnabled && cullBuffers) {
      bundleEncoder.setPipeline(ctx.pipelines.satellitesCulled);
      bundleEncoder.setBindGroup(0, ctx.bindGroups.satellitesCulled);
      bundleEncoder.drawIndirect(cullBuffers.satDrawIndirect, 0);

      bundleEncoder.setPipeline(ctx.pipelines.beamCulled);
      bundleEncoder.setBindGroup(0, ctx.bindGroups.beamCulled);
      bundleEncoder.drawIndirect(cullBuffers.beamDrawIndirect, 0);
    } else {
      bundleEncoder.setPipeline(ctx.pipelines.satellites);
      bundleEncoder.setBindGroup(0, ctx.bindGroups.satellites);
      bundleEncoder.draw(6, CONSTANTS.NUM_SATELLITES);

      bundleEncoder.setPipeline(ctx.pipelines.beam);
      bundleEncoder.setBindGroup(0, ctx.bindGroups.beam);
      bundleEncoder.draw(4, MAX_BEAMS);
    }

    if (key.variant === 'moon') {
      drawEarth();
      drawAtmosphere();
    }

    this.bundle = bundleEncoder.finish();
    this.key = { ...key };
    return this.bundle;
  }
}
