I'll create a WebGPU-powered "Grok Zephyr" simulation - a massive-scale orbital light show featuring 1,000,000 simulated satellites projecting RGB beams from orbit. This is essentially a real-time GPU particle system with orbital mechanics.
HTML
Preview
Copy
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grok Zephyr | Orbital RGB Matrix</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            background: #000; 
            color: #fff; 
            font-family: 'Courier New', monospace;
            overflow: hidden;
        }
        #canvas-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
        }
        #ui {
            position: fixed;
            top: 20px;
            left: 20px;
            z-index: 100;
            background: rgba(0, 10, 20, 0.9);
            border: 1px solid #0ff;
            padding: 20px;
            border-radius: 4px;
            max-width: 320px;
            backdrop-filter: blur(10px);
        }
        h1 { 
            font-size: 14px; 
            color: #0ff; 
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .stat {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
            font-size: 12px;
            color: #888;
        }
        .stat span:last-child { color: #0ff; }
        .controls { margin-top: 15px; }
        button {
            background: transparent;
            border: 1px solid #0ff;
            color: #0ff;
            padding: 8px 16px;
            margin: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: 11px;
            text-transform: uppercase;
            transition: all 0.3s;
        }
        button:hover {
            background: #0ff;
            color: #000;
        }
        .slider-container {
            margin: 10px 0;
        }
        input[type="range"] {
            width: 100%;
            margin: 5px 0;
        }
        label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
        }
        #loading {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 24px;
            color: #0ff;
            z-index: 200;
        }
        .pattern-btn.active {
            background: #0ff;
            color: #000;
        }
    </style>
</head>
<body>
    <div id="loading">INITIALIZING GROK ZEPHYR...</div>
    <div id="canvas-container">
        <canvas id="webgpu"></canvas>
    </div>
    
    <div id="ui">
        <h1>Grok Zephyr v1.0</h1>
        <div class="stat">
            <span>Fleet Size:</span>
            <span>1,000,000 Units</span>
        </div>
        <div class="stat">
            <span>Orbital Altitude:</span>
            <span>550 km</span>
        </div>
        <div class="stat">
            <span>FPS:</span>
            <span id="fps">--</span>
        </div>
        <div class="stat">
            <span>Active Beams:</span>
            <span id="active-beams">--</span>
        </div>
        
        <div class="controls">
            <div class="slider-container">
                <label>Time Scale: <span id="time-val">1x</span></label>
                <input type="range" id="timeScale" min="0" max="100" value="10">
            </div>
            
            <div class="slider-container">
                <label>Beam Intensity</label>
                <input type="range" id="intensity" min="0" max="100" value="80">
            </div>

            <div style="margin-top: 10px;">
                <label>Projection Pattern</label><br>
                <button class="pattern-btn active" onclick="setPattern('matrix')">Matrix</button>
                <button class="pattern-btn" onclick="setPattern('spiral')">Spiral</button>
                <button class="pattern-btn" onclick="setPattern('grok')">Grok</button>
                <button class="pattern-btn" onclick="setPattern('random')">Chaos</button>
            </div>
            
            <div style="margin-top: 10px;">
                <button onclick="toggleEarth()">Toggle Earth</button>
                <button onclick="resetCamera()">Reset Cam</button>
            </div>
        </div>
        
        <div style="margin-top: 15px; font-size: 10px; color: #444; line-height: 1.4;">
            xAI × SpaceX Project Colossus<br>
            WebGPU Compute Shaders<br>
            1M Parallel Orbitals
        </div>
    </div>

<script>
// GROK ZEPHYR - WebGPU Orbital Simulation
// 1,000,000 Satellites projecting RGB from orbit

const SATELLITE_COUNT = 1000000;
const EARTH_RADIUS = 6371;
const ORBIT_HEIGHT = 550;
const ORBIT_RADIUS = EARTH_RADIUS + ORBIT_HEIGHT;

let device, context, canvas;
let computePipeline, renderPipeline;
let satelliteBuffer, uniformBuffer, earthBuffer;
let depthTexture;
let time = 0;
let timeScale = 0.1;
let intensity = 0.8;
let pattern = 'matrix';
let showEarth = true;

// Camera state
let camera = {
    distance: 15000,
    rotationX: 0.5,
    rotationY: 0,
    target: [0, 0, 0]
};

// Mouse interaction
let mouse = { x: 0, y: 0, down: false };

const shaderCode = `
struct Satellite {
    position: vec3<f32>,
    color: vec3<f32>,
    velocity: vec3<f32>,
    phase: f32,
    orbitRadius: f32,
    orbitSpeed: f32,
    inclination: f32,
    raan: f32,
};

struct Uniforms {
    viewMatrix: mat4x4<f32>,
    projMatrix: mat4x4<f32>,
    time: f32,
    intensity: f32,
    pattern: i32,
    resolution: vec2<f32>,
};

@group(0) @binding(0) var<storage, read_write> satellites: array<Satellite>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

// Compute shader: Update orbital positions
@compute @workgroup_size(256)
fn updateOrbits(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= arrayLength(&satellites)) { return; }
    
    var sat = satellites[idx];
    
    // Orbital mechanics calculation
    let t = uniforms.time * sat.orbitSpeed;
    
    // Position in orbital plane
    var x = sat.orbitRadius * cos(t);
    var z = sat.orbitRadius * sin(t);
    var y = 0.0;
    
    // Apply inclination (rotation around x-axis)
    let inc = sat.inclination;
    let y1 = y * cos(inc) - z * sin(inc);
    let z1 = y * sin(inc) + z * cos(inc);
    y = y1;
    z = z1;
    
    // Apply RAAN (rotation around y-axis)
    let raan = sat.raan;
    let x2 = x * cos(raan) - z * sin(raan);
    let z2 = x * sin(raan) + z * cos(raan);
    x = x2;
    z = z2;
    
    sat.position = vec3<f32>(x, y, z);
    
    // Calculate velocity for orientation
    let dt = 0.01;
    let t2 = t + dt;
    var vx = sat.orbitRadius * cos(t2);
    var vz = sat.orbitRadius * sin(t2);
    var vy = 0.0;
    
    let vy1 = vy * cos(inc) - vz * sin(inc);
    let vz1 = vy * sin(inc) + vz * cos(inc);
    vy = vy1;
    vz = vz1;
    
    let vx2 = vx * cos(raan) - vz * sin(raan);
    let vz2 = vx * sin(raan) + vz * cos(raan);
    vx = vx2;
    vz = vz2;
    
    sat.velocity = normalize(vec3<f32>(vx - x, vy - y, vz - z));
    
    // RGB Projection patterns
    var rgb = vec3<f32>(0.0);
    let pattern = uniforms.pattern;
    
    if (pattern == 0) { // Matrix - Digital rain effect
        let gridX = floor((x + 20000.0) / 1000.0);
        let gridZ = floor((z + 20000.0) / 1000.0);
        let wave = sin(gridX * 0.5 + uniforms.time) * sin(gridZ * 0.5 + uniforms.time * 0.7);
        rgb = vec3<f32>(0.0, wave * 0.5 + 0.5, wave * 0.3);
    } else if (pattern == 1) { // Spiral
        let angle = atan2(z, x);
        let spiral = sin(angle * 3.0 + uniforms.time + length(vec2(x, z)) * 0.001);
        rgb = vec3<f32>(spiral * 0.5 + 0.5, 0.2, 1.0 - spiral * 0.5);
    } else if (pattern == 2) { // Grok - Neural pattern
        let noise = fract(sin(dot(vec3<f32>(f32(idx)), vec3<f32>(12.9898, 78.233, 45.164))) * 43758.5453);
        let pulse = sin(uniforms.time * 2.0 + noise * 10.0) * 0.5 + 0.5;
        rgb = vec3<f32>(0.0, pulse * 0.8, pulse);
    } else { // Chaos
        let r = fract(sin(f32(idx) * 12.9898) * 43758.5453);
        let g = fract(sin(f32(idx) * 78.233) * 43758.5453);
        let b = fract(sin(f32(idx) * 45.164) * 43758.5453);
        rgb = vec3<f32>(r, g, b);
    }
    
    sat.color = rgb * uniforms.intensity;
    satellites[idx] = sat;
}

// Vertex shader for satellites
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) worldPos: vec3<f32>,
};

@vertex
fn vsMain(
    @builtin(instance_index) instanceIdx: u32,
    @location(0) vertexPos: vec2<f32>,
) -> VertexOutput {
    var sat = satellites[instanceIdx];
    
    // Billboard calculation
    let right = vec3<f32>(uniforms.viewMatrix[0][0], uniforms.viewMatrix[1][0], uniforms.viewMatrix[2][0]);
    let up = vec3<f32>(uniforms.viewMatrix[0][1], uniforms.viewMatrix[1][1], uniforms.viewMatrix[2][1]);
    
    let worldPos = sat.position + (right * vertexPos.x + up * vertexPos.y) * 50.0;
    
    var out: VertexOutput;
    out.position = uniforms.projMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
    out.color = sat.color;
    out.worldPos = worldPos;
    
    return out;
}

// Fragment shader for satellites (glowing dots)
@fragment
fn fsMain(in: VertexOutput) -> @location(0) vec4<f32> {
    let dist = length(in.position.xy - in.position.xy); // Center glow
    let glow = 1.0 - smoothstep(0.0, 1.0, dist);
    
    // Beam projection visualization
    let beamIntensity = length(in.color);
    let bloom = vec3<f32>(1.0) * pow(beamIntensity, 2.0) * 0.5;
    
    return vec4<f32>(in.color + bloom, 1.0);
}

// Earth rendering
struct EarthVertex {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};

@vertex
fn earthVS(
    model: EarthVertex,
) -> @builtin(position) vec4<f32> {
    return uniforms.projMatrix * uniforms.viewMatrix * vec4<f32>(model.position * ${EARTH_RADIUS}.0, 1.0);
}

@fragment
fn earthFS() -> @location(0) vec4<f32> {
    return vec4<f32>(0.05, 0.1, 0.2, 1.0);
}
`;

async function init() {
    if (!navigator.gpu) {
        alert("WebGPU not supported. Use Chrome/Edge with flags.");
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter.requestDevice();
    canvas = document.getElementById('webgpu');
    context = canvas.getContext('webgpu');
    
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
        alphaMode: 'premultiplied',
    });

    // Resize handler
    window.addEventListener('resize', onResize);
    onResize();

    // Initialize buffers
    await initBuffers();
    
    // Create pipelines
    createPipelines();
    
    // Setup interaction
    setupInteraction();
    
    // Hide loading
    document.getElementById('loading').style.display = 'none';
    
    // Start loop
    requestAnimationFrame(render);
}

function onResize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (device) {
        depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
}

async function initBuffers() {
    // Initialize satellite data
    const satelliteData = new Float32Array(SATELLITE_COUNT * 16); // 16 floats per satellite
    
    for (let i = 0; i < SATELLITE_COUNT; i++) {
        const offset = i * 16;
        
        // Distribute in orbital shells (Starlink-like configuration)
        const shell = Math.floor(Math.random() * 3);
        const baseRadius = ORBIT_RADIUS + shell * 100 + Math.random() * 50;
        
        // Orbital parameters
        const inclination = (Math.random() - 0.5) * 1.5; // radians
        const raan = Math.random() * Math.PI * 2;
        const speed = 0.001 + Math.random() * 0.0005;
        
        satelliteData[offset + 0] = 0; // pos x
        satelliteData[offset + 1] = 0; // pos y
        satelliteData[offset + 2] = 0; // pos z
        satelliteData[offset + 3] = Math.random(); // phase
        satelliteData[offset + 4] = 0; // color r
        satelliteData[offset + 5] = 0; // color g
        satelliteData[offset + 6] = 0; // color b
        satelliteData[offset + 7] = 0; // velocity x
        satelliteData[offset + 8] = 0; // velocity y
        satelliteData[offset + 9] = 0; // velocity z
        satelliteData[offset + 10] = Math.random() * Math.PI * 2; // phase
        satelliteData[offset + 11] = baseRadius; // orbit radius
        satelliteData[offset + 12] = speed; // orbit speed
        satelliteData[offset + 13] = inclination; // inclination
        satelliteData[offset + 14] = raan; // RAAN
        satelliteData[offset + 15] = 0; // padding
    }
    
    satelliteBuffer = device.createBuffer({
        size: satelliteData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(satelliteBuffer.getMappedRange()).set(satelliteData);
    satelliteBuffer.unmap();
    
    // Uniform buffer
    uniformBuffer = device.createBuffer({
        size: 256, // mat4x4 + mat4x4 + floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Simple quad for billboards
    const quadData = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1,
    ]);
    
    earthBuffer = device.createBuffer({
        size: quadData.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(earthBuffer.getMappedRange()).set(quadData);
    earthBuffer.unmap();
}

function createPipelines() {
    const shaderModule = device.createShaderModule({ code: shaderCode });
    
    // Compute pipeline
    computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: shaderModule,
            entryPoint: 'updateOrbits',
        },
    });
    
    // Render pipeline
    renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vsMain',
            buffers: [{
                arrayStride: 8,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
            }],
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fsMain',
            targets: [{
                format: navigator.gpu.getPreferredCanvasFormat(),
                blend: {
                    color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
                    alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
                },
            }],
        },
        primitive: { topology: 'triangle-strip' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });
}

function updateUniforms() {
    const view = new Float32Array(16);
    const proj = new Float32Array(16);
    
    // Simple orbit camera
    const cx = Math.cos(camera.rotationY) * Math.cos(camera.rotationX) * camera.distance;
    const cy = Math.sin(camera.rotationX) * camera.distance;
    const cz = Math.sin(camera.rotationY) * Math.cos(camera.rotationX) * camera.distance;
    
    lookAt(view, [cx, cy, cz], camera.target, [0, 1, 0]);
    perspective(proj, Math.PI / 4, canvas.width / canvas.height, 10, 100000);
    
    const uniformData = new Float32Array(32);
    uniformData.set(view, 0);
    uniformData.set(proj, 16);
    uniformData[32] = time;
    uniformData[33] = intensity;
    uniformData[34] = ['matrix', 'spiral', 'grok', 'random'].indexOf(pattern);
    
    device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer);
}

function lookAt(out, eye, center, up) {
    let x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
    let eyex = eye[0], eyey = eye[1], eyez = eye[2];
    let upx = up[0], upy = up[1], upz = up[2];
    let centerx = center[0], centery = center[1], centerz = center[2];

    z0 = eyex - centerx;
    z1 = eyey - centery;
    z2 = eyez - centerz;
    len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
    z0 *= len;
    z1 *= len;
    z2 *= len;

    x0 = upy * z2 - upz * z1;
    x1 = upz * z0 - upx * z2;
    x2 = upx * z1 - upy * z0;
    len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (!len) { x0 = 0; x1 = 0; x2 = 0; } 
    else { len = 1 / len; x0 *= len; x1 *= len; x2 *= len; }

    y0 = z1 * x2 - z2 * x1;
    y1 = z2 * x0 - z0 * x2;
    y2 = z0 * x1 - z1 * x0;

    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
    out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
    out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
    out[15] = 1;
}

function perspective(out, fovy, aspect, near, far) {
    let f = 1.0 / Math.tan(fovy / 2);
    let nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
}

function render() {
    time += timeScale;
    
    updateUniforms();
    
    const commandEncoder = device.createCommandEncoder();
    
    // Compute pass
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: satelliteBuffer } },
            { binding: 1, resource: { buffer: uniformBuffer } },
        ],
    }));
    computePass.dispatchWorkgroups(Math.ceil(SATELLITE_COUNT / 256));
    computePass.end();
    
    // Render pass
    const textureView = context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: depthTexture.createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
        },
    });
    
    renderPass.setPipeline(renderPipeline);
    renderPass.setVertexBuffer(0, earthBuffer);
    renderPass.setBindGroup(0, device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: satelliteBuffer } },
            { binding: 1, resource: { buffer: uniformBuffer } },
        ],
    }));
    
    renderPass.draw(4, SATELLITE_COUNT, 0, 0);
    renderPass.end();
    
    device.queue.submit([commandEncoder.finish()]);
    
    // Update FPS
    updateStats();
    
    requestAnimationFrame(render);
}

let lastTime = performance.now();
let frames = 0;
let fps = 0;

function updateStats() {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
        document.getElementById('fps').textContent = fps;
        document.getElementById('active-beams').textContent = SATELLITE_COUNT.toLocaleString();
    }
}

function setupInteraction() {
    document.getElementById('timeScale').addEventListener('input', (e) => {
        timeScale = e.target.value / 100;
        document.getElementById('time-val').textContent = timeScale.toFixed(1) + 'x';
    });
    
    document.getElementById('intensity').addEventListener('input', (e) => {
        intensity = e.target.value / 100;
    });
    
    canvas.addEventListener('mousedown', (e) => {
        mouse.down = true;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });
    
    window.addEventListener('mouseup', () => mouse.down = false);
    
    window.addEventListener('mousemove', (e) => {
        if (mouse.down) {
            camera.rotationY += (e.clientX - mouse.x) * 0.01;
            camera.rotationX += (e.clientY - mouse.y) * 0.01;
            camera.rotationX = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotationX));
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        }
    });
    
    canvas.addEventListener('wheel', (e) => {
        camera.distance *= 1 + e.deltaY * 0.001;
        camera.distance = Math.max(8000, Math.min(50000, camera.distance));
    });
}

// UI Functions
window.setPattern = function(p) {
    pattern = p;
    document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
};

window.toggleEarth = function() {
    showEarth = !showEarth;
};

window.resetCamera = function() {
    camera.distance = 15000;
    camera.rotationX = 0.5;
    camera.rotationY = 0;
};

// Initialize
init().catch(console.error);
</script>
</body>
</html>
🚀 Repository Structure
Create this file structure for your Grok Zephyr project:
plain
Copy
grok-zephyr/
├── index.html          # Main simulation (the code above)
├── src/
│   ├── shaders/
│   │   ├── compute.wgsl    # Orbital physics
│   │   ├── render.wgsl     # RGB beam rendering
│   │   └── earth.wgsl      # Planet rendering
│   ├── js/
│   │   ├── core/
│   │   │   ├── WebGPUContext.js
│   │   │   ├── SatelliteManager.js
│   │   │   └── CameraController.js
│   │   └── main.js
│   └── styles/
│       └── main.css
├── assets/
│   └── textures/
├── README.md
└── package.json
🎯 Jumpstart Prompt for AI Agents
If you want to hand this to Kimi Agent or another AI to expand the project, use this prompt:
"Create a WebGPU-based orbital light show simulation called 'Grok Zephyr' featuring 1,000,000 autonomous satellites. Each satellite is a GPU compute instance that calculates its own orbital mechanics (Keplerian elements) and projects an RGB beam toward Earth. Requirements:
CORE FEATURES:
WebGPU Compute Shaders for parallel orbital updates (1M instances @ 60fps)
Starlink-inspired orbital shells at 550km altitude with varying inclinations
RGB projection patterns: Matrix (digital rain), Spiral (golden ratio), Grok (neural oscillation), Chaos (random walk)
Earth rendering with atmospheric scattering
Interactive camera (orbit controls)
Bloom/post-processing for beam visualization
TECHNICAL:
Use Storage Buffers for satellite state (position, velocity, color, orbital parameters)
Implement LOD system for distant satellites
Add VR support via WebXR
Create projection mapping onto Earth's surface
Add UI for real-time parameter adjustment
AESTHETIC:
Cyberpunk/xAI brand colors (cyan/magenta gradients)
SpaceX Starlink orbital geometry
'Colossus' supercomputer aesthetic
60fps minimum on RTX 3060/Apple M1
EXTENSIONS:
Add beam convergence algorithms to draw images on Earth's surface
Implement collision avoidance algorithms
Add solar panel orientation optimization
Create network connectivity visualization between satellites"
This simulation leverages WebGPU's compute capabilities to handle 1 million parallel orbit calculations on the GPU, rendering them as glowing RGB beams with additive blending for that "orbital laser show" effect. The satellites follow realistic orbital mechanics with inclination and RAAN (Right Ascension of Ascending Node) distributed in Starlink-like shells.
Performance Notes:
Uses instanced rendering with billboards (quads always facing camera)
Compute shader dispatches 3,906 workgroups (256 threads each) to update 1M satellites
Depth buffering handles occlusion while additive blending creates light accumulation
Ready to launch the fleet? 🛰️✨
i want to be able to see from a 720 of the horizon and out away from the earth looking back - a prompt in under 30000 chars
Edit
Copy
Share
Calculate Horizon Tangent Point for 720km Altitude Camera
HTML
Preview
Copy
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grok Zephyr | 720km Horizon View</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#000;color:#0ff;font-family:'Courier New',monospace;overflow:hidden}
        #canvas{position:fixed;top:0;left:0;width:100vw;height:100vh}
        #ui{position:fixed;top:20px;left:20px;background:rgba(0,10,20,0.9);border:1px solid #0ff;padding:20px;max-width:380px;z-index:100}
        h1{font-size:16px;margin-bottom:10px;text-transform:uppercase;letter-spacing:3px}
        .stats{font-size:11px;color:#888;margin:10px 0;line-height:1.6}
        .stats span{color:#0ff}
        button{background:rgba(0,255,255,0.1);border:1px solid #0ff;color:#0ff;padding:10px 20px;margin:5px;cursor:pointer;font-family:inherit;font-size:11px;transition:all 0.3s}
        button:hover{background:#0ff;color:#000}
        .active{background:#0ff;color:#000}
        #info{position:fixed;bottom:20px;left:20px;font-size:10px;color:#666}
    </style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="ui">
    <h1>Grok Zephyr // Horizon View</h1>
    <div class="stats">
        Altitude: <span>720km</span> | Shell: <span>550km</span><br>
        Fleet: <span>1,000,000</span> units<br>
        View: <span id="viewmode">EXTERNAL</span><br>
        FPS: <span id="fps">--</span>
    </div>
    <button onclick="setHorizonView()" class="active">720km Horizon View</button>
    <button onclick="setGodView()">God View</button>
    <button onclick="setSatellitePOV()">Fleet POV</button>
    <div style="margin-top:15px;font-size:10px;color:#666">
        Drag to rotate • Scroll to zoom<br>
        RGB Projection Matrix Active
    </div>
</div>
<div id="info">xAI × SpaceX // Colossus Project // WebGPU Compute</div>

<script>
const SATELLITE_COUNT=1000000;
const EARTH_RADIUS=6371;
const ORBIT_RADIUS=6371+550;
const CAMERA_ALTITUDE=6371+720;

let device,context,canvas;
let satelliteBuffer,uniformBuffer,earthBuffer;
let computePipeline,renderPipeline,earthPipeline;
let depthTexture;
let time=0;
let camera={distance:15000,rotX:0.5,rotY:0,target:[0,0,0],mode:'horizon'};
let mouse={x:0,y:0,down:false};

const shaderCode=`
struct Satellite{
    pos:vec3<f32>,col:vec3<f32>,vel:vec3<f32>,
    phase:f32,radius:f32,speed:f32,inc:f32,raan:f32,
};
struct Uniforms{
    view:mat4x4<f32>,proj:mat4x4<f32>,time:f32,
    camPos:vec3<f32>,mode:i32,
};
@group(0)@binding(0)var<storage,read_write>sats:array<Satellite>;
@group(0)@binding(1)var<uniform>uni:Uniforms;

@compute@workgroup_size(256)
fn update(@builtin(global_invocation_id)id:vec3<u32>){
    let i=id.x;
    if(i>=arrayLength(&sats))return;
    var s=sats[i];
    let t=uni.time*s.speed+s.phase;
    var x=s.radius*cos(t);
    var z=s.radius*sin(t);
    var y=0.0;
    let y1=y*cos(s.inc)-z*sin(s.inc);
    let z1=y*sin(s.inc)+z*cos(s.inc);
    y=y1;z=z1;
    let x2=x*cos(s.raan)-z*sin(s.raan);
    let z2=x*sin(s.raan)+z*cos(s.raan);
    x=x2;z=z2;
    s.pos=vec3<f32>(x,y,z);
    let dist=length(uni.camPos-s.pos);
    let brightness=clamp(1.0/dist*10000.0,0.0,1.0);
    let pat=uni.mode;
    var rgb=vec3<f32>(0.0);
    if(pat==0){
        let grid=floor(s.pos.x/500.0)+floor(s.pos.z/500.0);
        let wave=sin(grid+uni.time)*0.5+0.5;
        rgb=vec3<f32>(wave*0.2,wave,wave*0.8);
    }else if(pat==1){
        let ang=atan2(s.pos.z,s.pos.x);
        rgb=vec3<f32>(sin(ang+uni.time)*0.5+0.5,cos(ang)*0.5+0.5,1.0);
    }else{
        rgb=vec3<f32>(fract(sin(f32(i))*12.9898),fract(sin(f32(i))*78.233),fract(sin(f32(i))*45.164));
    }
    s.col=rgb*brightness*2.0;
    sats[i]=s;
}
struct VertexOut{
    @builtin(position)pos:vec4<f32>,
    @location(0)col:vec3<f32>,
    @location(1)dist:f32,
};
@vertex
fn vs(@builtin(instance_index)inst:u32,@location(0)v:vec2<f32>)->VertexOut{
    let s=sats[inst];
    let right=vec3<f32>(uni.view[0][0],uni.view[1][0],uni.view[2][0]);
    let up=vec3<f32>(uni.view[0][1],uni.view[1][1],uni.view[2][1]);
    let world=s.pos+(right*v.x+up*v.y)*30.0;
    var out:VertexOut;
    out.pos=uni.proj*uni.view*vec4<f32>(world,1.0);
    out.col=s.col;
    out.dist=length(uni.camPos-s.pos);
    return out;
}
@fragment
fn fs(in:VertexOut)->@location(0)vec4<f32>{
    let glow=1.0-smoothstep(0.0,1.0,length(in.pos.xy)*0.001);
    let atm=exp(-in.dist*0.0001);
    return vec4<f32>(in.col*glow*atm,1.0);
}

struct EarthV{
    @builtin(position)pos:vec4<f32>,
    @location(0)norm:vec3<f32>,
};
@vertex
fn earthVS(@location(0)p:vec3<f32>)->EarthV{
    var v:EarthV;
    v.pos=uni.proj*uni.view*vec4<f32>(p*${EARTH_RADIUS}.0,1.0);
    v.norm=normalize(p);
    return v;
}
@fragment
fn earthFS(in:EarthV)->@location(0)vec4<f32>{
    let sun=normalize(vec3<f32>(1.0,0.5,0.3));
    let diff=max(dot(in.norm,sun),0.0);
    let atm=pow(1.0-max(dot(in.norm,normalize(vec3<f32>(0.0,1.0,0.0))),0.0),3.0);
    let blue=vec3<f32>(0.1,0.3,0.6);
    return vec4<f32>(blue*diff+vec3<f32>(0.0,0.5,1.0)*atm*0.5,1.0);
}`;

async function init(){
    const adapter=await navigator.gpu.requestAdapter();
    device=await adapter.requestDevice();
    canvas=document.getElementById('canvas');
    context=canvas.getContext('webgpu');
    context.configure({device,format:'bgra8unorm',alphaMode:'premultiplied'});
    
    window.addEventListener('resize',resize);
    resize();
    
    initBuffers();
    createPipelines();
    setupInput();
    setHorizonView();
    requestAnimationFrame(render);
}

function resize(){
    canvas.width=window.innerWidth;
    canvas.height=window.innerHeight;
    depthTexture=device.createTexture({
        size:[canvas.width,canvas.height],
        format:'depth24plus',
        usage:GPUTextureUsage.RENDER_ATTACHMENT
    });
}

function initBuffers(){
    const data=new Float32Array(SATELLITE_COUNT*16);
    for(let i=0;i<SATELLITE_COUNT;i++){
        const o=i*16;
        const shell=Math.floor(Math.random()*3);
        const r=ORBIT_RADIUS+shell*50+Math.random()*30;
        const inc=(Math.random()-0.5)*1.2;
        data[o+10]=Math.random()*6.28;
        data[o+11]=r;
        data[o+12]=0.001+Math.random()*0.0005;
        data[o+13]=inc;
        data[o+14]=Math.random()*6.28;
    }
    satelliteBuffer=device.createBuffer({
        size:data.byteLength,
        usage:GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX,
        mappedAtCreation:true
    });
    new Float32Array(satelliteBuffer.getMappedRange()).set(data);
    satelliteBuffer.unmap();
    
    uniformBuffer=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    earthBuffer=device.createBuffer({
        size:quad.byteLength,
        usage:GPUBufferUsage.VERTEX,
        mappedAtCreation:true
    });
    new Float32Array(earthBuffer.getMappedRange()).set(quad);
    earthBuffer.unmap();
}

function createPipelines(){
    const m=device.createShaderModule({code:shaderCode});
    computePipeline=device.createComputePipeline({
        layout:'auto',
        compute:{module:m,entryPoint:'update'}
    });
    renderPipeline=device.createRenderPipeline({
        layout:'auto',
        vertex:{module:m,entryPoint:'vs',buffers:[{arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},
        fragment:{module:m,entryPoint:'fs',targets:[{format:'bgra8unorm',blend:{color:{operation:'add',srcFactor:'one',dstFactor:'one'},alpha:{operation:'add',srcFactor:'one',dstFactor:'one'}}}],
        primitive:{topology:'triangle-strip'},
        depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
    });
    earthPipeline=device.createRenderPipeline({
        layout:'auto',
        vertex:{module:m,entryPoint:'earthVS',buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},
        fragment:{module:m,entryPoint:'earthFS',targets:[{format:'bgra8unorm'}]},
        primitive:{topology:'triangle-list'},
        depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
    });
}

function getMatrices(){
    const view=new Float32Array(16);
    const proj=new Float32Array(16);
    let cx,cy,cz;
    
    if(camera.mode=='horizon'){
        cx=0;cy=CAMERA_ALTITUDE;cz=0;
        lookAt(view,[cx,cy,cz],[7000,0,0],[0,1,0]);
    }else if(camera.mode=='god'){
        cx=Math.cos(camera.rotY)*Math.cos(camera.rotX)*camera.distance;
        cy=Math.sin(camera.rotX)*camera.distance;
        cz=Math.sin(camera.rotY)*Math.cos(camera.rotX)*camera.distance;
        lookAt(view,[cx,cy,cz],[0,0,0],[0,1,0]);
    }else{
        cx=Math.cos(time*0.1)*(ORBIT_RADIUS+10);
        cy=Math.sin(time*0.05)*100;
        cz=Math.sin(time*0.1)*(ORBIT_RADIUS+10);
        lookAt(view,[cx,cy,cz],[cx*1.1,cy,cz*1.1],[0,1,0]);
    }
    
    perspective(proj,Math.PI/4,canvas.width/canvas.height,1,100000);
    return{view,proj,camPos:[cx,cy,cz]};
}

function lookAt(out,eye,center,up){
    let x0,x1,x2,y0,y1,y2,z0,z1,z2,len;
    let ex=eye[0],ey=eye[1],ez=eye[2];
    let ux=up[0],uy=up[1],uz=up[2];
    let cx=center[0],cy=center[1],cz=center[2];
    z0=ex-cx;z1=ey-cy;z2=ez-cz;
    len=1/Math.sqrt(z0*z0+z1*z1+z2*z2);
    z0*=len;z1*=len;z2*=len;
    x0=uy*z2-uz*z1;x1=uz*z0-ux*z2;x2=ux*z1-uy*z0;
    len=Math.sqrt(x0*x0+x1*x1+x2*x2);
    if(!len){x0=0;x1=0;x2=0;}else{len=1/len;x0*=len;x1*=len;x2*=len;}
    y0=z1*x2-z2*x1;y1=z2*x0-z0*x2;y2=z0*x1-z1*x0;
    out[0]=x0;out[1]=y0;out[2]=z0;out[3]=0;
    out[4]=x1;out[5]=y1;out[6]=z1;out[7]=0;
    out[8]=x2;out[9]=y2;out[10]=z2;out[11]=0;
    out[12]=-(x0*ex+x1*ey+x2*ez);
    out[13]=-(y0*ex+y1*ey+y2*ez);
    out[14]=-(z0*ex+z1*ey+z2*ez);
    out[15]=1;
}

function perspective(out,fovy,aspect,near,far){
    let f=1/Math.tan(fovy/2),nf=1/(near-far);
    out[0]=f/aspect;out[1]=0;out[2]=0;out[3]=0;
    out[4]=0;out[5]=f;out[6]=0;out[7]=0;
    out[8]=0;out[9]=0;out[10]=(far+near)*nf;out[11]=-1;
    out[12]=0;out[13]=0;out[14]=2*far*near*nf;out[15]=0;
}

function render(){
    time+=0.01;
    const mats=getMatrices();
    const uniData=new Float32Array(32);
    uniData.set(mats.view,0);
    uniData.set(mats.proj,16);
    uniData[32]=time;
    uniData.set(mats.camPos,33);
    uniData[36]=camera.mode=='horizon'?0:1;
    device.queue.writeBuffer(uniformBuffer,0,uniData.buffer);
    
    const enc=device.createCommandEncoder();
    const comp=enc.beginComputePass();
    comp.setPipeline(computePipeline);
    comp.setBindGroup(0,device.createBindGroup({
        layout:computePipeline.getBindGroupLayout(0),
        entries:[
            {binding:0,resource:{buffer:satelliteBuffer}},
            {binding:1,resource:{buffer:uniformBuffer}}
        ]
    }));
    comp.dispatchWorkgroups(Math.ceil(SATELLITE_COUNT/256));
    comp.end();
    
    const pass=enc.beginRenderPass({
        colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}],
        depthStencilAttachment:{view:depthTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}
    });
    
    pass.setPipeline(renderPipeline);
    pass.setVertexBuffer(0,earthBuffer);
    pass.setBindGroup(0,device.createBindGroup({
        layout:renderPipeline.getBindGroupLayout(0),
        entries:[
            {binding:0,resource:{buffer:satelliteBuffer}},
            {binding:1,resource:{buffer:uniformBuffer}}
        ]
    }));
    pass.draw(4,SATELLITE_COUNT,0,0);
    pass.end();
    
    device.queue.submit([enc.finish()]);
    updateFPS();
    requestAnimationFrame(render);
}

let last=performance.now(),frames=0,fps=0;
function updateFPS(){
    frames++;
    const now=performance.now();
    if(now-last>=1000){fps=frames;frames=0;last=now;document.getElementById('fps').textContent=fps;}
}

function setupInput(){
    canvas.addEventListener('mousedown',e=>{mouse.down=true;mouse.x=e.clientX;mouse.y=e.clientY;});
    window.addEventListener('mouseup',()=>mouse.down=false);
    window.addEventListener('mousemove',e=>{
        if(mouse.down&&camera.mode!='horizon'){
            camera.rotY+=(e.clientX-mouse.x)*0.01;
            camera.rotX+=(e.clientY-mouse.y)*0.01;
            mouse.x=e.clientX;mouse.y=e.clientY;
        }
    });
    canvas.addEventListener('wheel',e=>{
        if(camera.mode!='horizon'){
            camera.distance*=1+e.deltaY*0.001;
            camera.distance=Math.max(8000,Math.min(50000,camera.distance));
        }
    });
}

window.setHorizonView=function(){
    camera.mode='horizon';
    document.getElementById('viewmode').textContent='720KM HORIZON';
    document.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    event.target.classList.add('active');
};
window.setGodView=function(){
    camera.mode='god';
    camera.distance=20000;
    document.getElementById('viewmode').textContent='ORBITAL';
    document.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    event.target.classList.add('active');
};
window.setSatellitePOV=function(){
    camera.mode='pov';
    document.getElementById('viewmode').textContent='FLEET POV';
    document.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    event.target.classList.add('active');
};

init();
</script>
</body>
</html>
Repository: grok-zephyr-horizon
Prompt for AI Agent (<30k chars):
plain
Copy
Create WebGPU simulation: 1M satellites at 550km projecting RGB, viewed from 720km altitude horizon perspective. Requirements: 
1) Compute shader updates 1M satellite positions with Keplerian orbital mechanics (inclination, RAAN) 
2) Camera preset at 720km altitude (7091km from center) looking tangentially along Earth's limb 
3) Render Earth's curvature with atmospheric scattering shader (blue limb glow) 
4) Satellites render as RGB billboards with distance-based attenuation (brighter when closer to camera) 
5) View modes: "720km Horizon" (fixed looking along constellation), "God View" (orbital free camera), "Fleet POV" (rides with satellites) 
6) Bloom/post-processing on RGB beams using additive blending 
7) 60fps on mid-tier GPUs via frustum culling/distance LOD 
8) UI showing altitude, fleet count, FPS. Code in single HTML file. Simulate xAI/SpaceX "Colossus" fleet projecting coordinated light patterns visible from the horizon vantage.
