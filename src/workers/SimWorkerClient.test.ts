import { describe, it, expect } from 'vitest';
import {
  taskDeriveElementsFromTle,
  taskGenerateElements,
  taskParseTle,
} from '@/workers/simWorkerTasks.js';

const SAMPLE_NAME = 'STARLINK-1007';
const SAMPLE_LINE1 = '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991';
const SAMPLE_LINE2 = '2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456';

function makeTLE(name = SAMPLE_NAME): string {
  return `${name}\n${SAMPLE_LINE1}\n${SAMPLE_LINE2}\n`;
}

describe('simWorkerTasks', () => {
  it('parses TLE text', () => {
    const tles = taskParseTle(makeTLE());
    expect(tles).toHaveLength(1);
    expect(tles[0].name).toBe(SAMPLE_NAME);
  });

  it('generates detached orbital buffers', () => {
    const result = taskGenerateElements(4096, 42);
    expect(result.orbitalBuffer.byteLength).toBe(4096 * 16);
    expect(result.realTleCount).toBe(0);
    expect(new Float32Array(result.orbitalBuffer).length).toBe(4096 * 4);
  });

  it('derives orbital elements from TLE with padding', () => {
    const tles = taskParseTle(makeTLE());
    const result = taskDeriveElementsFromTle(tles, 8192);
    expect(result.realTleCount).toBe(1);
    expect(result.orbitalBuffer.byteLength).toBe(8192 * 16);
  });
});

describe('SimWorkerClient main-thread fallback', () => {
  it('runs tasks without a Worker in Vitest', async () => {
    const { SimWorkerClient } = await import('@/workers/SimWorkerClient.js');
    const client = new SimWorkerClient();
    const tles = await client.parseTLE(makeTLE());
    expect(tles).toHaveLength(1);

    const generated = await client.generateOrbitalElements(1024, 7);
    expect(generated.orbitalBuffer.byteLength).toBe(1024 * 16);

    const derived = await client.deriveOrbitalElementsFromTLE(tles, 2048);
    expect(derived.realTleCount).toBe(1);
    client.terminate();
  });
});

describe('OrbitalElements.adoptBuffer', () => {
  it('replaces backing store from a transferred buffer', async () => {
    const { OrbitalElements } = await import('@/core/OrbitalElements.js');
    const { taskGenerateElements } = await import('@/workers/simWorkerTasks.js');

    const orb = new OrbitalElements(512);
    const before = orb.calculatePosition(0, 0);
    const { orbitalBuffer } = taskGenerateElements(512, 99);
    orb.adoptBuffer(orbitalBuffer);
    const after = orb.calculatePosition(0, 0);
    expect(after).not.toEqual(before);
  });
});
