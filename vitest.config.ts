import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
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

