import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireTLECatalog,
  formatDataAge,
  formatEpochAge,
  parseTLEEpoch,
  resetTLESessionCacheForTests,
  TLE_CACHE_MAX_AGE_MS,
} from './TLESource.js';

const SAMPLE_LINE1 = '1 44713U 19074A   24356.50000000  .00001256  00000-0  11371-3 0  9991';
const SAMPLE_TLE = `STARLINK-1007\n${SAMPLE_LINE1}\n2 44713  53.0000  85.0000 0001000  50.0000 310.0000 15.06397611123456\n`;

function mockFetchSequence(responses: Array<{ ok?: boolean; text?: string; status?: number }>): void {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        statusText: 'OK',
        text: () => Promise.resolve(response.text ?? ''),
      });
    }),
  );
}

function mockIndexedDb(): void {
  const records = new Map<string, unknown>();

  const makeRequest = <T>(result: T) => {
    const request = {
      result,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };

  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore: () => ({
          get: (key: string) => makeRequest(records.get(key)),
          put: (value: { key: string }) => {
            records.set(value.key, value);
          },
        }),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    createObjectStore: vi.fn(),
  };

  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = {
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        result: db,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  });
}

beforeEach(() => {
  resetTLESessionCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetTLESessionCacheForTests();
});

describe('TLESource epoch helpers', () => {
  it('parses a TLE epoch from line 1', () => {
    const epoch = parseTLEEpoch(SAMPLE_LINE1);
    expect(epoch).not.toBeNull();
    expect(epoch?.getUTCFullYear()).toBe(2024);
    expect(epoch?.getUTCMonth()).toBe(11);
    expect(epoch?.getUTCDate()).toBe(21);
  });

  it('formats fetch and epoch ages', () => {
    const now = Date.UTC(2024, 11, 22, 12, 0, 0);
    expect(formatDataAge(now - 30 * 60_000, now)).toBe('30m ago');
    expect(formatEpochAge(new Date(now - 2.5 * 86_400_000), now)).toBe('2.5d');
  });
});

describe('TLESource.acquireTLECatalog', () => {
  it('loads bundled sample without network', async () => {
    mockFetchSequence([{ text: SAMPLE_TLE }]);
    const result = await acquireTLECatalog('sample');
    expect(result.tles).toHaveLength(1);
    expect(result.meta.source).toBe('bundled');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('/tle/starlink_sample.txt');
  });

  it('fetches from CelesTrak once and caches the response', async () => {
    mockIndexedDb();
    mockFetchSequence([{ text: SAMPLE_TLE }]);

    const first = await acquireTLECatalog('starlink');
    const second = await acquireTLECatalog('starlink');

    expect(first.meta.source).toBe('network');
    expect(second.meta.source).toBe('cache');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('GROUP=starlink');
  });

  it('serves fresh cache without refetching', async () => {
    mockIndexedDb();
    mockFetchSequence([{ text: SAMPLE_TLE }]);

    const first = await acquireTLECatalog('starlink');
    expect(first.meta.source).toBe('network');

    const second = await acquireTLECatalog('starlink');
    expect(second.meta.source).toBe('cache');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - (second.meta.fetchedAt ?? 0)).toBeLessThan(TLE_CACHE_MAX_AGE_MS);
  });

  it('falls back to bundled data when the network request fails', async () => {
    mockIndexedDb();
    mockFetchSequence([
      { ok: false, status: 503, text: '' },
      { text: SAMPLE_TLE },
    ]);

    const result = await acquireTLECatalog('starlink');
    expect(result.tles).toHaveLength(1);
    expect(result.meta.source).toBe('bundled-fallback');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
