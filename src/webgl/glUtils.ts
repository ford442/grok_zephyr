/**
 * Grok Zephyr - WebGL2 utility helpers
 *
 * Small, dependency-free helpers used by the WebGL2 fallback renderer:
 * context acquisition (+ float-render extension), shader compile/link with
 * readable error reporting, and texture / framebuffer creation for the
 * offscreen HDR + bloom targets.
 */

/** Result of acquiring a WebGL2 context with the extensions we need. */
export interface GLContext {
  gl: WebGL2RenderingContext;
  /** True when EXT_color_buffer_float is available (HDR float render targets). */
  floatRenderable: boolean;
}

/**
 * Acquire a WebGL2 context from the canvas, enabling float-render extensions
 * when available. Throws if WebGL2 is unsupported.
 */
export function acquireGL(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // allow Playwright / toDataURL readback
    powerPreference: 'high-performance',
  });
  if (!gl) {
    throw new Error('WebGL2 is not supported in this browser.');
  }
  // RGBA16F as a color-renderable/blendable target needs these extensions.
  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_float_blend');
  gl.getExtension('OES_texture_float_linear');
  return { gl, floatRenderable: !!colorBufferFloat };
}

/** Compile a single shader stage, throwing with the info log on failure. */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Failed to create shader: ${label}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)';
    gl.deleteShader(shader);
    // Prefix each source line with its number to make the log actionable.
    const numbered = source
      .split('\n')
      .map((line, i) => `${(i + 1).toString().padStart(3)}: ${line}`)
      .join('\n');
    throw new Error(`Shader compile failed [${label}]:\n${log}\n--- source ---\n${numbered}`);
  }
  return shader;
}

/** Compile + link a vertex/fragment program, throwing on any failure. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
  label: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${label}.frag`);
  const program = gl.createProgram();
  if (!program) throw new Error(`Failed to create program: ${label}`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)';
    gl.deleteProgram(program);
    throw new Error(`Program link failed [${label}]: ${log}`);
  }
  return program;
}

/** Cache of uniform locations for a program, looked up lazily. */
export class UniformCache {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  constructor(private readonly gl: WebGL2RenderingContext, private readonly program: WebGLProgram) {}

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, l);
    }
    return l;
  }
}

/** A color texture, optionally float (HDR), suitable as an FBO attachment. */
export function createColorTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  float: boolean,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internalFormat = float ? gl.RGBA16F : gl.RGBA8;
  const type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/** An offscreen render target: one color texture (+ optional depth renderbuffer). */
export interface RenderTarget {
  fbo: WebGLFramebuffer;
  color: WebGLTexture;
  depth: WebGLRenderbuffer | null;
  width: number;
  height: number;
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  opts: { float: boolean; depth: boolean },
): RenderTarget {
  const color = createColorTexture(gl, width, height, opts.float);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);

  let depth: WebGLRenderbuffer | null = null;
  if (opts.depth) {
    depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete (0x${status.toString(16)})`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, color, depth, width, height };
}

export function destroyRenderTarget(gl: WebGL2RenderingContext, rt: RenderTarget | null): void {
  if (!rt) return;
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.color);
  if (rt.depth) gl.deleteRenderbuffer(rt.depth);
}

/**
 * Create a VAO bound to a single fullscreen-triangle position buffer.
 * Used by every screen-space pass (bloom, composite, background).
 */
export function createFullscreenTriangle(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  // A single oversized triangle covering the viewport in clip space.
  const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}
