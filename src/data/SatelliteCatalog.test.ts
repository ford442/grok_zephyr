import { describe, expect, it } from 'vitest';
import { SatelliteCatalog } from './SatelliteCatalog.js';
import { TLELoader } from './TLELoader.js';

const LINE1 = '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991';
const LINE2 = '2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456';

describe('SatelliteCatalog', () => {
  it('indexes TLE names and supports NORAD search', () => {
    const catalog = new SatelliteCatalog();
    const orbital = new Float32Array(16);
    orbital[3] = (1 << 8) | 2;
    const groupIds = new Uint32Array([1, 0, 0, 0]);
    catalog.rebuild([{ name: 'STARLINK-1007', line1: LINE1, line2: LINE2 }], 1, orbital, groupIds);

    const id = catalog.getIdentity(0);
    expect(id?.kind).toBe('tle');
    expect(id?.name).toBe('STARLINK-1007');
    expect(id?.groupId).toBe(1);
    expect(id?.groupLabel).toBe('Starlink');
    expect(id?.noradId).toBe(TLELoader.parseNoradId(LINE1));

    expect(catalog.search('starlink')).toEqual([0]);
    expect(catalog.search('44713')).toEqual([0]);
  });

  it('labels procedural slots beyond the TLE count', () => {
    const catalog = new SatelliteCatalog();
    const orbital = new Float32Array(32);
    orbital[3] = 0;
    orbital[7] = 256;
    catalog.rebuild([], 0, orbital);

    const proc = catalog.getIdentity(1);
    expect(proc?.kind).toBe('procedural');
    expect(proc?.plane).toBe(0);
    expect(proc?.slot).toBe(1);
  });
});
