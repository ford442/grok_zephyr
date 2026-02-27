var v=Object.defineProperty;var m=(u,e,t)=>e in u?v(u,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):u[e]=t;var a=(u,e,t)=>m(u,typeof e!="symbol"?e+"":e,t);import{R as s,C as h}from"./webgpu-core-DtLl7bce.js";const c=`
struct Uni {
  view_proj      : mat4x4f,
  camera_pos     : vec4f,
  camera_right   : vec4f,
  camera_up      : vec4f,
  time           : f32,
  delta_time     : f32,
  view_mode      : u32,
  pad0           : u32,
  frustum        : array<vec4f,6>,
  screen_size    : vec2f,
  pad1           : vec2f,
};
@group(0) @binding(0) var<uniform> uni : Uni;
`,b=c+`
@group(0) @binding(1) var<storage,read>       orb_elem : array<vec4f>;
@group(0) @binding(2) var<storage,read_write> sat_pos  : array<vec4f>;

const ORBIT_KM    : f32 = 6921.0;
const MEAN_MOTION : f32 = 0.001097;

@compute @workgroup_size(64,1,1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= 1048576u) { return; }

  let e    = orb_elem[i];
  let raan = e.x;
  let inc  = e.y;
  let m0   = e.z;
  let cdat = e.w;

  let M  = m0 + MEAN_MOTION * uni.time;
  let cM = cos(M); let sM = sin(M);
  let cR = cos(raan); let sR = sin(raan);
  let cI = cos(inc);  let sI = sin(inc);

  let x = ORBIT_KM * (cR*cM - sR*sM*cI);
  let y = ORBIT_KM * (sR*cM + cR*sM*cI);
  let z = ORBIT_KM * sM * sI;

  sat_pos[i] = vec4f(x, y, z, cdat);
}
`,g=c+`
struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f };

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;
  o.pos = vec4f(pts[vi],0,1);
  o.uv  = pts[vi]*0.5 + 0.5;
  return o;
}

fn hash2(p:vec2f)->f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  let cell  = floor(in.uv * 512.0);
  let h     = hash2(cell);
  let h2    = hash2(cell + vec2f(1.0,0.0));
  let h3    = hash2(cell + vec2f(0.0,1.0));
  let star  = f32(h > 0.994) * pow(h2,6.0);
  let color = mix(vec3f(0.6,0.8,1.0), vec3f(1.0,0.9,0.7), h3);
  return vec4f(color * star * 1.5, 1.0);
}
`,y=c+`
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  o.cp = uni.view_proj * vec4f(v.pos,1);
  o.wp = v.pos;
  o.n  = v.nrm;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let sun_dir = normalize(vec3f(1.0,0.4,0.2));
  let diff    = max(dot(N,sun_dir),0.0);

  let lat = asin(clamp(N.z,-1.0,1.0));
  let lon = atan2(N.y,N.x);
  let f1  = sin(lat*4.0+0.5)*cos(lon*3.0+1.2);
  let f2  = cos(lat*6.0)*sin(lon*5.0+0.8);
  let land = smoothstep(0.15,0.35, f1*0.6+f2*0.4);

  let ocean = vec3f(0.04,0.10,0.30);
  let soil  = vec3f(0.15,0.22,0.06);
  let ice   = vec3f(0.7,0.75,0.8);
  let pole  = smoothstep(1.1,1.4, abs(lat));
  var surf  = mix(mix(ocean,soil,land), ice, pole);

  let ambient   = 0.04;
  let lit       = surf * (diff*0.92 + ambient);

  let night = smoothstep(0.08,-0.08,dot(N,sun_dir));
  let city  = night * 0.025 * vec3f(1.0,0.85,0.4)
              * smoothstep(0.4,0.6,land)
              * (0.5+0.5*sin(lon*18.0+lat*14.0));

  return vec4f(lit+city,1.0);
}
`,T=c+`
struct VIn  { @location(0) pos:vec3f, @location(1) nrm:vec3f }
struct VOut { @builtin(position) cp:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f }

const ATM_SCALE : f32 = 6471.0/6371.0;

@vertex fn vs(v:VIn) -> VOut {
  var o:VOut;
  let p  = v.pos * ATM_SCALE;
  o.cp   = uni.view_proj * vec4f(p,1);
  o.wp   = p;
  o.n    = v.nrm;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let N       = normalize(in.n);
  let V       = normalize(uni.camera_pos.xyz - in.wp);
  let rim     = 1.0 - abs(dot(N,V));
  let limb    = pow(rim,3.5);
  let limb2   = pow(rim,7.0);

  let blue    = vec3f(0.08,0.38,1.0)*limb*2.8;
  let teal    = vec3f(0.0,0.7,0.45)*limb2*0.6;
  let alpha   = limb*0.85;
  return vec4f(blue+teal, alpha);
}
`,x=c+`
@group(0) @binding(1) var<storage,read> sat_pos : array<vec4f>;

struct VOut {
  @builtin(position) cp : vec4f,
  @location(0) uv       : vec2f,
  @location(1) color    : vec3f,
  @location(2) bright   : f32,
}

fn sat_color(idx:u32) -> vec3f {
  let c = idx % 7u;
  if(c==0u){return vec3f(1.0,0.18,0.18);}
  if(c==1u){return vec3f(0.18,1.0,0.18);}
  if(c==2u){return vec3f(0.25,0.45,1.0);}
  if(c==3u){return vec3f(1.0,1.0,0.1);}
  if(c==4u){return vec3f(0.1,1.0,1.0);}
  if(c==5u){return vec3f(1.0,0.1,1.0);}
  return vec3f(1.0,1.0,1.0);
}

@vertex fn vs(
  @builtin(vertex_index)   vi : u32,
  @builtin(instance_index) ii : u32,
) -> VOut {
  let pd      = sat_pos[ii];
  let wp      = pd.xyz;
  let cdat    = pd.w;
  let cam     = uni.camera_pos.xyz;
  let dist    = length(wp - cam);

  var visible = true;
  if (dist > 14000.0) { visible = false; }
  if (visible) {
    for (var p=0u; p<6u; p++) {
      let pl = uni.frustum[p];
      if (dot(pl.xyz, wp) + pl.w < -200.0) { visible=false; break; }
    }
  }

  var o : VOut;
  if (!visible) {
    o.cp     = vec4f(10,10,10,1);
    o.uv     = vec2f(0);
    o.color  = vec3f(0);
    o.bright = 0.0;
    return o;
  }

  let bsize = clamp(1200.0/max(dist,50.0), 0.4, 60.0);

  const quad = array<vec2f,6>(
    vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),
    vec2f(-1, 1),vec2f(1,-1),vec2f( 1,1));

  let qv     = quad[vi];
  let right  = uni.camera_right.xyz;
  let up     = uni.camera_up.xyz;
  let offset = (qv.x*right + qv.y*up) * bsize;
  let fpos   = wp + offset;

  let cidx    = u32(abs(cdat)) % 7u;
  let col     = sat_color(cidx);
  let phase   = cdat*0.15 + uni.time*(0.8+0.4*fract(f32(ii)*0.000613));
  let pattern = 0.35 + 0.65*(0.5 + 0.5*sin(phase));

  let atten   = 1.0/(1.0 + dist*0.00075);
  let bright  = pattern * atten;

  o.cp     = uni.view_proj * vec4f(fpos,1);
  o.uv     = (qv + 1.0)*0.5;
  o.color  = col;
  o.bright = bright;
  return o;
}

@fragment fn fs(in:VOut) -> @location(0) vec4f {
  let d     = length(in.uv - 0.5)*2.0;
  if (d > 1.0) { discard; }
  let ring  = 1.0 - smoothstep(0.55,1.0,d);
  let core  = 1.0 - smoothstep(0.0,0.22,d);
  let alpha = ring * in.bright;
  let hdr   = in.color * (ring + core*2.2) * in.bright * 2.8;
  return vec4f(hdr, alpha);
}
`,S=`
@group(0) @binding(0) var tex : texture_2d<f32>;
@group(0) @binding(1) var smp : sampler;

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut; o.pos=vec4f(pts[vi],0,1); o.uv=pts[vi]*0.5+0.5; return o;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var uv = in.uv; uv.y = 1.0-uv.y;
  let c   = textureSample(tex,smp,uv).rgb;
  let lum = dot(c,vec3f(0.2126,0.7152,0.0722));
  let t   = smoothstep(0.75,1.4,lum);
  return vec4f(c*t,1.0);
}
`,G=`
struct BlurUni { texel:vec2f, horizontal:u32, pad:u32 }
@group(0) @binding(0) var<uniform> buni : BlurUni;
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut; o.pos=vec4f(pts[vi],0,1); o.uv=pts[vi]*0.5+0.5; return o;
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var uv = in.uv; uv.y = 1.0-uv.y;
  let d  = select(vec2f(0,buni.texel.y), vec2f(buni.texel.x,0), buni.horizontal != 0u);
  const W = array<f32,5>(0.2270,0.1945,0.1216,0.0540,0.0162);
  var c   = textureSample(tex,smp,uv).rgb * W[0];
  for (var i=1; i<5; i++) {
    let off = f32(i)*d;
    c += textureSample(tex,smp,uv+off).rgb * W[i];
    c += textureSample(tex,smp,uv-off).rgb * W[i];
  }
  return vec4f(c,1.0);
}
`,R=`
@group(0) @binding(0) var scene_tex : texture_2d<f32>;
@group(0) @binding(1) var bloom_tex : texture_2d<f32>;
@group(0) @binding(2) var smp       : sampler;

struct VSOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f }

@vertex fn vs(@builtin(vertex_index) vi:u32) -> VSOut {
  const pts = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut; o.pos=vec4f(pts[vi],0,1); o.uv=pts[vi]*0.5+0.5; return o;
}

fn aces(x:vec3f)->vec3f {
  let a=2.51; let b=0.03; let c=2.43; let d=0.59; let e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3f(0),vec3f(1));
}

@fragment fn fs(in:VSOut) -> @location(0) vec4f {
  var uv = in.uv; uv.y = 1.0-uv.y;
  let scene = textureSample(scene_tex,smp,uv).rgb;
  let bloom = textureSample(bloom_tex,smp,uv).rgb;
  let hdr   = scene + bloom*1.8;
  return vec4f(aces(hdr),1.0);
}
`,n={orbital:b,stars:g,earth:y,atmosphere:T,satellites:x,bloomThreshold:S,bloomBlur:G,composite:R};class O{constructor(e,t){a(this,"context");a(this,"buffers");a(this,"linearSampler");a(this,"pipelines",null);a(this,"bindGroups",null);a(this,"renderTargets",null);a(this,"width",0);a(this,"height",0);this.context=e,this.buffers=t,this.linearSampler=e.createLinearSampler()}initialize(e,t){this.width=e,this.height=t,console.log(`[RenderPipeline] Initializing ${e}x${t}`),this.createPipelines(),this.createRenderTargets(e,t),this.createBindGroups(),console.log("[RenderPipeline] Initialization complete")}createPipelines(){const e=this.context.getDevice(),t=e.createPipelineLayout({bindGroupLayouts:[e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]})]}),i=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),o=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}}]}),r=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}]}),l=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}]}),p=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}]}),d={arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"}]},f={color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}};this.pipelines={compute:e.createComputePipeline({layout:t,compute:{module:this.context.createShaderModule(n.orbital,"orbital"),entryPoint:"main"}}),stars:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[i]}),vertex:{module:this.context.createShaderModule(n.stars,"stars"),entryPoint:"vs"},fragment:{module:this.context.createShaderModule(n.stars,"stars"),entryPoint:"fs",targets:[{format:s.HDR_FORMAT}]},primitive:{topology:"triangle-list"},depthStencil:{format:s.DEPTH_FORMAT,depthWriteEnabled:!1,depthCompare:"always"}}),earth:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[i]}),vertex:{module:this.context.createShaderModule(n.earth,"earth"),entryPoint:"vs",buffers:[d]},fragment:{module:this.context.createShaderModule(n.earth,"earth"),entryPoint:"fs",targets:[{format:s.HDR_FORMAT}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:s.DEPTH_FORMAT,depthWriteEnabled:!0,depthCompare:"less"}}),atmosphere:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[i]}),vertex:{module:this.context.createShaderModule(n.atmosphere,"atmosphere"),entryPoint:"vs",buffers:[d]},fragment:{module:this.context.createShaderModule(n.atmosphere,"atmosphere"),entryPoint:"fs",targets:[{format:s.HDR_FORMAT,blend:f}]},primitive:{topology:"triangle-list",cullMode:"front"},depthStencil:{format:s.DEPTH_FORMAT,depthWriteEnabled:!1,depthCompare:"less"}}),satellites:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[o]}),vertex:{module:this.context.createShaderModule(n.satellites,"satellites"),entryPoint:"vs"},fragment:{module:this.context.createShaderModule(n.satellites,"satellites"),entryPoint:"fs",targets:[{format:s.HDR_FORMAT,blend:f}]},primitive:{topology:"triangle-list"},depthStencil:{format:s.DEPTH_FORMAT,depthWriteEnabled:!1,depthCompare:"less"}}),bloomThreshold:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[l]}),vertex:{module:this.context.createShaderModule(n.bloomThreshold,"bloom-threshold"),entryPoint:"vs"},fragment:{module:this.context.createShaderModule(n.bloomThreshold,"bloom-threshold"),entryPoint:"fs",targets:[{format:s.HDR_FORMAT}]},primitive:{topology:"triangle-list"}}),bloomBlur:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[r]}),vertex:{module:this.context.createShaderModule(n.bloomBlur,"bloom-blur"),entryPoint:"vs"},fragment:{module:this.context.createShaderModule(n.bloomBlur,"bloom-blur"),entryPoint:"fs",targets:[{format:s.HDR_FORMAT}]},primitive:{topology:"triangle-list"}}),composite:e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[p]}),vertex:{module:this.context.createShaderModule(n.composite,"composite"),entryPoint:"vs"},fragment:{module:this.context.createShaderModule(n.composite,"composite"),entryPoint:"fs",targets:[{format:this.context.getFormat()}]},primitive:{topology:"triangle-list"}})}}createRenderTargets(e,t){const i=(d,f)=>this.context.getDevice().createTexture({size:[e,t],format:d,usage:f|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),o=i(s.HDR_FORMAT,GPUTextureUsage.TEXTURE_BINDING),r=this.context.getDevice().createTexture({size:[e,t],format:s.DEPTH_FORMAT,usage:GPUTextureUsage.RENDER_ATTACHMENT}),l=i(s.HDR_FORMAT,GPUTextureUsage.TEXTURE_BINDING),p=i(s.HDR_FORMAT,GPUTextureUsage.TEXTURE_BINDING);this.renderTargets={hdr:o,depth:r,bloomA:l,bloomB:p,hdrView:o.createView(),depthView:r.createView(),bloomAView:l.createView(),bloomBView:p.createView()}}createBindGroups(){if(!this.pipelines||!this.renderTargets)return;const e=this.context.getDevice(),t=this.buffers.positions instanceof GPUBuffer?this.buffers.positions:this.buffers.positions.read;this.bindGroups={compute:e.createBindGroup({layout:this.pipelines.compute.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.uniforms}},{binding:1,resource:{buffer:this.buffers.orbitalElements}},{binding:2,resource:{buffer:t}}]}),stars:e.createBindGroup({layout:this.pipelines.stars.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.uniforms}}]}),earth:e.createBindGroup({layout:this.pipelines.earth.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.uniforms}}]}),atmosphere:e.createBindGroup({layout:this.pipelines.atmosphere.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.uniforms}}]}),satellites:e.createBindGroup({layout:this.pipelines.satellites.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.uniforms}},{binding:1,resource:{buffer:t}}]}),bloomThreshold:e.createBindGroup({layout:this.pipelines.bloomThreshold.getBindGroupLayout(0),entries:[{binding:0,resource:this.renderTargets.hdrView},{binding:1,resource:this.linearSampler}]}),bloomHorizontal:e.createBindGroup({layout:this.pipelines.bloomBlur.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.bloomUniforms.horizontal}},{binding:1,resource:this.renderTargets.bloomAView},{binding:2,resource:this.linearSampler}]}),bloomVertical:e.createBindGroup({layout:this.pipelines.bloomBlur.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.buffers.bloomUniforms.vertical}},{binding:1,resource:this.renderTargets.bloomBView},{binding:2,resource:this.linearSampler}]}),composite:e.createBindGroup({layout:this.pipelines.composite.getBindGroupLayout(0),entries:[{binding:0,resource:this.renderTargets.hdrView},{binding:1,resource:this.renderTargets.bloomAView},{binding:2,resource:this.linearSampler}]})}}resize(e,t){var i,o,r,l;e===this.width&&t===this.height||(this.width=e,this.height=t,(i=this.renderTargets)==null||i.hdr.destroy(),(o=this.renderTargets)==null||o.depth.destroy(),(r=this.renderTargets)==null||r.bloomA.destroy(),(l=this.renderTargets)==null||l.bloomB.destroy(),this.createRenderTargets(e,t),this.createBindGroups())}encodeComputePass(e){if(!this.pipelines||!this.bindGroups)return;const t=e.beginComputePass();t.setPipeline(this.pipelines.compute),t.setBindGroup(0,this.bindGroups.compute),t.dispatchWorkgroups(Math.ceil(h.NUM_SATELLITES/s.WORKGROUP_SIZE)),t.end()}encodeScenePass(e,t,i,o){if(!this.pipelines||!this.bindGroups||!this.renderTargets)return;const r=e.beginRenderPass({colorAttachments:[{view:this.renderTargets.hdrView,clearValue:{r:0,g:0,b:.02,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:this.renderTargets.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});r.setPipeline(this.pipelines.stars),r.setBindGroup(0,this.bindGroups.stars),r.draw(3),r.setPipeline(this.pipelines.earth),r.setBindGroup(0,this.bindGroups.earth),r.setVertexBuffer(0,t),r.setIndexBuffer(i,"uint32"),r.drawIndexed(o),r.setPipeline(this.pipelines.atmosphere),r.setBindGroup(0,this.bindGroups.atmosphere),r.setVertexBuffer(0,t),r.setIndexBuffer(i,"uint32"),r.drawIndexed(o),r.setPipeline(this.pipelines.satellites),r.setBindGroup(0,this.bindGroups.satellites),r.draw(6,h.NUM_SATELLITES),r.end()}encodeBloomPasses(e){if(!this.pipelines||!this.bindGroups||!this.renderTargets)return;const t=e.beginRenderPass({colorAttachments:[{view:this.renderTargets.bloomAView,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});t.setPipeline(this.pipelines.bloomThreshold),t.setBindGroup(0,this.bindGroups.bloomThreshold),t.draw(3),t.end();const i=e.beginRenderPass({colorAttachments:[{view:this.renderTargets.bloomBView,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});i.setPipeline(this.pipelines.bloomBlur),i.setBindGroup(0,this.bindGroups.bloomHorizontal),i.draw(3),i.end();const o=e.beginRenderPass({colorAttachments:[{view:this.renderTargets.bloomAView,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});o.setPipeline(this.pipelines.bloomBlur),o.setBindGroup(0,this.bindGroups.bloomVertical),o.draw(3),o.end()}encodeCompositePass(e,t){if(!this.pipelines||!this.bindGroups)return;const i=e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});i.setPipeline(this.pipelines.composite),i.setBindGroup(0,this.bindGroups.composite),i.draw(3),i.end()}getRenderTargets(){return this.renderTargets}destroy(){var e,t,i,o;(e=this.renderTargets)==null||e.hdr.destroy(),(t=this.renderTargets)==null||t.depth.destroy(),(i=this.renderTargets)==null||i.bloomA.destroy(),(o=this.renderTargets)==null||o.bloomB.destroy(),this.renderTargets=null,this.pipelines=null,this.bindGroups=null}}export{O as R};
//# sourceMappingURL=render-CegNyfM9.js.map
