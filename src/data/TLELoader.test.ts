import { afterEach, describe, expect, it, vi } from 'vitest';
import { TLELoader } from './TLELoader.js';

const SAMPLE_NAME = 'STARLINK-1007';
const SAMPLE_LINE1 = '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991';
const SAMPLE_LINE2 = '2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456';

function makeTLE(name = SAMPLE_NAME, line1 = SAMPLE_LINE1, line2 = SAMPLE_LINE2): string {
  return `${name}\n${line1}\n${line2}\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TLELoader.parse', () => {
  it('parses a valid 3-line TLE set', () => {
    const parsed = TLELoader.parse(makeTLE());
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      name: SAMPLE_NAME,
      line1: SAMPLE_LINE1,
      line2: SAMPLE_LINE2,
    });
  });

  it('parses multiple sets and skips comments/blank lines', () => {
    const text = `# header\n\n${makeTLE('SAT-A', SAMPLE_LINE1, SAMPLE_LINE2)}\n# comment\n${makeTLE('SAT-B', SAMPLE_LINE1, SAMPLE_LINE2)}`;
    const parsed = TLELoader.parse(text);
    expect(parsed.map((t) => t.name)).toEqual(['SAT-A', 'SAT-B']);
  });

  it('trims leading and trailing whitespace on each line', () => {
    const parsed = TLELoader.parse(`  ${SAMPLE_NAME}  \n  ${SAMPLE_LINE1} \n  ${SAMPLE_LINE2}  `);
    expect(parsed[0].name).toBe(SAMPLE_NAME);
    expect(parsed[0].line1).toBe(SAMPLE_LINE1);
    expect(parsed[0].line2).toBe(SAMPLE_LINE2);
  });

  it('ignores malformed records with missing line2', () => {
    const parsed = TLELoader.parse(`${SAMPLE_NAME}\n${SAMPLE_LINE1}\nBROKEN\n`);
    expect(parsed).toHaveLength(0);
  });

  it('ignores orphan line1/line2 without satellite name', () => {
    const parsed = TLELoader.parse(`${SAMPLE_LINE1}\n${SAMPLE_LINE2}\n`);
    expect(parsed).toHaveLength(0);
  });

  it('returns empty list for empty input', () => {
    expect(TLELoader.parse('')).toEqual([]);
    expect(TLELoader.parse('\n\n')).toEqual([]);
  });

  it('returns empty list for comment-only input', () => {
    expect(TLELoader.parse('# one\n# two\n')).toEqual([]);
  });
});

describe('TLELoader line2 utilities', () => {
  it('extracts orbital values from line2', () => {
    const parsed = TLELoader.parseLine2(SAMPLE_LINE2);
    expect(parsed).not.toBeNull();
    expect(parsed?.inclinationDeg).toBeCloseTo(53.0, 6);
    expect(parsed?.raanDeg).toBeCloseTo(85.0, 6);
    expect(parsed?.eccentricity).toBeCloseTo(0.0001, 8);
    expect(parsed?.meanAnomalyDeg).toBeCloseTo(310.0, 6);
    expect(parsed?.meanMotionRevPerDay).toBeCloseTo(15.06397611, 6);
  });

  it('derives expected LEO altitude from mean motion', () => {
    const altitude = TLELoader.deriveAltitudeKmFromMeanMotion(15.06397611);
    expect(altitude).toBeGreaterThan(540);
    expect(altitude).toBeLessThan(570);
  });

  it('returns null for malformed line2 input', () => {
    expect(TLELoader.parseLine2('2 BAD')).toBeNull();
    expect(TLELoader.parseLine2('not a tle line')).toBeNull();
  });
});

describe('TLELoader network loaders', () => {
  it('fromFile fetches and parses TLE text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => makeTLE(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const parsed = await TLELoader.fromFile('https://example.com/tle.txt');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/tle.txt');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe(SAMPLE_NAME);
  });

  it('fromFile throws on non-ok HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      })
    );

    await expect(TLELoader.fromFile('https://example.com/missing.tle')).rejects.toThrow('Failed to fetch TLE data');
  });

  it('fromCelesTrak builds CelesTrak URL and delegates to fromFile', async () => {
    const spy = vi.spyOn(TLELoader, 'fromFile').mockResolvedValue([]);
    await TLELoader.fromCelesTrak('starlink');
    expect(spy).toHaveBeenCalledWith(
      'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle'
    );
  });
});

