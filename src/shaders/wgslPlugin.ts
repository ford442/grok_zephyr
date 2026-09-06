/**
 * Vite plugin: import `.wgsl` as a string with `#import` preprocessing.
 * Virtual includes `uniforms.wgsl` / `uni_struct.wgsl` / `bloom_composite.wgsl`
 * are generated from the TypeScript uniform schemas.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { Plugin } from 'vite';
import { emitWgslStruct } from './uniformSchema.js';
import { SCENE_UNI_SCHEMA } from './schemas/sceneUni.js';
import { BLOOM_COMPOSITE_UNI_SCHEMA } from './schemas/bloom.js';

const IMPORT_RE = /^[ \t]*#import\s+"([^"]+)"[ \t]*$/gm;

function generatedInclude(spec: string): string | null {
  if (spec === 'uniforms.wgsl') {
    return emitWgslStruct(SCENE_UNI_SCHEMA);
  }
  if (spec === 'uni_struct.wgsl') {
    return emitWgslStruct({ ...SCENE_UNI_SCHEMA, binding: undefined });
  }
  if (spec === 'bloom_composite.wgsl') {
    return emitWgslStruct(BLOOM_COMPOSITE_UNI_SCHEMA);
  }
  return null;
}

export function preprocessWgsl(source: string, fromFile: string, stack: string[] = []): string {
  if (stack.includes(fromFile)) {
    throw new Error(`WGSL import cycle: ${[...stack, fromFile].join(' -> ')}`);
  }
  const nextStack = [...stack, fromFile];
  return source.replace(IMPORT_RE, (_m, spec: string) => {
    const generated = generatedInclude(spec);
    if (generated !== null) {
      return generated.trimEnd();
    }
    const resolved = isAbsolute(spec) ? spec : join(dirname(fromFile), spec);
    const imported = readFileSync(resolved, 'utf8');
    return preprocessWgsl(imported, resolved, nextStack).trimEnd();
  });
}

export function wgslPlugin(): Plugin {
  return {
    name: 'vite-plugin-wgsl',
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.wgsl')) {
        return null;
      }
      const processed = preprocessWgsl(code, file);
      return {
        code: `export default ${JSON.stringify(processed)};\n`,
        map: null,
      };
    },
  };
}
