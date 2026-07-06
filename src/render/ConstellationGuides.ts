/**
 * Faint great-circle shell guides for God View (dev toggle, off by default).
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import { CONSTANTS, INCLINATION_SHELLS } from '@/types/constants.js';

const SEGMENTS_PER_RING = 128;
const SHELL_RADII_KM = [6711, CONSTANTS.ORBIT_RADIUS_KM, 7521] as const;

export class ConstellationGuides {
  private context: WebGPUContext;
  private enabled = false;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private vertexCount = 0;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.pipeline) {
      this.createResources();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  encodeRenderPass(pass: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void {
    if (!this.enabled || !this.pipeline || !this.vertexBuffer) return;
    const bindGroup = this.context.getDevice().createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.vertexBuffer = null;
    this.pipeline = null;
  }

  private createResources(): void {
    const device = this.context.getDevice();
    const vertices = this.buildRingVertices();
    this.vertexCount = vertices.length / 3;

    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'ConstellationGuides',
    });
    device.queue.writeBuffer(
      this.vertexBuffer,
      0,
      vertices.buffer as ArrayBuffer,
      vertices.byteOffset,
      vertices.byteLength,
    );

    const shader = device.createShaderModule({
      label: 'ConstellationGuides',
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

        struct VSOut {
          @builtin(position) pos: vec4f,
          @location(0) @interpolate(flat) ring: f32,
        };

        @vertex
        fn vs(@location(0) p: vec3f, @location(1) ring: f32) -> VSOut {
          var o: VSOut;
          o.pos = uni.view_proj * vec4f(p, 1.0);
          o.ring = ring;
          return o;
        }

        @fragment
        fn fs(in: VSOut) -> @location(0) vec4f {
          let colors = array<vec3f, 3>(
            vec3f(1.0, 0.72, 0.38),
            vec3f(0.55, 0.85, 1.0),
            vec3f(0.75, 0.95, 0.82),
          );
          let idx = u32(clamp(in.ring, 0.0, 2.0));
          let c = colors[idx];
          return vec4f(c, 0.22);
        }
      `,
    });

    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          }],
        }),
      ],
    });

    this.pipeline = device.createRenderPipeline({
      label: 'ConstellationGuides',
      layout,
      vertex: {
        module: shader,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32' },
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
    });
  }

  private buildRingVertices(): Float32Array {
    const inclinations = [INCLINATION_SHELLS[0], INCLINATION_SHELLS[1], INCLINATION_SHELLS[2]];
    const verts: number[] = [];

    for (let ring = 0; ring < 3; ring++) {
      const r = SHELL_RADII_KM[ring] ?? CONSTANTS.ORBIT_RADIUS_KM;
      const inc = inclinations[ring] ?? INCLINATION_SHELLS[0];
      const sinI = Math.sin(inc);
      const cosI = Math.cos(inc);
      const pts: [number, number, number][] = [];

      for (let i = 0; i <= SEGMENTS_PER_RING; i++) {
        const t = (i / SEGMENTS_PER_RING) * Math.PI * 2;
        const ox = r * Math.cos(t);
        const oy = r * Math.sin(t);
        pts.push([ox, oy * cosI, oy * sinI]);
      }

      for (let i = 0; i < SEGMENTS_PER_RING; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        verts.push(a[0], a[1], a[2], ring, b[0], b[1], b[2], ring);
      }
    }

    return new Float32Array(verts);
  }
}
