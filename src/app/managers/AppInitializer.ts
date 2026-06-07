
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { CONSTANTS, BUFFER_SIZES } from '@/types/constants.js';

export class AppInitializer {
  constructor(private app: GrokZephyrApp) {}

  public getTLESource(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    const tleParam = urlParams.get('tle');

    if (tleParam) {
      if (tleParam.startsWith('http')) return tleParam;

      const groupKey = tleParam.toLowerCase();
      // Import CELESTRAK_GROUPS from constants (need to pass or import)
      // Actually we will just expose it.
      return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${groupKey}&FORMAT=tle`;
    }

    return null;
  }

  public parseInitialStateFromURL(): {
    cameraIndex: number,
    groundAltitude: number,
    quality: string | null,
    background: string | null,
    tonemap: number | null
  } {
    const urlParams = new URLSearchParams(window.location.search);

    let cameraIndex = -1;
    let groundAltitude = 0;

    const camParam = urlParams.get('cam');
    if (camParam === 'god') {
      cameraIndex = 1;
    } else if (camParam === 'fleet') {
      cameraIndex = 2;
    } else if (camParam === 'surface') {
      cameraIndex = 3;
    } else if (camParam === 'horizon') {
      cameraIndex = 0;
      groundAltitude = 720;
    }

    const altParam = urlParams.get('alt');
    if (altParam && cameraIndex === 0) {
      const parsedAlt = parseFloat(altParam);
      if (!isNaN(parsedAlt)) {
        groundAltitude = Math.max(10, Math.min(2000, parsedAlt));
      }
    }

    const tonemapParam = urlParams.get('tonemap');
    let tonemap: number | null = null;
    if (tonemapParam) {
      const parsedTonemap = parseInt(tonemapParam, 10);
      if (!isNaN(parsedTonemap) && parsedTonemap >= 0 && parsedTonemap <= 3) {
        tonemap = parsedTonemap;
      }
    }

    return {
      cameraIndex,
      groundAltitude,
      quality: urlParams.get('q') || urlParams.get('quality'),
      background: urlParams.get('bg') || urlParams.get('background'),
      tonemap
    };
  }
}
