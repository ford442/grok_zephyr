import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/**
 * Custom plugin to handle WGSL shader imports
 * Allows importing .wgsl files as strings
 */
function wgslPlugin() {
  return {
    name: 'vite-plugin-wgsl',
    enforce: 'pre' as const,
    
    resolveId(id: string) {
      if (id.endsWith('.wgsl')) {
        return resolve(process.cwd(), id);
      }
      return null;
    },
    
    load(id: string) {
      if (id.endsWith('.wgsl')) {
        const content = readFileSync(id, 'utf-8');
        // Process imports
        const processed = content.replace(
          /#import\s+["']([^"']+)["']/g,
          (_match, importPath: string) => {
            const fullPath = resolve(id, '..', importPath);
            try {
              return readFileSync(fullPath, 'utf-8');
            } catch {
              console.warn(`[WGSL] Could not import: ${importPath}`);
              return '';
            }
          }
        );
        
        return {
          code: `export default ${JSON.stringify(processed)};`,
          map: null,
        };
      }
      return null;
    },
  };
}

/**
 * Plugin to generate standalone HTML build
 */
function standalonePlugin() {
  return {
    name: 'vite-plugin-standalone',
    enforce: 'post' as const,
    apply: 'build' as const,
    
    generateBundle(_options: unknown, bundle: Record<string, { code?: string; source?: string }>) {
      // Only run in standalone mode
      if (process.env.VITE_STANDALONE !== 'true') return;
      
      // Find main entry
      const htmlEntry = Object.keys(bundle).find(k => k.endsWith('.html'));
      const jsEntry = Object.keys(bundle).find(k => k.endsWith('.js') && !k.includes('polyfill'));
      const cssEntry = Object.keys(bundle).find(k => k.endsWith('.css'));
      
      if (!htmlEntry || !jsEntry) return;
      
      const jsCode = bundle[jsEntry].code || '';
      const cssCode = cssEntry ? (bundle[cssEntry].source as string || '') : '';
      
      // Create standalone HTML
      const standaloneHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grok Zephyr - WebGPU Orbital Simulation</title>
  <style>${cssCode}</style>
</head>
<body>
  <canvas id="gpu-canvas"></canvas>
  
  <div id="ui">
    <div class="title">◈ GROK ZEPHYR</div>
    <div class="stat" id="s-alt">Altitude : 720 km</div>
    <div class="stat" id="s-fleet">Fleet    : 1,048,576</div>
    <div class="stat" id="s-fps">FPS      : --</div>
    <div class="stat" id="s-view">View     : 720km Horizon</div>
    <div class="stat" id="s-visible">Visible  : --</div>
  </div>
  
  <div id="controls">
    <button class="vbtn active" id="btn0">720km HORIZON</button>
    <button class="vbtn" id="btn1">GOD VIEW</button>
    <button class="vbtn" id="btn2">FLEET POV</button>
  </div>
  
  <div id="horizon-indicator">
    <div>Earth Radius: 6,371 km</div>
    <div>Orbit Altitude: 550 km</div>
    <div>Camera Altitude: 720 km</div>
    <div>Horizon Distance: ~2,970 km</div>
  </div>
  
  <div id="error"></div>
  
  <script type="module">${jsCode}</script>
</body>
</html>`;
      
      // Add standalone HTML to bundle
      this.emitFile({
        type: 'asset',
        fileName: 'grok-zephyr.standalone.html',
        source: standaloneHtml,
      });
      
      console.log('[standalone] Generated grok-zephyr.standalone.html');
    },
  };
}

export default defineConfig(({ mode }) => {
  const isStandalone = mode === 'standalone';
  
  return {
    root: '.',
    publicDir: 'public',
    
    build: {
      outDir: 'dist',
      sourcemap: !isStandalone,
      minify: !isStandalone,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
        output: {
          manualChunks: isStandalone ? undefined : {
            'webgpu-core': ['./src/core/WebGPUContext.ts', './src/core/SatelliteGPUBuffer.ts'],
            'render': ['./src/render/RenderPipeline.ts'],
            'math': ['./src/utils/math.ts'],
          },
        },
      },
    },
    
    server: {
      host: true,
      port: 5173,
      open: true,
    },
    
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@/shaders': resolve(__dirname, 'src/shaders'),
        '@/core': resolve(__dirname, 'src/core'),
        '@/physics': resolve(__dirname, 'src/physics'),
        '@/render': resolve(__dirname, 'src/render'),
        '@/camera': resolve(__dirname, 'src/camera'),
        '@/matrix': resolve(__dirname, 'src/matrix'),
        '@/ui': resolve(__dirname, 'src/ui'),
        '@/utils': resolve(__dirname, 'src/utils'),
        '@/types': resolve(__dirname, 'src/types'),
      },
    },
    
    plugins: [
      wgslPlugin(),
      standalonePlugin(),
    ],
  };
});