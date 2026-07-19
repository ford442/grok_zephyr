import { SceneRenderBundle } from '../SceneRenderBundle.js';
import type { SatelliteCullBuffers } from '../SatelliteCullBuffers.js';
import type { FrameContext } from './types.js';

const groundSceneBundle = new SceneRenderBundle();

export function invalidateGroundSceneRenderBundle(): void {
  groundSceneBundle.invalidate();
}

export function encodeGroundScenePass(
  encoder: GPUCommandEncoder,
  ctx: FrameContext,
  cullingEnabled = false,
  cullBuffers: SatelliteCullBuffers | null = null,
): void {
  const { renderTargets, width, height } = ctx;

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

  const bundle = groundSceneBundle.getBundle(
    ctx.context.getDevice(),
    ctx,
    {
      variant: 'ground',
      cullingEnabled,
      width,
      height,
      groundTerrainEnabled: ctx.groundTerrainEnabled,
    },
    // Ground bundle does not use earth mesh; placeholders satisfy signature.
    ctx.buffers.uniforms,
    ctx.buffers.uniforms,
    0,
    cullBuffers,
  );

  pass.executeBundles([bundle]);
  pass.end();
}
