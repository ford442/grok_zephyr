/**
 * Grok Zephyr - Satellite GPU Buffer Manager (façade)
 *
 * Public API for createGpuResources / FrameLoop. Implementation:
 *   buffer/BufferAllocator.ts  — GPU allocation + Pascal budget
 *   buffer/BufferUpload.ts     — staging / bloom / extended-range writes
 *   buffer/catalogLifecycle.ts — Walker / TLE generate-load
 *   buffer/growthMask.ts       — packed launch-day mask
 *   buffer/cpuPropagation.ts   — CPU position query
 *   orbital/                    — CPU arrays + SGP4 re-anchor
 */

import type { WebGPUContext } from './WebGPUContext.js';
import { getActiveFleetSize } from '@/core/FleetScale.js';
import type { TLEData } from '@/types/index.js';
import type { OrbitalElements, MergedCatalogSegment } from './OrbitalElements.js';
import { PHYSICS_MODE, readKeplerianExtended } from '@/physics/index.js';
import type { TlePropagator } from '@/physics/index.js';
import type { GroupVisibilityState } from '@/data/ConstellationGroups.js';
import {
  allocateSatelliteBuffers,
  assertBufferBudget,
  calculateSatelliteBufferBudget,
  destroySatelliteBuffers,
  logBufferBudget,
  memoryUsageBytes,
} from './buffer/BufferAllocator.js';
import {
  StagingBuffer,
  uploadDynamicSatelliteData,
  writeBloomUniforms,
  writeExtendedRange,
} from './buffer/BufferUpload.js';
import {
  isBufferPair,
  type SatelliteBufferConfig,
  type SatelliteBufferSet,
  type SatelliteFrameBuffers,
} from './buffer/bufferTypes.js';
import {
  generateCatalogElements,
  loadMergedCatalog,
  loadTleCatalog,
} from './buffer/catalogLifecycle.js';
import { calculateCpuSatellitePosition } from './buffer/cpuPropagation.js';
import { isSatActiveOnDay, packActiveFromDays, writeGrowthEraUniform } from './buffer/growthMask.js';
import { OrbitalDataStore } from './orbital/OrbitalDataStore.js';
import { Sgp4ReanchorService } from './orbital/Sgp4ReanchorService.js';

export type {
  BufferPair,
  SatelliteBufferConfig,
  SatelliteBufferSet,
  SatelliteFrameBuffers,
} from './buffer/bufferTypes.js';
export { MAX_BEAMS, isBufferPair } from './buffer/bufferTypes.js';
export { StagingBuffer } from './buffer/BufferUpload.js';

export class SatelliteGPUBuffer implements SatelliteFrameBuffers {
  private context: WebGPUContext;
  private config: SatelliteBufferConfig;
  private buffers: SatelliteBufferSet | null = null;
  private staging: StagingBuffer | null = null;
  private readonly store: OrbitalDataStore;
  private readonly sgp4: Sgp4ReanchorService;
  private physicsMode: number = PHYSICS_MODE.SIMPLE;
  private activeFromDays: Uint32Array = new Uint32Array(0);
  private growthEnabled = false;
  private growthEraDay = 0xffffffff;
  private readonly sizes: {
    numSatellites: number;
    position: number;
    elements: number;
    extended: number;
  };

  constructor(context: WebGPUContext, config: Partial<SatelliteBufferConfig> = {}) {
    this.context = context;
    this.config = {
      doubleBuffer: false,
      enableReadback: false,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      ...config,
    };
    const numSatellites = getActiveFleetSize();
    this.sizes = {
      numSatellites,
      position: numSatellites * 16,
      elements: numSatellites * 16,
      extended: numSatellites * 32,
    };
    this.store = new OrbitalDataStore(numSatellites);
    this.sgp4 = new Sgp4ReanchorService(this.store);
  }

  private catalogHost() {
    return { store: this.store, sgp4: this.sgp4, numSatellites: this.sizes.numSatellites };
  }

  initialize(): SatelliteBufferSet {
    const { numSatellites: numSats } = this.sizes;
    const { total, breakdown } = calculateSatelliteBufferBudget(numSats);
    console.log(
      `[SatelliteGPUBuffer] Initializing buffers for ${numSats.toLocaleString()} satellites`,
    );
    console.log(
      `[SatelliteGPUBuffer] Total storage requested: ${(total / 1024 / 1024).toFixed(2)} MB`,
    );
    logBufferBudget(numSats, total, breakdown);
    assertBufferBudget(total);

    this.sgp4.rebuild(0);
    this.buffers = allocateSatelliteBuffers(this.context, this.config, this.sizes);
    this.context.writeBuffer(this.buffers.groupIds, this.store.groupIdData);
    this.context.writeBuffer(this.buffers.groupParams, this.store.packedGroupParams());
    this.uploadExtendedElements();

    this.staging = new StagingBuffer(
      this.context.getDevice(),
      Math.max(this.sizes.position, numSats * 16),
    );
    return this.buffers;
  }

  async uploadDynamicData(
    data: {
      position?: ArrayBufferLike;
      pattern?: ArrayBufferLike;
      color?: ArrayBufferLike;
    },
    commandEncoder: GPUCommandEncoder,
  ): Promise<void> {
    if (!this.staging || !this.buffers) {
      throw new Error('Buffers not initialized');
    }
    await uploadDynamicSatelliteData(this.staging, this.buffers, data, commandEncoder);
  }

  async generateOrbitalElements(): Promise<Float32Array> {
    return generateCatalogElements(this.catalogHost());
  }

  async loadFromMergedCatalog(
    tles: TLEData[],
    segments: MergedCatalogSegment[],
    groupIdsBuffer: ArrayBuffer,
    anchorSimTime?: number,
  ): Promise<number> {
    return loadMergedCatalog(this.catalogHost(), tles, segments, groupIdsBuffer, anchorSimTime);
  }

  async loadFromTLEData(tles: TLEData[]): Promise<number> {
    return loadTleCatalog(this.catalogHost(), tles);
  }

  async loadFromTLEDataWithSgp4(tles: TLEData[], anchorSimTime: number): Promise<number> {
    const count = await this.loadFromTLEData(tles);
    this.sgp4.simEpochMs = Date.now();
    this.sgp4.enableRealism(anchorSimTime);
    return count;
  }

  setRealismEnabled(enabled: boolean, simTime: number): void {
    this.sgp4.setRealismEnabled(enabled, simTime);
    this.uploadExtendedElements();
  }

  isRealismEnabled(): boolean {
    return this.sgp4.realismEnabled;
  }

  hasTleCatalog(): boolean {
    return this.sgp4.tleRealCount > 0;
  }

  getTleRealCount(): number {
    return this.sgp4.tleRealCount;
  }

  getTlePropagator(): TlePropagator | null {
    return this.sgp4.propagator as TlePropagator | null;
  }

  getLoadedTles(): readonly TLEData[] {
    return this.store.loadedTles;
  }

  tickSgp4Reanchor(simTime: number): void {
    if (!this.buffers) return;
    const plan = this.sgp4.planChunk(simTime);
    if (!plan) return;
    void this.sgp4.runChunkAsync(plan).then((range) => {
      if (!range || !this.buffers) return;
      writeExtendedRange(
        this.context.getDevice(),
        this.buffers.extendedElements,
        this.store.extendedElementData,
        range.start,
        range.end,
        this.sgp4.floatsPerSat,
      );
    });
  }

  getLastReanchorMainMs(): number {
    return this.sgp4.lastReanchorMainMs;
  }

  getSgp4Status(index: number): { error: number | null; epochJd: number } {
    const ext = readKeplerianExtended(this.store.extendedElementData, index);
    const error = ext.realismFlag < 0 ? Math.round(-ext.realismFlag) : null;
    const prop = this.sgp4.propagator as { catalogEpochJd?: (i: number) => number } | null;
    return { error, epochJd: prop?.catalogEpochJd?.(index) ?? 0 };
  }

  forceSgp4Reanchor(simTime: number): void {
    if (!this.sgp4.force(simTime)) return;
    this.uploadExtendedElements();
  }

  uploadExtendedElements(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    const data = this.store.extendedElementData;
    this.context.getDevice().queue.writeBuffer(
      this.buffers.extendedElements,
      0,
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
  }

  uploadOrbitalElements(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    this.context.writeBuffer(this.buffers.orbitalElements, this.store.orbitalElementData);
    this.uploadExtendedElements();
    this.uploadGroupIds();
  }

  adoptGroupIds(buffer: ArrayBuffer): void {
    this.store.adoptGroupIds(buffer);
  }

  uploadGroupIds(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    this.context.writeBuffer(this.buffers.groupIds, this.store.groupIdData);
  }

  getGroupIdData(): Uint32Array {
    return this.store.groupIdData;
  }

  setGroupVisibilityState(state: GroupVisibilityState): void {
    this.store.setGroupVisibilityState(state);
    this.uploadGroupParams();
  }

  getGroupVisibilityState(): GroupVisibilityState {
    return this.store.groupVisibility;
  }

  setGroupVisibility(groupId: number, visible: boolean): void {
    this.store.setGroupVisibility(groupId, visible);
    this.uploadGroupParams();
  }

  uploadGroupParams(): void {
    if (!this.buffers) throw new Error('Buffers not initialized');
    this.context.writeBuffer(this.buffers.groupParams, this.store.packedGroupParams());
  }

  updateBloomUniforms(width: number, height: number): void {
    if (!this.buffers) return;
    writeBloomUniforms(this.context, this.buffers, width, height);
  }

  getPositionBufferForRender(): GPUBuffer {
    if (!this.buffers) throw new Error('Buffers not initialized');
    if (isBufferPair(this.buffers.positions)) {
      return this.buffers.positions.current === 'read'
        ? this.buffers.positions.read
        : this.buffers.positions.write;
    }
    return this.buffers.positions;
  }

  getPositionBufferForCompute(): GPUBuffer {
    if (!this.buffers) throw new Error('Buffers not initialized');
    if (isBufferPair(this.buffers.positions)) {
      return this.buffers.positions.current === 'read'
        ? this.buffers.positions.write
        : this.buffers.positions.read;
    }
    return this.buffers.positions;
  }

  swapBuffers(): void {
    if (!this.buffers || !isBufferPair(this.buffers.positions)) return;
    this.buffers.positions.current = this.buffers.positions.current === 'read' ? 'write' : 'read';
  }

  getBuffers(): SatelliteBufferSet {
    if (!this.buffers) throw new Error('Buffers not initialized');
    return this.buffers;
  }

  getOrbitalElementData(): Float32Array {
    return this.store.orbitalElementData;
  }

  getOrbitalElements(): OrbitalElements {
    return this.store.orbital;
  }

  setPhysicsMode(mode: number): void {
    this.physicsMode = mode;
  }

  getPhysicsMode(): number {
    return this.physicsMode;
  }

  setActiveFromDays(days: Uint32Array): void {
    this.activeFromDays = new Uint32Array(days);
    if (!this.buffers) return;
    this.context.writeBuffer(
      this.buffers.activeFrom,
      packActiveFromDays(days, this.sizes.numSatellites),
    );
  }

  getActiveFromDays(): Uint32Array {
    return this.activeFromDays;
  }

  setGrowthEra(enabled: boolean, eraDay: number): void {
    this.growthEnabled = enabled;
    this.growthEraDay = eraDay;
    if (!this.buffers) return;
    writeGrowthEraUniform(this.context, this.buffers.growthParams, enabled, eraDay);
  }

  isSatActive(index: number): boolean {
    return isSatActiveOnDay(this.growthEnabled, this.activeFromDays, index, this.growthEraDay);
  }

  calculateSatellitePosition(index: number, time: number): [number, number, number] {
    return calculateCpuSatellitePosition(index, time, {
      inactive: !this.isSatActive(index),
      extendedElementData: this.store.extendedElementData,
      realismEnabled: this.sgp4.realismEnabled,
      physicsMode: this.physicsMode,
      orbital: this.store.orbital,
    });
  }

  calculateSatelliteVelocity(index: number, time: number): [number, number, number] {
    return this.store.orbital.calculateVelocity(index, time);
  }

  async readbackPositions(): Promise<Float32Array | null> {
    if (!this.buffers || !this.config.enableReadback) return null;
    const device = this.context.getDevice();
    const positionBuffer = this.getPositionBufferForRender();
    const stagingBuffer = device.createBuffer({
      size: this.sizes.position,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(positionBuffer, 0, stagingBuffer, 0, this.sizes.position);
    device.queue.submit([encoder.finish()]);
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();
    return data;
  }

  getMemoryUsage(): number {
    return memoryUsageBytes(this.sizes, this.config, this.buffers !== null);
  }

  destroy(): void {
    if (this.buffers) {
      destroySatelliteBuffers(this.buffers);
      this.buffers = null;
    }
    this.staging = null;
  }
}
