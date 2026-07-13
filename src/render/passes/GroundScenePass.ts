import { CONSTANTS } from '@/types/constants.js';
import { MAX_BEAMS } from '../pipelines/types.js';
import type { FrameContext } from './types.js';

export function encodeGroundScenePass(encoder: GPUCommandEncoder, ctx: FrameContext): void {
  const { pipelines, bindGroups, renderTargets, width, height } = ctx;

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
