import { CONSTANTS } from '@/types/constants.js';
import type { TLEData } from '@/types/index.js';
import { OrbitalElements, type MergedCatalogSegment } from '@/core/OrbitalElements.js';
import { EXTENDED_FLOATS_PER_SATELLITE } from '@/physics/index.js';
import { getSimWorkerClient } from '@/workers/SimWorkerClient.js';
import {
  buildGroupParamsUniform,
  createDefaultVisibility,
  type GroupVisibilityState,
} from '@/data/ConstellationGroups.js';

/** CPU orbital / extended / group arrays plus worker-backed generate/load. */
export class OrbitalDataStore {
  readonly orbital: OrbitalElements;
  readonly extendedElementData: Float32Array;
  readonly groupIdData: Uint32Array;
  groupVisibility: GroupVisibilityState = createDefaultVisibility();
  loadedTles: TLEData[] = [];
  readonly numSatellites: number;

  constructor(numSatellites: number = CONSTANTS.NUM_SATELLITES) {
    this.numSatellites = numSatellites;
    this.orbital = new OrbitalElements(numSatellites);
    this.extendedElementData = new Float32Array(numSatellites * EXTENDED_FLOATS_PER_SATELLITE);
    this.groupIdData = new Uint32Array(numSatellites);
  }

  get orbitalElementData(): Float32Array {
    return this.orbital.data;
  }

  adoptGroupIds(buffer: ArrayBuffer): void {
    const expectedBytes = this.numSatellites * 4;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(
        `Group ID buffer size mismatch: expected ${expectedBytes} bytes, got ${buffer.byteLength}`,
      );
    }
    this.groupIdData.set(new Uint32Array(buffer));
  }

  async generateViaWorker(): Promise<void> {
    const result = await getSimWorkerClient().generateOrbitalElements(this.numSatellites);
    this.orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      this.adoptGroupIds(result.groupIdsBuffer);
    }
    this.loadedTles = [];
  }

  async loadTleViaWorker(tles: TLEData[]): Promise<number> {
    this.loadedTles = tles;
    const result = await getSimWorkerClient().deriveOrbitalElementsFromTLE(tles, this.numSatellites);
    this.orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      this.adoptGroupIds(result.groupIdsBuffer);
    }
    return result.realTleCount;
  }

  async loadMergedViaWorker(
    tles: TLEData[],
    segments: MergedCatalogSegment[],
    groupIdsBuffer: ArrayBuffer,
  ): Promise<number> {
    this.loadedTles = tles;
    const result = await getSimWorkerClient().mergeCatalogElements(segments, this.numSatellites);
    this.orbital.adoptBuffer(result.orbitalBuffer);
    if (result.groupIdsBuffer) {
      this.adoptGroupIds(result.groupIdsBuffer);
    } else {
      this.adoptGroupIds(groupIdsBuffer);
    }
    return result.realTleCount;
  }

  setGroupVisibilityState(state: GroupVisibilityState): void {
    this.groupVisibility = state;
  }

  setGroupVisibility(groupId: number, visible: boolean): void {
    if (groupId < 0 || groupId >= this.groupVisibility.visible.length) return;
    this.groupVisibility.visible[groupId] = visible;
  }

  packedGroupParams(): ArrayBuffer {
    return buildGroupParamsUniform(this.groupVisibility);
  }
}
