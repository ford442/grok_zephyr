/**
 * Main scene pass — stars, earth, atmosphere, satellites, beams
 */

import type { SatelliteCullBuffers } from '../SatelliteCullBuffers.js';
import { SceneRenderBundle, type SceneBundleVariant } from '../SceneRenderBundle.js';
import type { FrameContext } from './types.js';

const sceneBundle = new SceneRenderBundle();

export function invalidateSceneRenderBundle(): void {
  sceneBundle.invalidate();
}

export function encodeScenePass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  earthVertexBuffer: GPUBuffer,
  earthIndexBuffer: GPUBuffer,
  earthIndexCount: number,
  moonView = false,
  cullingEnabled = false,
  cullBuffers: SatelliteCullBuffers | null = null,
): void {
  const { renderTargets, width, height } = ctx;
  const variant: SceneBundleVariant = moonView ? 'moon' : 'standard';

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: renderTargets.hdrView,
        clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: renderTargets.depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });

  pass.setViewport(0, 0, width, height, 0, 1);

  const bundle = sceneBundle.getBundle(
    ctx.context.getDevice(),
    ctx,
    {
      variant,
      cullingEnabled,
      width,
      height,
      groundTerrainEnabled: false,
    },
    earthVertexBuffer,
    earthIndexBuffer,
    earthIndexCount,
    cullBuffers,
  );

  pass.executeBundles([bundle]);
  pass.end();
}
