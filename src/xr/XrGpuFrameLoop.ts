/**
 * WebXR frame loop — the WebGPU frame graph presented through `XRGPUBinding`
 * (Stage 3). Mirrors `onXrFrame` (WebGL) but encodes the same compute + scene
 * passes as the mono WebGPU loop, once per eye, into one command encoder.
 *
 * Per-eye camera data reaches the ~25 bind groups and the cached scene render
 * bundle without touching them: both eyes' `Uni` blocks are written to a small
 * side buffer, and `copyBufferToBuffer` swaps the active block into the shared
 * scene uniform buffer before each eye. Copies are ordered within the encoder,
 * so one submit carries both eyes.
 */

import type { AppRuntime } from '@/app/AppRuntime.js';
import {
  encodeViewDependentScene,
  encodeViewIndependentCompute,
} from '@/app/FrameLoop.js';
import { recordTrailSamplesForCamera } from '@/app/frameLoop/trails.js';
import { resizeRenderTargets } from '@/app/MobilePresentation.js';
import {
  packSceneUniforms,
  updateBeamParamsTime,
  writeSkyFrameUniform,
  writeStationUniform,
} from '@/app/UniformWriter.js';
import type { ViewDescriptor } from '@/camera/ViewDescriptor.js';
import type { CameraState } from '@/camera/cameraTypes.js';
import type { XrGpuPresentation } from '@/core/WebGPUContext.js';
import { tickGrowth } from '@/growth/GrowthController.js';
import { SCENE_UNI_BYTE_SIZE } from '@/shaders/schemas/sceneUni.js';
import type { ViewMode } from '@/types/index.js';
import { stageMatrixFromCameraState } from '@/xr/XrAnchors.js';
import {
  advanceXrClock,
  currentAnchorCamera,
  handleAnchorInput,
  type XrFrameLoopState,
} from '@/xr/XrFrameLoop.js';
import { viewDescriptorForXrEye } from '@/xr/XrPoseBridge.js';

/** XR draws the orbital (horizon-style) scene from every anchor, as WebGL Stage 2 does. */
const XR_SCENE_VIEW_MODE: ViewMode = 'horizon-720';
/** `view_flags` view-mode index written for both eyes (horizon). */
const XR_UNIFORM_VIEW_MODE = 0;
const MAX_EYES = 2;

export interface XrGpuSessionResources {
  presentation: XrGpuPresentation;
  /** Composite pipeline targeting the projection layer's colour format. */
  compositePipeline: GPURenderPipeline;
  /** Both eyes' scene `Uni` blocks, `SCENE_UNI_BYTE_SIZE` apart. */
  eyeUniforms: GPUBuffer;
}

/** Side buffer holding one scene `Uni` block per eye (copy source only). */
export function createXrEyeUniformBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: 'xr-eye-uniforms',
    size: SCENE_UNI_BYTE_SIZE * MAX_EYES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
}

/** True when a sub-image viewport covers only part of its colour texture (side-by-side). */
export function viewportIsPartial(viewport: XRViewport, texture: GPUTexture): boolean {
  return (
    viewport.x !== 0 ||
    viewport.y !== 0 ||
    viewport.width !== texture.width ||
    viewport.height !== texture.height
  );
}

interface XrEye {
  desc: ViewDescriptor;
  subImage: XRGPUSubImage;
}

function collectEyes(
  pose: XRViewerPose,
  stage: Float32Array,
  res: XrGpuSessionResources,
): XrEye[] {
  const { binding, layer } = res.presentation;
  const eyes: XrEye[] = [];
  for (const view of pose.views) {
    if (eyes.length >= MAX_EYES) break;
    const subImage = binding.getViewSubImage(layer, view);
    const vp = subImage.viewport;
    if (vp.width < 1 || vp.height < 1) continue;
    const desc = viewDescriptorForXrEye(stage, {
      viewMatrix: new Float32Array(view.transform.inverse.matrix),
      projectionMatrix: new Float32Array(view.projectionMatrix),
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      eyeIndex: eyes.length === 0 ? 0 : 1,
    });
    eyes.push({ desc, subImage });
  }
  return eyes;
}

function updateTrailsForAnchor(rt: AppRuntime, simTime: number, camera: CameraState): void {
  if (!rt.trailRenderer) return;
  recordTrailSamplesForCamera(rt, simTime, camera);
  const forward = new Float32Array([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  const fLen = Math.hypot(forward[0], forward[1], forward[2]) || 1.0;
  forward[0] /= fLen;
  forward[1] /= fLen;
  forward[2] /= fLen;
  rt.trailRenderer.updateGeometry(simTime, new Float32Array(camera.position), forward);
}

export function onXrGpuFrame(
  rt: AppRuntime,
  state: XrFrameLoopState,
  session: XRSession,
  timeMs: number,
  frame: XRFrame,
  refSpace: XRReferenceSpace,
  res: XrGpuSessionResources,
): void {
  const { context, pipeline, buffers } = rt;
  if (!context || !pipeline || !buffers) return;

  handleAnchorInput(rt, state, session);
  const { timeSec, delta } = advanceXrClock(rt, state, timeMs);
  tickGrowth(rt, delta);
  const simTime = rt.simulation.clock.simTime;

  const pose = frame.getViewerPose(refSpace);
  if (!pose) return;

  const anchorCam = currentAnchorCamera(rt, state, timeMs);
  const eyes = collectEyes(pose, stageMatrixFromCameraState(anchorCam), res);
  if (eyes.length === 0) return;

  // Size the frame graph to the eye viewport once (first frame / scale change);
  // both eyes then reuse the same HDR, depth and bloom targets in sequence.
  const eyeVp = eyes[0].subImage.viewport;
  const targetSize = pipeline.getTargetSize();
  if (targetSize.width !== eyeVp.width || targetSize.height !== eyeVp.height) {
    resizeRenderTargets(rt, eyeVp.width, eyeVp.height);
  }

  rt.profiler.beginFrame(timeMs);
  updateTrailsForAnchor(rt, simTime, anchorCam);
  buffers.tickSgp4Reanchor(simTime);

  writeStationUniform(rt);
  writeSkyFrameUniform(rt);
  eyes.forEach((eye, i) => {
    context.writeBuffer(
      res.eyeUniforms,
      packSceneUniforms(rt, timeSec, delta, eye.desc, { viewModeOverride: XR_UNIFORM_VIEW_MODE }),
      i * SCENE_UNI_BYTE_SIZE,
    );
  });
  updateBeamParamsTime(rt, timeSec);

  const sceneUniforms = buffers.getBuffers().uniforms;
  const encoder = context.createCommandEncoder('xr-frame');

  // Compute reads time / sim flags only, which match across eyes — eye 0's block.
  encoder.copyBufferToBuffer(res.eyeUniforms, 0, sceneUniforms, 0, SCENE_UNI_BYTE_SIZE);
  // Light Brush keeps its paint visible in XR; strokes need a desktop pointer.
  // Sky Strips are not dispatched in XR, so their last frame holds still.
  pipeline.setAnimScratchUsers({ brush: rt.brush.ownsScratch(), strips: rt.strips.usesScratch() });
  const { conjunctionsActive } = encodeViewIndependentCompute(
    rt,
    encoder,
    timeSec,
    XR_SCENE_VIEW_MODE,
  );

  eyes.forEach((eye, i) => {
    if (i > 0) {
      encoder.copyBufferToBuffer(
        res.eyeUniforms,
        i * SCENE_UNI_BYTE_SIZE,
        sceneUniforms,
        0,
        SCENE_UNI_BYTE_SIZE,
      );
    }
    // Re-culls against this eye's frustum before drawing.
    encodeViewDependentScene(rt, encoder, {
      cameraState: anchorCam,
      simTime,
      conjunctionsActive,
      viewMode: XR_SCENE_VIEW_MODE,
    });

    // No DoF / motion blur / TAA in XR: they carry single-view history.
    const hdrView = pipeline.getHDRView();
    if (i === 0) {
      // Adapt once per frame so both eyes share one exposure.
      pipeline.encodeAutoExposurePasses(encoder, hdrView, delta);
    }
    rt.profiler.beginGPUTimestamp('bloom');
    pipeline.encodeBloomPasses(encoder, hdrView);
    rt.profiler.endGPUTimestamp('bloom');

    const { subImage } = eye;
    const vp = subImage.viewport;
    rt.profiler.beginGPUTimestamp('post');
    pipeline.encodeCompositePass(
      encoder,
      subImage.colorTexture.createView(subImage.getViewDescriptor()),
      vp.width,
      vp.height,
      hdrView,
      {
        pipeline: res.compositePipeline,
        viewportX: vp.x,
        viewportY: vp.y,
        preserveOutside: viewportIsPartial(vp, subImage.colorTexture),
      },
    );
    rt.profiler.endGPUTimestamp('post');
  });

  rt.profiler.resolveTimestamps(encoder);
  context.submit([encoder.finish()]);
  void rt.profiler.readbackTimestamps();
  rt.profiler.endFrame(timeMs);

  rt.ui.updateSimClock(rt.simulation.clock);
}
