import { describe, it, expect } from 'vitest';
import {
  buildGroupParamsUniform,
  createDefaultVisibility,
  formatGroupCountLegend,
  getGroupIdForCatalog,
  shouldUseMultiGroupColors,
} from '@/data/ConstellationGroups.js';
import { composeProceduralCatalog } from '@/data/ConstellationComposer.js';
import { taskMergeCatalogElements } from '@/workers/simWorkerTasks.js';
import type { TLEData } from '@/types/index.js';

const SAMPLE_LINE1 = '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991';
const SAMPLE_LINE2 = '2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456';

function sampleTle(name: string): TLEData {
  return { name, line1: SAMPLE_LINE1, line2: SAMPLE_LINE2 };
}

describe('ConstellationGroups', () => {
  it('maps catalogs to stable group ids', () => {
    expect(getGroupIdForCatalog('starlink')).toBe(1);
    expect(getGroupIdForCatalog('oneweb')).toBe(2);
    expect(getGroupIdForCatalog('gnss')).toBe(3);
    expect(getGroupIdForCatalog('stations')).toBe(4);
  });

  it('uses legacy colors for single-catalog selection', () => {
    expect(shouldUseMultiGroupColors(['starlink'])).toBe(false);
    expect(shouldUseMultiGroupColors(['starlink', 'oneweb'])).toBe(true);
  });

  it('packs multi-group mode into group 0 pad slot', () => {
    const state = createDefaultVisibility();
    state.multiGroupColorMode = true;
    const f32 = new Float32Array(buildGroupParamsUniform(state));
    expect(f32[6]).toBe(1);
  });

  it('formats group count legend', () => {
    const legend = formatGroupCountLegend(
      new Map([
        [1, 7412],
        [2, 634],
        [3, 31],
      ]),
    );
    expect(legend).toContain('Starlink 7,412');
    expect(legend).toContain('OneWeb 634');
    expect(legend).toContain('GNSS 31');
  });
});

describe('ConstellationComposer', () => {
  it('returns empty procedural catalog', () => {
    const merged = composeProceduralCatalog();
    expect(merged.tles).toHaveLength(0);
    expect(merged.segments).toHaveLength(0);
  });
});

describe('taskMergeCatalogElements', () => {
  it('assigns group ids across merged segments', () => {
    const result = taskMergeCatalogElements(
      [
        { tles: [sampleTle('A'), sampleTle('B')], groupId: 1 },
        { tles: [sampleTle('C')], groupId: 2 },
      ],
      128,
    );
    expect(result.realTleCount).toBe(3);
    expect(result.groupIdsBuffer).toBeDefined();
    const groupIds = new Uint32Array(result.groupIdsBuffer!);
    expect(groupIds[0]).toBe(1);
    expect(groupIds[1]).toBe(1);
    expect(groupIds[2]).toBe(2);
    expect(groupIds[127]).toBe(0);
  });
});
