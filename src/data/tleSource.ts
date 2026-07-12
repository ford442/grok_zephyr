/**
 * Known CelesTrak group names for the ?tle= query param shorthand.
 * Usage: ?tle=starlink or ?tle=https://example.com/my-tles.txt
 */
export const CELESTRAK_GROUPS: Record<string, string> = {
  starlink: 'starlink',
  oneweb: 'oneweb',
  iridium: 'iridium',
  'iridium-next': 'iridium-NEXT',
  gps: 'gps-ops',
  galileo: 'galileo',
  stations: 'stations',
  active: 'active',
};

/**
 * Resolve the TLE data source from the query string.
 *
 * Supports:
 *   ?tle=starlink       → CelesTrak Starlink group
 *   ?tle=oneweb         → CelesTrak OneWeb group
 *   ?tle=https://...    → arbitrary URL returning 3-line TLE text
 *
 * Returns null if no ?tle param is present (uses default procedural mode).
 */
export function getTLESource(search: string = window.location.search): string | null {
  return resolveTLESource(new URLSearchParams(search));
}

export function resolveTLESource(params: URLSearchParams): string | null {
  const tleParam = params.get('tle');
  if (!tleParam) return null;

  const lower = tleParam.toLowerCase();
  if (CELESTRAK_GROUPS[lower]) {
    return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${CELESTRAK_GROUPS[lower]}&FORMAT=tle`;
  }

  if (tleParam.startsWith('http://') || tleParam.startsWith('https://')) {
    return tleParam;
  }

  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(tleParam)}&FORMAT=tle`;
}
