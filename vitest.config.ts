import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/** WGSL imports as strings (mirrors vite.config.ts) */
function wgslPlugin() {
  return {
    name: 'vite-plugin-wgsl',
    enforce: 'pre' as const,
    resolveId(id: string, importer?: string) {
      if (!id.endsWith('.wgsl')) {
        return null;
      }
      if (id.startsWith('.') && importer) {
        return resolve(importer, '..', id);
      }
      return resolve(process.cwd(), id);
    },
    load(id: string) {
      if (id.endsWith('.wgsl')) {
        const content = readFileSync(id, 'utf-8');
        const processed = content.replace(
          /#import\s+["']([^"']+)["']/g,
          (_match, importPath: string) => {
            const fullPath = resolve(id, '..', importPath);
            try {
              return readFileSync(fullPath, 'utf-8');
            } catch {
              return '';
            }
          },
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

export default defineConfig({
  plugins: [wgslPlugin()],
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
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});

