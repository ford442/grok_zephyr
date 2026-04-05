/**
 * Grok Zephyr - Trail Renderer
 * 
 * Renders persistent orbital trails with fade-out.
 * Color-coded by orbital shell with GPU-based mesh generation.
 */

import type WebGPUContext from '@/core/WebGPUContext.js';
import type { TrailConfig, TrailPoint } from '@/types/animation.js';

/** Shell colors matching the satellite shader */
const SHELL_COLORS: Float32Array = new Float32Array([
  1.0, 0.0, 0.0,    // Shell 0 (340km): Red
  0.15, 0.55, 1.0,  // Shell 1 (550km): Cyan-blue
  1.0, 0.78, 0.28,  // Shell 2 (1150km): Gold
]);

/** Trail vertex format: [pos_x, pos_y, pos_z, intensity, age] */
const VERTEX_STRIDE = 5;

/**
 * Trail Renderer
 * 
 * Manages orbital trail rendering with:
 * - Persistent trail history buffers
 * - GPU-based ribbon mesh generation
 * - Shell-based color coding
 * - Distance-based LOD
 */
export class TrailRenderer {
  private context: WebGPUContext;
  private config: TrailConfig;
  
  // Trail history: array of position buffers per satellite (simplified: per shell)
  private trailHistory: Map<number, TrailPoint[]> = new Map();
  
  // GPU buffers
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  
  // Pipeline
  private pipeline: GPURenderPipeline | null = null;
  
  // Statistics
  private vertexCount = 0;
  private indexCount = 0;
  private activeTrails = 0;
  
  // Maximum trail segments per satellite
  private maxTrailSegments = 100;

  constructor(context: WebGPUContext, config: TrailConfig) {
    this.context = context;
    this.config = config;
  }

  /**
   * Initialize trail renderer
   */
  initialize(): void {
    this.createPipeline();
    this.createBuffers();
  }

  /**
   * Update trail configuration
   */
  setConfig(config: TrailConfig): void {
    this.config = config;
    this.maxTrailSegments = Math.max(10, Math.floor(config.maxLength * 30)); // 30 fps assumption
  }

  /**
   * Record a satellite position for trail
   */
  recordPosition(satelliteIndex: number, position: Float32Array, timestamp: number, shellIndex: number): void {
    if (!this.config.enabled) return;
    
    // Use satelliteIndex to vary the sampling pattern
    const _satIdx = satelliteIndex;
    
    // Limit history size - store sparse samples for performance
    // Only record every Nth satellite for trails (sparse sampling)
    if (_satIdx % 256 !== 0) return; // 1 in 256 satellites
    
    let trail = this.trailHistory.get(satelliteIndex);
    if (!trail) {
      trail = [];
      this.trailHistory.set(satelliteIndex, trail);
    }
    
    // Add new point
    trail.push({
      position: [position[0], position[1], position[2]],
      timestamp,
      intensity: 1.0,
      shellIndex,
    });
    
    // Remove old points
    const cutoff = timestamp - this.config.maxLength;
    while (trail.length > 0 && trail[0].timestamp < cutoff) {
      trail.shift();
    }
    
    // Limit max segments
    while (trail.length > this.maxTrailSegments) {
      trail.shift();
    }
  }

  /**
   * Update trail geometry (call before rendering)
   */
  updateGeometry(currentTime: number, cameraPosition: Float32Array): void {
    if (!this.config.enabled) return;
    
    // Build vertex and index buffers from trail history
    const vertices: number[] = [];
    const indices: number[] = [];
    
    let indexOffset = 0;
    this.activeTrails = 0;
    
    for (const [satIndex, trail] of this.trailHistory) {
      if (trail.length < 2) continue;
      
      // LOD: skip distant trails
      const lastPos = trail[trail.length - 1].position;
      const distToCamera = Math.sqrt(
        Math.pow(lastPos[0] - cameraPosition[0], 2) +
        Math.pow(lastPos[1] - cameraPosition[1], 2) +
        Math.pow(lastPos[2] - cameraPosition[2], 2)
      );
      
      // Skip if too far
      if (distToCamera > 50000) continue;
      
      // Reduce segments for distant trails
      let step = 1;
      if (distToCamera > 20000) step = 4;
      else if (distToCamera > 10000) step = 2;
      
      this.generateTrailRibbon(trail, vertices, indices, indexOffset, currentTime, step);
      indexOffset += Math.floor((trail.length - 1) / step) * 2 + 2;
      this.activeTrails++;
    }
    
    this.vertexCount = vertices.length / VERTEX_STRIDE;
    this.indexCount = indices.length;
    
    // Update GPU buffers
    if (this.vertexCount > 0) {
      this.updateGPUBuffers(vertices, indices);
    }
  }

  /**
   * Encode render pass
   */
  encodeRenderPass(encoder: GPURenderPassEncoder, uniformBuffer: GPUBuffer): void {
    if (!this.config.enabled || this.vertexCount === 0 || !this.pipeline) return;
    
    // Update bind group with current uniform buffer
    const device = this.context.getDevice();
    const bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer! } },
      ],
    });
    
    encoder.setPipeline(this.pipeline);
    encoder.setBindGroup(0, bindGroup);
    encoder.setVertexBuffer(0, this.vertexBuffer);
    encoder.setIndexBuffer(this.indexBuffer!, 'uint32');
    encoder.drawIndexed(this.indexCount);
  }

  /**
   * Get statistics
   */
  getStats(): { activeTrails: number; vertexCount: number } {
    return {
      activeTrails: this.activeTrails,
      vertexCount: this.vertexCount,
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  private createPipeline(): void {
    const device = this.context.getDevice();
    
    // Shader code
    const shaderCode = /* wgsl */ `
      struct Uniforms {
        view_proj: mat4x4f,
        camera_pos: vec4f,
        time: f32,
        fade_duration: f32,
        ribbon_width: f32,
        shell_colors: array<vec3f, 3>,
      };
      
      @group(0) @binding(0) var<uniform> scene_uni: Uniforms;
      @group(0) @binding(1) var<uniform> trail_uni: Uniforms;
      
      struct VertexOut {
        @builtin(position) position: vec4f,
        @location(0) color: vec3f,
        @location(1) alpha: f32,
      };
      
      @vertex
      fn vs_main(
        @location(0) pos: vec3f,
        @location(1) intensity: f32,
        @location(2) age: f32,
        @location(3) shell_idx: u32,
      ) -> VertexOut {
        var out: VertexOut;
        
        // Get shell color
        let shell_color = trail_uni.shell_colors[shell_idx % 3u];
        
        // Fade based on age
        let fade = 1.0 - smoothstep(0.0, trail_uni.fade_duration, age);
        
        // Apply intensity and fade
        out.color = shell_color * intensity * 2.0;
        out.alpha = intensity * fade;
        
        // Transform position
        out.position = scene_uni.view_proj * vec4f(pos, 1.0);
        
        return out;
      }
      
      @fragment
      fn fs_main(in: VertexOut) -> @location(0) vec4f {
        // HDR trail output
        return vec4f(in.color, in.alpha);
      }
    `;
    
    const shaderModule = device.createShaderModule({ code: shaderCode });
    
    // Vertex buffer layout
    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: VERTEX_STRIDE * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
        { shaderLocation: 1, offset: 12, format: 'float32' },   // intensity
        { shaderLocation: 2, offset: 16, format: 'float32' },   // age
        { shaderLocation: 3, offset: 20, format: 'uint32' },    // shell index
      ],
    };
    
    // Pipeline layout
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [
        device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          ],
        }),
      ],
    });
    
    this.pipeline = device.createRenderPipeline({
      layout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [vertexLayout],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba16float', blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        }}],
      },
      primitive: {
        topology: 'triangle-list',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });
  }

  private createBuffers(): void {
    const device = this.context.getDevice();
    
    // Initial buffer sizes (will grow as needed)
    const maxVertices = 100000;
    const maxIndices = 300000;
    
    this.vertexBuffer = device.createBuffer({
      size: maxVertices * VERTEX_STRIDE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    
    this.indexBuffer = device.createBuffer({
      size: maxIndices * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    
    // Trail uniform buffer
    this.uniformBuffer = device.createBuffer({
      size: 256, // Aligned
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private generateTrailRibbon(
    trail: TrailPoint[],
    vertices: number[],
    indices: number[],
    indexOffset: number,
    currentTime: number,
    step: number
  ): void {
    const width = this.config.ribbonWidth;
    
    for (let i = 0; i < trail.length - 1; i += step) {
      const p1 = trail[i];
      
      // Calculate age
      const age1 = currentTime - p1.timestamp;
      
      // Get color from shell
      const shellIdx = p1.shellIndex;
      
      // Add vertices (simplified - no camera-facing ribbons, just lines)
      // In a full implementation, we'd extrude perpendicular to view direction
      
      // Vertex 1 (p1)
      vertices.push(p1.position[0], p1.position[1], p1.position[2], p1.intensity, age1, shellIdx);
      
      // Vertex 2 (p1 + width offset - simplified)
      vertices.push(
        p1.position[0] + width,
        p1.position[1] + width,
        p1.position[2] + width,
        p1.intensity * 0.5,
        age1,
        shellIdx
      );
    }
    
    // Generate indices for triangle strips
    for (let i = 0; i < Math.floor((trail.length - 1) / step) * 2; i += 2) {
      const base = indexOffset + i;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  private updateGPUBuffers(vertices: number[], indices: number[]): void {
    const device = this.context.getDevice();
    
    // Update vertex buffer
    const vertexData = new Float32Array(vertices);
    device.queue.writeBuffer(this.vertexBuffer!, 0, vertexData);
    
    // Update index buffer
    const indexData = new Uint32Array(indices);
    device.queue.writeBuffer(this.indexBuffer!, 0, indexData);
    
    // Update uniform buffer
    const uniformData = new Float32Array([
      // shell_colors[0]
      SHELL_COLORS[0], SHELL_COLORS[1], SHELL_COLORS[2], 0,
      // shell_colors[1]
      SHELL_COLORS[3], SHELL_COLORS[4], SHELL_COLORS[5], 0,
      // shell_colors[2]
      SHELL_COLORS[6], SHELL_COLORS[7], SHELL_COLORS[8], 0,
      // fade_duration, ribbon_width, padding
      this.config.fadeOut, this.config.ribbonWidth, 0, 0,
    ]);
    device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);
  }
}

export default TrailRenderer;
