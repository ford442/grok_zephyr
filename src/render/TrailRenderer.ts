/**
 * Grok Zephyr - Trail Renderer
 *
 * High-capacity orbital trail renderer with typed-array ring buffers.
 * Trails are sampled from many satellites, then rendered as additive ribbons.
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { TrailConfig } from '@/types/animation.js';

/** Shell colors matching satellite visual families */
const SHELL_COLORS: Float32Array = new Float32Array([
  1.0, 0.62, 0.24, // warm amber
  1.0, 1.0, 1.0,   // white
  0.42, 0.84, 1.0, // cool cyan
]);

const VERTEX_STRIDE_FLOATS = 6; // x,y,z,intensity,age,shell
const FLOAT_SIZE = 4;
const UINT_SIZE = 4;

const MAX_TRAILS_RENDERED = 12000;
const MAX_SEGMENTS_RENDERED = 16;
const TRAIL_TTL_SECONDS = 12.0;
const MAX_DISTANCE_KM = 120000.0;

export class TrailRenderer {
  private context: WebGPUContext;
  private config: TrailConfig;

  // Satellite index -> slot mapping for history storage
  private slotForSatellite: Map<number, number> = new Map();
  private satelliteForSlot: Int32Array | null = null;
  private slotLastSeen: Float32Array | null = null;
  private slotHeads: Uint16Array | null = null;
  private slotCounts: Uint16Array | null = null;
  private slotShell: Uint8Array | null = null;
  private ringPositions: Float32Array | null = null; // [slot][frame][xyz]
  private ringTimes: Float32Array | null = null;     // [slot][frame]

  private maxTrackedSatellites = 12000;
  private historyFrames = 12;

  // GPU resources (allocated lazily only when enabled)
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private vertexCapacity = 0;
  private indexCapacity = 0;
  private pipeline: GPURenderPipeline | null = null;

  // CPU staging
  private vertexStaging: Float32Array = new Float32Array(0);
  private indexStaging: Uint32Array = new Uint32Array(0);
  private vertexCount = 0;
  private indexCount = 0;
  private activeTrails = 0;
  private slotWriteCursor = 0;
  private initialized = false;

  constructor(context: WebGPUContext, config: TrailConfig) {
    this.context = context;
    this.config = config;
    this.applyCapacityFromConfig();
  }

  initialize(): void {
    this.initialized = true;
    if (this.config.enabled) {
      this.ensureEnabledResources();
    }
  }

  setConfig(config: TrailConfig): void {
    const wasEnabled = this.config.enabled;
    this.config = config;
    const prevTracked = this.maxTrackedSatellites;
    const prevFrames = this.historyFrames;
    this.applyCapacityFromConfig();

    if (!this.config.enabled) {
      this.releaseDynamicResources();
      return;
    }

    this.ensureEnabledResources();
    if (!wasEnabled || prevTracked !== this.maxTrackedSatellites || prevFrames !== this.historyFrames) {
      this.resetHistory();
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Recommended sampling budget for the app-side sampler loop.
   */
  getSamplingBudget(): number {
    if (!this.config.enabled) return 0;
    return Math.min(this.maxTrackedSatellites, Math.max(2000, Math.floor(this.maxTrackedSatellites * 0.65)));
  }

  recordPosition(satelliteIndex: number, position: Float32Array, timestamp: number, shellIndex: number): void {
    if (!this.config.enabled) return;
    if (!this.ringPositions || !this.ringTimes || !this.slotHeads || !this.slotCounts || !this.slotLastSeen || !this.slotShell || !this.satelliteForSlot) {
      return;
    }

    let slot = this.slotForSatellite.get(satelliteIndex);
    if (slot === undefined) {
      slot = this.allocateSlot(timestamp);
      if (slot < 0) return;
      this.slotForSatellite.set(satelliteIndex, slot);
      this.satelliteForSlot[slot] = satelliteIndex;
      this.slotCounts[slot] = 0;
      this.slotHeads[slot] = 0;
      this.slotShell[slot] = shellIndex % 3;
    }

    const nextHead = (this.slotHeads[slot] + 1) % this.historyFrames;
    this.slotHeads[slot] = nextHead;
    this.slotCounts[slot] = Math.min(this.slotCounts[slot] + 1, this.historyFrames);
    this.slotLastSeen[slot] = timestamp;
    this.slotShell[slot] = shellIndex % 3;

    const posBase = (slot * this.historyFrames + nextHead) * 3;
    this.ringPositions[posBase] = position[0];
    this.ringPositions[posBase + 1] = position[1];
    this.ringPositions[posBase + 2] = position[2];
    this.ringTimes[slot * this.historyFrames + nextHead] = timestamp;
  }

  updateGeometry(currentTime: number, cameraPosition: Float32Array, cameraForward: Float32Array): void {
    if (!this.config.enabled || !this.ringPositions || !this.ringTimes || !this.slotHeads || !this.slotCounts || !this.slotLastSeen || !this.slotShell || !this.satelliteForSlot) {
      this.vertexCount = 0;
      this.indexCount = 0;
      this.activeTrails = 0;
      return;
    }

    this.ensureEnabledResources();
    if (!this.pipeline) return;

    const maxTrails = MAX_TRAILS_RENDERED;
    const maxSegments = Math.min(MAX_SEGMENTS_RENDERED, Math.max(6, this.historyFrames - 1));
    const maxVertices = maxTrails * maxSegments * 2;
    const maxIndices = maxTrails * maxSegments * 6;
    this.ensureStagingCapacity(maxVertices, maxIndices);

    let vCursor = 0;
    let iCursor = 0;
    let baseVertex = 0;
    this.activeTrails = 0;

    for (let slot = 0; slot < this.maxTrackedSatellites; slot++) {
      if (this.activeTrails >= maxTrails) break;
      if (this.satelliteForSlot[slot] < 0) continue;
      if (currentTime - this.slotLastSeen[slot] > TRAIL_TTL_SECONDS) {
        this.freeSlot(slot);
        continue;
      }
      const count = this.slotCounts[slot];
      if (count < 2) continue;

      const head = this.slotHeads[slot];
      const newestBase = (slot * this.historyFrames + head) * 3;
      const newestX = this.ringPositions[newestBase];
      const newestY = this.ringPositions[newestBase + 1];
      const newestZ = this.ringPositions[newestBase + 2];

      const toCamX = newestX - cameraPosition[0];
      const toCamY = newestY - cameraPosition[1];
      const toCamZ = newestZ - cameraPosition[2];
      const dist = Math.sqrt(toCamX * toCamX + toCamY * toCamY + toCamZ * toCamZ);
      if (dist > MAX_DISTANCE_KM) continue;

      const invLen = dist > 1e-3 ? 1.0 / dist : 0.0;
      const facing = (toCamX * cameraForward[0] + toCamY * cameraForward[1] + toCamZ * cameraForward[2]) * invLen;
      if (facing < -0.2) continue;

      const lodStep = dist > 70000 ? 4 : dist > 35000 ? 2 : 1;
      const segmentLimit = Math.min(maxSegments, count - 1);
      if (segmentLimit < 1) continue;
      const shell = this.slotShell[slot] % 3;

      for (let seg = 0; seg < segmentLimit; seg += lodStep) {
        const h0 = (head + this.historyFrames - seg) % this.historyFrames;
        const h1 = (head + this.historyFrames - (seg + lodStep)) % this.historyFrames;
        const p0 = (slot * this.historyFrames + h0) * 3;
        const p1 = (slot * this.historyFrames + h1) * 3;

        const x0 = this.ringPositions[p0];
        const y0 = this.ringPositions[p0 + 1];
        const z0 = this.ringPositions[p0 + 2];
        const x1 = this.ringPositions[p1];
        const y1 = this.ringPositions[p1 + 1];
        const z1 = this.ringPositions[p1 + 2];

        const t0 = this.ringTimes[slot * this.historyFrames + h0];
        const t1 = this.ringTimes[slot * this.historyFrames + h1];
        const age0 = Math.max(0, currentTime - t0);
        const age1 = Math.max(0, currentTime - t1);

        const dirX = x1 - x0;
        const dirY = y1 - y0;
        const dirZ = z1 - z0;
        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        if (dirLen < 1e-3) continue;
        const invDirLen = 1.0 / dirLen;
        const dnX = dirX * invDirLen;
        const dnY = dirY * invDirLen;
        const dnZ = dirZ * invDirLen;

        const camDirX = cameraPosition[0] - x0;
        const camDirY = cameraPosition[1] - y0;
        const camDirZ = cameraPosition[2] - z0;
        const camDirLen = Math.sqrt(camDirX * camDirX + camDirY * camDirY + camDirZ * camDirZ);
        if (camDirLen < 1e-3) continue;
        const invCam = 1.0 / camDirLen;
        const cnX = camDirX * invCam;
        const cnY = camDirY * invCam;
        const cnZ = camDirZ * invCam;

        let rightX = dnY * cnZ - dnZ * cnY;
        let rightY = dnZ * cnX - dnX * cnZ;
        let rightZ = dnX * cnY - dnY * cnX;
        const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
        if (rightLen < 1e-6) continue;
        const invRight = 1.0 / rightLen;
        rightX *= invRight;
        rightY *= invRight;
        rightZ *= invRight;

        const normSeg = seg / Math.max(1, segmentLimit);
        const taper = 1.0 - normSeg * 0.85;
        const distanceScale = Math.min(1.6, Math.max(0.45, dist * 0.000025));
        const width = this.config.ribbonWidth * taper * distanceScale;

        const intensity0 = Math.max(0, 1.0 - age0 / Math.max(1, this.config.fadeOut));
        const intensity1 = Math.max(0, 1.0 - age1 / Math.max(1, this.config.fadeOut));

        const pushVertex = (x: number, y: number, z: number, intensity: number, age: number, shellIdx: number): void => {
          if (vCursor + VERTEX_STRIDE_FLOATS > this.vertexStaging.length) return;
          this.vertexStaging[vCursor++] = x;
          this.vertexStaging[vCursor++] = y;
          this.vertexStaging[vCursor++] = z;
          this.vertexStaging[vCursor++] = intensity;
          this.vertexStaging[vCursor++] = age;
          this.vertexStaging[vCursor++] = shellIdx;
        };

        pushVertex(x0 - rightX * width, y0 - rightY * width, z0 - rightZ * width, intensity0, age0, shell);
        pushVertex(x0 + rightX * width, y0 + rightY * width, z0 + rightZ * width, intensity0, age0, shell);
        pushVertex(x1 - rightX * width, y1 - rightY * width, z1 - rightZ * width, intensity1, age1, shell);
        pushVertex(x1 + rightX * width, y1 + rightY * width, z1 + rightZ * width, intensity1, age1, shell);

        if (iCursor + 6 <= this.indexStaging.length) {
          this.indexStaging[iCursor++] = baseVertex;
          this.indexStaging[iCursor++] = baseVertex + 1;
          this.indexStaging[iCursor++] = baseVertex + 2;
          this.indexStaging[iCursor++] = baseVertex + 1;
          this.indexStaging[iCursor++] = baseVertex + 3;
          this.indexStaging[iCursor++] = baseVertex + 2;
        }
        baseVertex += 4;
      }

      if (baseVertex > 0) {
        this.activeTrails++;
      }
    }

    this.vertexCount = Math.floor(vCursor / VERTEX_STRIDE_FLOATS);
    this.indexCount = iCursor;

    if (this.vertexCount === 0 || this.indexCount === 0) return;
    this.ensureGPUBufferCapacity(this.vertexCount, this.indexCount);
    const device = this.context.getDevice();
    device.queue.writeBuffer(
      this.vertexBuffer!,
      0,
      this.vertexStaging.buffer,
      this.vertexStaging.byteOffset,
      vCursor * Float32Array.BYTES_PER_ELEMENT
    );
    device.queue.writeBuffer(
      this.indexBuffer!,
      0,
      this.indexStaging.buffer,
      this.indexStaging.byteOffset,
      iCursor * Uint32Array.BYTES_PER_ELEMENT
    );
  }

  encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void {
    if (!this.config.enabled || this.vertexCount === 0 || this.indexCount === 0 || !this.pipeline || !this.vertexBuffer || !this.indexBuffer) {
      return;
    }
    const bindGroup = this.context.getDevice().createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(this.indexCount);
  }

  getStats(): { activeTrails: number; vertexCount: number } {
    return { activeTrails: this.activeTrails, vertexCount: this.vertexCount };
  }

  destroy(): void {
    this.releaseDynamicResources();
    this.pipeline = null;
    this.initialized = false;
  }

  private applyCapacityFromConfig(): void {
    if (this.config.maxLength >= 80) {
      this.maxTrackedSatellites = 50000;
      this.historyFrames = 18;
    } else if (this.config.maxLength >= 45) {
      this.maxTrackedSatellites = 26000;
      this.historyFrames = 14;
    } else if (this.config.maxLength >= 25) {
      this.maxTrackedSatellites = 12000;
      this.historyFrames = 10;
    } else {
      this.maxTrackedSatellites = 8000;
      this.historyFrames = 8;
    }
  }

  private ensureEnabledResources(): void {
    if (!this.initialized) return;
    if (!this.pipeline) {
      this.pipeline = this.createPipeline();
    }
    if (!this.ringPositions || !this.ringTimes || !this.slotHeads || !this.slotCounts || !this.slotLastSeen || !this.slotShell || !this.satelliteForSlot) {
      this.resetHistory();
    }
    if (!this.vertexBuffer || !this.indexBuffer) {
      this.ensureGPUBufferCapacity(1024, 2048);
    }
  }

  private resetHistory(): void {
    this.slotForSatellite.clear();
    this.satelliteForSlot = new Int32Array(this.maxTrackedSatellites);
    this.satelliteForSlot.fill(-1);
    this.slotLastSeen = new Float32Array(this.maxTrackedSatellites);
    this.slotHeads = new Uint16Array(this.maxTrackedSatellites);
    this.slotCounts = new Uint16Array(this.maxTrackedSatellites);
    this.slotShell = new Uint8Array(this.maxTrackedSatellites);
    this.ringPositions = new Float32Array(this.maxTrackedSatellites * this.historyFrames * 3);
    this.ringTimes = new Float32Array(this.maxTrackedSatellites * this.historyFrames);
    this.slotWriteCursor = 0;
    this.vertexCount = 0;
    this.indexCount = 0;
    this.activeTrails = 0;
  }

  private releaseDynamicResources(): void {
    this.slotForSatellite.clear();
    this.satelliteForSlot = null;
    this.slotLastSeen = null;
    this.slotHeads = null;
    this.slotCounts = null;
    this.slotShell = null;
    this.ringPositions = null;
    this.ringTimes = null;

    this.vertexStaging = new Float32Array(0);
    this.indexStaging = new Uint32Array(0);
    this.vertexCount = 0;
    this.indexCount = 0;
    this.activeTrails = 0;
    this.slotWriteCursor = 0;

    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.vertexCapacity = 0;
    this.indexCapacity = 0;
  }

  private createPipeline(): GPURenderPipeline {
    const device = this.context.getDevice();
    const shaderCode = /* wgsl */ `
      struct Uni {
        view_proj: mat4x4f,
        camera_pos: vec4f,
        camera_right: vec4f,
        camera_up: vec4f,
        time: f32,
        delta_time: f32,
        view_flags: u32,
        sim_time: f32,
        frustum0: vec4f,
        frustum1: vec4f,
        frustum2: vec4f,
        frustum3: vec4f,
        frustum4: vec4f,
        frustum5: vec4f,
        screen_size: vec2f,
        time_scale: f32,
        pad0: u32,
        sun_position: vec4f,
      };
      @group(0) @binding(0) var<uniform> uni: Uni;

      struct VOut {
        @builtin(position) pos: vec4f,
        @location(0) color: vec3f,
        @location(1) alpha: f32,
      };

      const SHELL_COLORS = array<vec3f, 3>(
        vec3f(${SHELL_COLORS[0]}, ${SHELL_COLORS[1]}, ${SHELL_COLORS[2]}),
        vec3f(${SHELL_COLORS[3]}, ${SHELL_COLORS[4]}, ${SHELL_COLORS[5]}),
        vec3f(${SHELL_COLORS[6]}, ${SHELL_COLORS[7]}, ${SHELL_COLORS[8]})
      );

      @vertex
      fn vs_main(
        @location(0) p: vec3f,
        @location(1) intensity: f32,
        @location(2) age: f32,
        @location(3) shell: f32,
      ) -> VOut {
        var out: VOut;
        let shellIdx = u32(shell) % 3u;
        let fade = 1.0 - smoothstep(0.0, 90.0, age);
        out.color = SHELL_COLORS[shellIdx] * (0.35 + intensity * 0.95);
        out.alpha = intensity * fade * 0.55;
        out.pos = uni.view_proj * vec4f(p, 1.0);
        return out;
      }

      @fragment
      fn fs_main(in: VOut) -> @location(0) vec4f {
        return vec4f(in.color, in.alpha);
      }
    `;
    const module = device.createShaderModule({ code: shaderCode });
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
        }),
      ],
    });
    return device.createRenderPipeline({
      layout,
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: VERTEX_STRIDE_FLOATS * FLOAT_SIZE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * FLOAT_SIZE, format: 'float32' },
            { shaderLocation: 2, offset: 4 * FLOAT_SIZE, format: 'float32' },
            { shaderLocation: 3, offset: 5 * FLOAT_SIZE, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: undefined,
    });
  }

  private ensureStagingCapacity(maxVertices: number, maxIndices: number): void {
    const neededVertexFloats = maxVertices * VERTEX_STRIDE_FLOATS;
    if (this.vertexStaging.length < neededVertexFloats) {
      this.vertexStaging = new Float32Array(neededVertexFloats);
    }
    if (this.indexStaging.length < maxIndices) {
      this.indexStaging = new Uint32Array(maxIndices);
    }
  }

  private ensureGPUBufferCapacity(vertices: number, indices: number): void {
    const device = this.context.getDevice();
    const requiredVertexBytes = Math.max(1024, vertices * VERTEX_STRIDE_FLOATS * FLOAT_SIZE);
    const requiredIndexBytes = Math.max(2048, indices * UINT_SIZE);

    if (!this.vertexBuffer || this.vertexCapacity < requiredVertexBytes) {
      this.vertexBuffer?.destroy();
      this.vertexCapacity = Math.ceil(requiredVertexBytes * 1.25);
      this.vertexBuffer = device.createBuffer({
        size: this.vertexCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        label: 'Trail Vertex Buffer',
      });
    }

    if (!this.indexBuffer || this.indexCapacity < requiredIndexBytes) {
      this.indexBuffer?.destroy();
      this.indexCapacity = Math.ceil(requiredIndexBytes * 1.25);
      this.indexBuffer = device.createBuffer({
        size: this.indexCapacity,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        label: 'Trail Index Buffer',
      });
    }
  }

  private allocateSlot(timestamp: number): number {
    if (!this.satelliteForSlot || !this.slotLastSeen) return -1;

    for (let i = 0; i < this.maxTrackedSatellites; i++) {
      const slot = (this.slotWriteCursor + i) % this.maxTrackedSatellites;
      if (this.satelliteForSlot[slot] < 0) {
        this.slotWriteCursor = (slot + 1) % this.maxTrackedSatellites;
        return slot;
      }
    }

    // Evict least recently seen slot (LRU)
    let oldestSlot = 0;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (let slot = 0; slot < this.maxTrackedSatellites; slot++) {
      const t = this.slotLastSeen[slot];
      if (t < oldestTime) {
        oldestTime = t;
        oldestSlot = slot;
      }
    }
    if (timestamp - oldestTime < 0.05) {
      return -1;
    }
    this.freeSlot(oldestSlot);
    this.slotWriteCursor = (oldestSlot + 1) % this.maxTrackedSatellites;
    return oldestSlot;
  }

  private freeSlot(slot: number): void {
    if (!this.satelliteForSlot || !this.slotCounts || !this.slotHeads || !this.slotLastSeen) return;
    const satIdx = this.satelliteForSlot[slot];
    if (satIdx >= 0) {
      this.slotForSatellite.delete(satIdx);
    }
    this.satelliteForSlot[slot] = -1;
    this.slotCounts[slot] = 0;
    this.slotHeads[slot] = 0;
    this.slotLastSeen[slot] = 0;
  }
}

export default TrailRenderer;
