/**
 * Grok Zephyr - Pattern Helpers
 *
 * Centralizes the beam/constellation pattern names and titles so UI and render
 * logic stay consistent.
 */

export enum BeamPatternMode {
  CHAOS = 0,
  GROK = 1,
  X_LOGO = 2,
}

export const BEAM_PATTERN_NAMES = ['CHAOS', 'GROK', '𝕏 LOGO'] as const;
export const CONSTELLATION_NAMES = ['Entropy Net', 'Big Dipper', 'Orion'] as const;

export function getBeamPatternName(mode: number): string {
  return BEAM_PATTERN_NAMES[mode] ?? 'UNKNOWN';
}

export function getBeamPatternTitle(mode: number): string {
  const pattern = getBeamPatternName(mode);
  const constellation = CONSTELLATION_NAMES[mode] ?? '';
  return constellation ? `${pattern} • ${constellation}` : pattern;
}
