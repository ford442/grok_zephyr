/**
 * Grok Zephyr - WebGL2 fallback renderer.
 *
 * A self-contained, readback-friendly renderer that mirrors the WebGPU scene
 * (starfield → Earth+atmosphere → satellites → bloom → tonemap) so that agents,
 * Playwright, and CI can inspect orbital geometry and rendering that the WebGPU
 * path produces in an unreadable swapchain.
 *
 * It shares simulation state with the WebGPU path via OrbitalElements (same
 * orbital data + Keplerian math) and the CameraController (same view/projection),
 * and propagates all 1,048,576 satellites in the GPU vertex shader — the
 * "simplified compute fallback" for the WGSL compute pass.
 */

import type { OrbitalElements } from '@/core/OrbitalElements.js';
import type { ImageTuningSettings } from '@/core/ImageTuning.js';
import {
  buildGroupParamsUniform,
  createDefaultVisibility,
  type GroupVisibilityState,
} from '@/data/ConstellationGroups.js';
import { packSatelliteVisualUniform, SHIPPING_IMAGE_TUNING } from '@/core/ImageTuning.js';
import { mat4inv } from '@/utils/math.js';
import {
  acquireGL,
  createProgram,
  createRenderTarget,
  destroyRenderTarget,
  createFullscreenTriangle,
  UniformCache,
  type RenderTarget,
} from './glUtils.js';
import {
  SAT_VERT,
  SAT_FRAG,
  SAT_PICK_VERT,
  SAT_PICK_FRAG,
  EARTH_VERT,
  EARTH_FRAG,
  STAR_VERT,
  STAR_FRAG,
  FS_VERT,
  THRESHOLD_FRAG,
  BLUR_FRAG,
  COMPOSITE_FRAG,
  MOON_FOREGROUND_FRAG,
  MOON_EARTH_DISK_FRAG,
} from './shaders.js';

/** Per-frame state handed to the renderer (shared with the WebGPU loop). */
export interface WebGLFrame {
  viewProj: Float32Array; // column-major mat4 from CameraController.buildViewProjection
  cameraPos: [number, number, number] | Float32Array;
  sunDir: [number, number, number];
  simTime: number;
  time: number;
  backgroundMode: number;
  viewMode: number;
  timeScale?: number;
  hostVelocity?: readonly [number, number, number];
}

/** Earth mesh data (shares genSphere geometry with the WebGPU path). */
export interface EarthMesh {
  interleaved: Float32Array; // [px,py,pz, nx,ny,nz] per vertex
  indices: Uint32Array;
}

/** Runtime-toggleable debug options (also driven from ?debug=… and window.zephyrGL). */
export interface WebGLDebugOptions {
  wireframeEarth: boolean;
  lodDebug: boolean;
  pointScale: number;
  showEarth: boolean;
  showSatellites: boolean;
  showStars: boolean;
  showBloom: boolean;
}

export const DEFAULT_DEBUG: WebGLDebugOptions = {
  wireframeEarth: false,
  lodDebug: false,
  pointScale: 1.0,
  showEarth: true,
  showSatellites: true,
  showStars: true,
  showBloom: true,
};

export class WebGLRenderer {
  private gl!: WebGL2RenderingContext;
  private floatRenderable = false;
  private width = 1;
  private height = 1;

  // Programs + uniform caches
  private satProgram!: WebGLProgram;
  private satU!: UniformCache;
  private satPickProgram!: WebGLProgram;
  private satPickU!: UniformCache;
  private pickFbo: WebGLFramebuffer | null = null;
  private pickTexture: WebGLTexture | null = null;
  private pickDepth: WebGLRenderbuffer | null = null;
  private earthProgram!: WebGLProgram;
  private earthU!: UniformCache;
  private starProgram!: WebGLProgram;
  private starU!: UniformCache;
  private thresholdProgram!: WebGLProgram;
  private thresholdU!: UniformCache;
  private blurProgram!: WebGLProgram;
  private blurU!: UniformCache;
  private compositeProgram!: WebGLProgram;
  private compositeU!: UniformCache;
  private moonForegroundProgram!: WebGLProgram;
  private moonForegroundU!: UniformCache;
  private moonEarthDiskProgram!: WebGLProgram;
  private moonEarthDiskU!: UniformCache;

  // Geometry
  private satVao!: WebGLVertexArrayObject;
  private satVbo!: WebGLBuffer;
  private satGroupVbo!: WebGLBuffer;
  private satCount = 0;
  private groupVisibility: GroupVisibilityState = createDefaultVisibility();
  private groupUniformData = new Float32Array(64);
  private earthVao!: WebGLVertexArrayObject;
  private earthIndexCount = 0;
  private fsTriangle!: WebGLVertexArrayObject;

  // Render targets
  private hdr!: RenderTarget;
  private bloomA!: RenderTarget;
  private bloomB!: RenderTarget;

  private imageTuning: ImageTuningSettings = { ...SHIPPING_IMAGE_TUNING };
  private satVisualPacked = packSatelliteVisualUniform(SHIPPING_IMAGE_TUNING);

  private debug: WebGLDebugOptions = { ...DEFAULT_DEBUG };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly orbital: OrbitalElements,
    private readonly satelliteCount: number,
    private groupIds: Uint32Array | null = null,
  ) {}

  /** True if the underlying context supports HDR float render targets. */
  get hdrEnabled(): boolean {
    return this.floatRenderable;
  }

  initialize(width: number, height: number, earth: EarthMesh): void {
    const { gl, floatRenderable } = acquireGL(this.canvas);
    this.gl = gl;
    this.floatRenderable = floatRenderable;
    if (!floatRenderable) {
      console.warn('[WebGL] EXT_color_buffer_float unavailable — bloom runs in LDR (RGBA8).');
    }

    // Compile all programs.
    this.satProgram = createProgram(gl, SAT_VERT, SAT_FRAG, 'satellites');
    this.satU = new UniformCache(gl, this.satProgram);
    this.satPickProgram = createProgram(gl, SAT_PICK_VERT, SAT_PICK_FRAG, 'satellites-pick');
    this.satPickU = new UniformCache(gl, this.satPickProgram);
    this.earthProgram = createProgram(gl, EARTH_VERT, EARTH_FRAG, 'earth');
    this.earthU = new UniformCache(gl, this.earthProgram);
    this.starProgram = createProgram(gl, STAR_VERT, STAR_FRAG, 'starfield');
    this.starU = new UniformCache(gl, this.starProgram);
    this.thresholdProgram = createProgram(gl, FS_VERT, THRESHOLD_FRAG, 'bloom-threshold');
    this.thresholdU = new UniformCache(gl, this.thresholdProgram);
    this.blurProgram = createProgram(gl, FS_VERT, BLUR_FRAG, 'bloom-blur');
    this.blurU = new UniformCache(gl, this.blurProgram);
    this.compositeProgram = createProgram(gl, FS_VERT, COMPOSITE_FRAG, 'composite');
    this.compositeU = new UniformCache(gl, this.compositeProgram);
    this.moonForegroundProgram = createProgram(
      gl,
      FS_VERT,
      MOON_FOREGROUND_FRAG,
      'moon-foreground',
    );
    this.moonForegroundU = new UniformCache(gl, this.moonForegroundProgram);
    this.moonEarthDiskProgram = createProgram(gl, FS_VERT, MOON_EARTH_DISK_FRAG, 'moon-earth-disk');
    this.moonEarthDiskU = new UniformCache(gl, this.moonEarthDiskProgram);

    this.buildSatelliteGeometry();
    this.buildEarthGeometry(earth);
    this.fsTriangle = createFullscreenTriangle(gl);

    this.resize(width, height);
    console.log(
      `[WebGL] Renderer initialized (${this.satCount.toLocaleString()} satellites, HDR=${floatRenderable}).`,
    );
  }

  /** Upload orbital elements as per-vertex POINTS attributes (no per-frame CPU work). */
  private buildSatelliteGeometry(): void {
    const gl = this.gl;
    this.satCount = Math.min(this.satelliteCount, this.orbital.numSatellites);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const groupVbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.orbital.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);

    const groupData =
      this.groupIds ?? new Uint32Array(this.orbital.numSatellites);
    const groupFloat = new Float32Array(groupData.length);
    for (let i = 0; i < groupData.length; i++) {
      groupFloat[i] = groupData[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, groupVbo);
    gl.bufferData(gl.ARRAY_BUFFER, groupFloat, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);

    gl.bindVertexArray(null);
    this.satVao = vao;
    this.satVbo = vbo;
    this.satGroupVbo = groupVbo;
  }

  setGroupIds(groupIds: Uint32Array): void {
    this.groupIds = groupIds;
  }

  setGroupVisibilityState(state: GroupVisibilityState): void {
    this.groupVisibility = state;
    const buffer = buildGroupParamsUniform(state);
    this.groupUniformData.set(new Float32Array(buffer));
  }

  setGroupVisibility(groupId: number, visible: boolean): void {
    if (groupId < 0 || groupId >= this.groupVisibility.visible.length) return;
    this.groupVisibility.visible[groupId] = visible;
    const buffer = buildGroupParamsUniform(this.groupVisibility);
    this.groupUniformData.set(new Float32Array(buffer));
  }

  private uploadGroupUniforms(): void {
    const gl = this.gl;
    for (let i = 0; i < 8; i++) {
      const base = i * 8;
      const locA = this.satU.loc(`uGroupA[${i}]`);
      const locB = this.satU.loc(`uGroupB[${i}]`);
      if (locA) {
        gl.uniform4f(
          locA,
          this.groupUniformData[base + 0],
          this.groupUniformData[base + 1],
          this.groupUniformData[base + 2],
          this.groupUniformData[base + 3],
        );
      }
      if (locB) {
        gl.uniform4f(
          locB,
          this.groupUniformData[base + 4],
          this.groupUniformData[base + 5],
          this.groupUniformData[base + 6],
          this.groupUniformData[base + 7],
        );
      }
    }
    const multiLoc = this.satU.loc('uMultiGroupColor');
    if (multiLoc) {
      gl.uniform1f(multiLoc, this.groupVisibility.multiGroupColorMode ? 1 : 0);
    }
  }

  /** Re-upload orbital element VBO after worker-transferred catalog reload. */
  reloadOrbitalElements(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.satVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.orbital.data, gl.STATIC_DRAW);
    if (this.groupIds) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.satGroupVbo);
      const groupFloat = new Float32Array(this.groupIds.length);
      for (let i = 0; i < this.groupIds.length; i++) {
        groupFloat[i] = this.groupIds[i];
      }
      gl.bufferData(gl.ARRAY_BUFFER, groupFloat, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private buildEarthGeometry(earth: EarthMesh): void {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, earth.interleaved, gl.STATIC_DRAW);
    // position (location 0)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    // normal (location 1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, earth.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.earthVao = vao;
    this.earthIndexCount = earth.indices.length;
  }

  setDebug(opts: Partial<WebGLDebugOptions>): void {
    this.debug = { ...this.debug, ...opts };
  }

  getDebug(): WebGLDebugOptions {
    return { ...this.debug };
  }

  setImageTuning(settings: ImageTuningSettings): void {
    this.imageTuning = { ...settings };
    this.satVisualPacked = packSatelliteVisualUniform(settings);
  }

  getImageTuning(): ImageTuningSettings {
    return { ...this.imageTuning };
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    destroyRenderTarget(gl, this.hdr ?? null);
    destroyRenderTarget(gl, this.bloomA ?? null);
    destroyRenderTarget(gl, this.bloomB ?? null);
    this.destroyPickTarget();

    const float = this.floatRenderable;
    this.hdr = createRenderTarget(gl, this.width, this.height, { float, depth: true });
    // Half-resolution bloom targets.
    const bw = Math.max(1, this.width >> 1);
    const bh = Math.max(1, this.height >> 1);
    this.bloomA = createRenderTarget(gl, bw, bh, { float, depth: false });
    this.bloomB = createRenderTarget(gl, bw, bh, { float, depth: false });
    this.ensurePickTarget();
  }

  pickSatelliteAt(
    frame: WebGLFrame,
    clientX: number,
    clientY: number,
    pickSize = 16,
  ): number {
    const gl = this.gl;
    this.ensurePickTarget();
    if (!this.pickFbo) return -1;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / Math.max(1, rect.width);
    const scaleY = this.height / Math.max(1, rect.height);
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;
    const centerNdcX = (px / this.width) * 2 - 1;
    const centerNdcY = 1 - (py / this.height) * 2;
    const pickScale = Math.max(this.width, this.height) / pickSize;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.viewport(0, 0, pickSize, pickSize);
    gl.scissor(0, 0, pickSize, pickSize);
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.satPickProgram);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(this.satPickU.loc('uViewProj'), false, frame.viewProj);
    gl.uniform3fv(this.satPickU.loc('uCameraPos'), frame.cameraPos);
    gl.uniform1f(this.satPickU.loc('uSimTime'), frame.simTime);
    gl.uniform1f(this.satPickU.loc('uDistanceCullKm'), this.satVisualPacked[6]);
    gl.uniform1i(this.satPickU.loc('uViewMode'), frame.viewMode | 0);
    gl.uniform2f(this.satPickU.loc('uPickCenterNdc'), centerNdcX, centerNdcY);
    gl.uniform1f(this.satPickU.loc('uPickScale'), pickScale);
    gl.bindVertexArray(this.satVao);
    gl.drawArrays(gl.POINTS, 0, this.satCount);
    gl.bindVertexArray(null);

    const pixels = new Uint8Array(pickSize * pickSize * 4);
    gl.readPixels(0, 0, pickSize, pickSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const cx = (pickSize - 1) / 2;
    const cy = (pickSize - 1) / 2;
    let bestId = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let y = 0; y < pickSize; y++) {
      for (let x = 0; x < pickSize; x++) {
        const o = (y * pickSize + x) * 4;
        const id = (pixels[o] << 16) | (pixels[o + 1] << 8) | pixels[o + 2];
        if (id <= 0) continue;
        const dx = x - cx;
        const dy = y - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
    }
    return bestId;
  }

  private ensurePickTarget(): void {
    if (this.pickFbo) return;
    const gl = this.gl;
    const size = 16;
    this.pickTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.pickDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);

    this.pickFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTexture, 0);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.pickDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private destroyPickTarget(): void {
    const gl = this.gl;
    if (this.pickTexture) gl.deleteTexture(this.pickTexture);
    if (this.pickDepth) gl.deleteRenderbuffer(this.pickDepth);
    if (this.pickFbo) gl.deleteFramebuffer(this.pickFbo);
    this.pickTexture = null;
    this.pickDepth = null;
    this.pickFbo = null;
  }

  renderFrame(frame: WebGLFrame): void {
    const gl = this.gl;
    const invViewProj = mat4inv(frame.viewProj);

    // ── Scene → HDR target ─────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const isMoonView = (frame.viewMode & 0xffff) === 4;
    if (this.debug.showStars) this.drawStarfield(invViewProj, frame);
    if (!isMoonView && this.debug.showEarth) this.drawEarth(frame);
    if (this.debug.showSatellites) this.drawSatellites(frame);
    if (isMoonView && this.debug.showEarth) this.drawEarth(frame);
    if (isMoonView) this.drawMoonEarthDisk(invViewProj, frame);
    if (isMoonView) this.drawMoonForeground(invViewProj, frame);

    // ── Bloom ──────────────────────────────────────────────────────────
    if (this.debug.showBloom) this.drawBloom();

    // ── Composite → screen ─────────────────────────────────────────────
    this.drawComposite(frame);
  }

  private drawStarfield(invViewProj: Float32Array, frame: WebGLFrame): void {
    const gl = this.gl;
    gl.useProgram(this.starProgram);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(this.starU.loc('uInvViewProj'), false, invViewProj);
    gl.uniform1f(this.starU.loc('uTime'), frame.time);
    gl.uniform1i(this.starU.loc('uBackgroundMode'), frame.backgroundMode | 0);
    gl.uniform3f(
      this.starU.loc('uCameraPos'),
      frame.cameraPos[0],
      frame.cameraPos[1],
      frame.cameraPos[2],
    );
    gl.uniform3fv(this.starU.loc('uSunDir'), frame.sunDir);
    gl.uniform1i(this.starU.loc('uViewMode'), frame.viewMode | 0);
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private drawEarth(frame: WebGLFrame): void {
    const gl = this.gl;
    gl.useProgram(this.earthProgram);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(this.earthU.loc('uViewProj'), false, frame.viewProj);
    gl.uniform3fv(this.earthU.loc('uCameraPos'), frame.cameraPos);
    gl.uniform3fv(this.earthU.loc('uSunDir'), frame.sunDir);
    gl.uniform1i(this.earthU.loc('uViewMode'), frame.viewMode | 0);
    gl.uniform1i(this.earthU.loc('uWireframe'), this.debug.wireframeEarth ? 1 : 0);
    gl.bindVertexArray(this.earthVao);
    if (this.debug.wireframeEarth) {
      // GL_POINTS gives a cheap wireframe-like vertex cloud (no LINES index buffer needed).
      gl.drawElements(gl.LINE_STRIP, this.earthIndexCount, gl.UNSIGNED_INT, 0);
    } else {
      gl.drawElements(gl.TRIANGLES, this.earthIndexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  private drawSatellites(frame: WebGLFrame): void {
    const gl = this.gl;
    gl.useProgram(this.satProgram);
    // Depth-test against Earth (occlusion) but additive, no depth write.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniformMatrix4fv(this.satU.loc('uViewProj'), false, frame.viewProj);
    gl.uniform3fv(this.satU.loc('uCameraPos'), frame.cameraPos);
    gl.uniform1f(this.satU.loc('uSimTime'), frame.simTime);
    gl.uniform2f(this.satU.loc('uScreen'), this.width, this.height);
    gl.uniform1f(this.satU.loc('uPointScale'), this.debug.pointScale);
    gl.uniform1i(this.satU.loc('uLodDebug'), this.debug.lodDebug ? 1 : 0);
    gl.uniform1i(this.satU.loc('uViewMode'), frame.viewMode | 0);
    gl.uniform1f(this.satU.loc('uDistanceCullKm'), this.satVisualPacked[6]);
    gl.uniform1f(this.satU.loc('uTimeScale'), frame.timeScale ?? 1.0);
    const hv = frame.hostVelocity ?? [0, 0, 0];
    gl.uniform3f(this.satU.loc('uHostVelocity'), hv[0], hv[1], hv[2]);
    gl.uniform1f(this.satU.loc('uCoreOuter'), this.satVisualPacked[0]);
    gl.uniform1f(this.satU.loc('uCoreInner'), this.satVisualPacked[1]);
    gl.uniform1f(this.satU.loc('uHaloOuter'), this.satVisualPacked[2]);
    gl.uniform1f(this.satU.loc('uHaloInner'), this.satVisualPacked[3]);
    gl.uniform1f(this.satU.loc('uHaloStrength'), this.satVisualPacked[4]);
    gl.uniform1f(this.satU.loc('uCoreBoost'), this.satVisualPacked[5]);
    this.uploadGroupUniforms();
    gl.bindVertexArray(this.satVao);
    gl.drawArrays(gl.POINTS, 0, this.satCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  private drawMoonEarthDisk(invViewProj: Float32Array, frame: WebGLFrame): void {
    const gl = this.gl;
    gl.useProgram(this.moonEarthDiskProgram);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(this.moonEarthDiskU.loc('uInvViewProj'), false, invViewProj);
    gl.uniform1i(this.moonEarthDiskU.loc('uViewMode'), frame.viewMode | 0);
    gl.uniform3f(
      this.moonEarthDiskU.loc('uCameraPos'),
      frame.cameraPos[0],
      frame.cameraPos[1],
      frame.cameraPos[2],
    );
    gl.uniform3fv(this.moonEarthDiskU.loc('uSunDir'), frame.sunDir);
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  private drawMoonForeground(invViewProj: Float32Array, frame: WebGLFrame): void {
    const gl = this.gl;
    gl.useProgram(this.moonForegroundProgram);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(this.moonForegroundU.loc('uInvViewProj'), false, invViewProj);
    gl.uniform1f(this.moonForegroundU.loc('uTime'), frame.time);
    gl.uniform1i(this.moonForegroundU.loc('uViewMode'), frame.viewMode | 0);
    gl.uniform3f(
      this.moonForegroundU.loc('uCameraPos'),
      frame.cameraPos[0],
      frame.cameraPos[1],
      frame.cameraPos[2],
    );
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  private drawBloom(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    const bw = this.bloomA.width;
    const bh = this.bloomA.height;

    // Threshold: HDR → bloomA
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.thresholdProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdr.color);
    gl.uniform1i(this.thresholdU.loc('uScene'), 0);
    gl.uniform1f(this.thresholdU.loc('uThreshold'), this.imageTuning.bloomThreshold);
    gl.uniform1f(this.thresholdU.loc('uKnee'), this.imageTuning.bloomKnee);
    gl.uniform1f(this.thresholdU.loc('uEnforceFloors'), this.imageTuning.enforceFloors ? 1.0 : 0.0);
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Separable Gaussian, two ping-pong iterations.
    gl.useProgram(this.blurProgram);
    for (let i = 0; i < 2; i++) {
      // Horizontal: bloomA → bloomB
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
      gl.viewport(0, 0, bw, bh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomA.color);
      gl.uniform1i(this.blurU.loc('uSource'), 0);
      gl.uniform2f(this.blurU.loc('uDirection'), 1.0 / bw, 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Vertical: bloomB → bloomA
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomB.color);
      gl.uniform2f(this.blurU.loc('uDirection'), 0.0, 1.0 / bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
  }

  private drawComposite(frame: WebGLFrame): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.hdr.color);
    gl.uniform1i(this.compositeU.loc('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.color);
    gl.uniform1i(this.compositeU.loc('uBloom'), 1);
    gl.uniform1f(
      this.compositeU.loc('uBloomIntensity'),
      this.debug.showBloom ? this.imageTuning.bloomIntensity : 0.0,
    );
    gl.uniform1f(this.compositeU.loc('uExposure'), 1.0);
    gl.uniform1f(this.compositeU.loc('uTime'), frame.time);
    gl.uniform1i(this.compositeU.loc('uTonemap'), 0);
    gl.bindVertexArray(this.fsTriangle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    if (!gl) return;
    destroyRenderTarget(gl, this.hdr ?? null);
    destroyRenderTarget(gl, this.bloomA ?? null);
    destroyRenderTarget(gl, this.bloomB ?? null);
    for (const p of [
      this.satProgram,
      this.earthProgram,
      this.starProgram,
      this.thresholdProgram,
      this.blurProgram,
      this.compositeProgram,
      this.moonForegroundProgram,
      this.moonEarthDiskProgram,
    ]) {
      if (p) gl.deleteProgram(p);
    }
  }
}
