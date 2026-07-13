/**
 * Orbital ring guide for Moon View.
 *
 * Renders a faint great-circle at the 550 km shell radius (always on in Moon View).
 * Dev toggle boosts brightness for geometry debugging.
 */

import type { WebGPUContext } from '@/core/WebGPUContext.js';
import { CONSTANTS } from '@/types/constants.js';

const SEGMENTS = 192;
const RING_RADIUS_KM = CONSTANTS.ORBIT_RADIUS_KM;

export class MoonRingGuide {
  private context: WebGPUContext;
  private enabled = false;
  private subtleRing = true;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private alphaBuffer: GPUBuffer | null = null;
  private vertexCount = 0;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.pipeline) {
      this.createResources();
    }
  }

  /** Subtle ring always visible in Moon View; dev toggle boosts brightness. */
  setSubtleRing(visible: boolean): void {
    this.subtleRing = visible;
    if (visible && !this.pipeline) {
      this.createResources();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  shouldRender(): boolean {
    return this.subtleRing || this.enabled;
  }

  encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void {
    if (!this.shouldRender() || !this.pipeline || !this.vertexBuffer || !this.alphaBuffer) {
      return;
    }
    const device = this.context.getDevice();
    const layout = this.pipeline.getBindGroupLayout(0);

    const drawRing = (alpha: number): void => {
      device.queue.writeBuffer(this.alphaBuffer!, 0, new Float32Array([alpha, 0, 0, 0]));
      const bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: this.alphaBuffer! } },
        ],
      });
      pass.setPipeline(this.pipeline!);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.draw(this.vertexCount);
    };

    if (this.subtleRing) {
      drawRing(0.055);
    }
    if (this.enabled) {
      drawRing(0.14);
    }
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.alphaBuffer?.destroy();
    this.vertexBuffer = null;
    this.alphaBuffer = null;
    this.pipeline = null;
  }

  private createResources(): void {
    const device = this.context.getDevice();
    const vertices = this.buildRingVertices();
    this.vertexCount = vertices.length / 3;

    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'MoonRingGuide',
    });
    device.queue.writeBuffer(
      this.vertexBuffer,
      0,
      vertices.buffer,
      vertices.byteOffset,
      vertices.byteLength,
    );

    this.alphaBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'MoonRingGuideAlpha',
    });

    const shader = device.createShaderModule({
      label: 'MoonRingGuide',
      code: /* wgsl */ `
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
        struct RingAlpha { alpha: f32, _pad: vec3f, }
        @group(0) @binding(1) var<uniform> ring: RingAlpha;

        struct VSOut {
          @builtin(position) pos: vec4f,
        };

        @vertex
        fn vs(@location(0) p: vec3f) -> VSOut {
          var o: VSOut;
          o.pos = uni.view_proj * vec4f(p, 1.0);
          return o;
        }

        @fragment
        fn fs(in: VSOut) -> @location(0) vec4f {
          let c = vec3f(0.55, 0.82, 1.0);
          return vec4f(c, ring.alpha);
        }
      `,
    });

    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
          ],
        }),
      ],
    });

    this.pipeline = device.createRenderPipeline({
      label: 'MoonRingGuide',
      layout,
      vertex: {
        module: shader,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
    });
  }

  private buildRingVertices(): Float32Array {
    const r = RING_RADIUS_KM;
    const inc = 0.907571211; // 53° shell inclination (main Starlink shell)
    const sinI = Math.sin(inc);
    const cosI = Math.cos(inc);
    const pts: [number, number, number][] = [];

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * Math.PI * 2;
      const ox = r * Math.cos(t);
      const oy = r * Math.sin(t);
      pts.push([ox, oy * cosI, oy * sinI]);
    }

    const verts: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }

    return new Float32Array(verts);
  }
}
