#!/usr/bin/env node
/**
 * Grok Zephyr - Standalone HTML Build Script
 * 
 * Builds a self-contained HTML file with all assets inlined.
 * 
 * Usage: npx tsx scripts/build-standalone.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const SRC_DIR = resolve(process.cwd(), 'dist');
const OUT_FILE = resolve(SRC_DIR, 'grok-zephyr.standalone.html');

/**
 * Build standalone HTML
 */
function buildStandalone(): void {
  console.log('[build-standalone] Starting...');
  
  if (!existsSync(SRC_DIR)) {
    console.error('[build-standalone] dist/ directory not found. Run `npm run build` first.');
    process.exit(1);
  }
  
  const assetsDir = resolve(SRC_DIR, 'assets');
  
  if (!existsSync(assetsDir)) {
    console.error('[build-standalone] dist/assets/ directory not found.');
    process.exit(1);
  }
  
  // Find JS and CSS files
  const files = readdirSync(assetsDir);
  const jsFiles = files.filter(f => f.endsWith('.js') && !f.includes('polyfill'));
  const cssFiles = files.filter(f => f.endsWith('.css'));
  
  if (jsFiles.length === 0) {
    console.error('[build-standalone] No JS files found in dist/assets/');
    process.exit(1);
  }
  
  console.log(`[build-standalone] Found ${jsFiles.length} JS file(s), ${cssFiles.length} CSS file(s)`);
  
  // Read files
  const jsCode = readFileSync(resolve(assetsDir, jsFiles[0]), 'utf-8');
  const cssCode = cssFiles.length > 0 
    ? readFileSync(resolve(assetsDir, cssFiles[0]), 'utf-8')
    : '';
  
  // Create standalone HTML
  const standaloneHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grok Zephyr - WebGPU Orbital Simulation</title>
  <style>
${cssCode}
  </style>
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
  
  <script type="module">
${jsCode}
  </script>
</body>
</html>`;
  
  // Write output
  writeFileSync(OUT_FILE, standaloneHtml);
  
  const sizeKB = (standaloneHtml.length / 1024).toFixed(2);
  console.log(`[build-standalone] ✓ Created grok-zephyr.standalone.html (${sizeKB} KB)`);
  console.log(`[build-standalone] Output: ${OUT_FILE}`);
}

// Run
buildStandalone();
