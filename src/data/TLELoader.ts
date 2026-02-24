/**
 * Grok Zephyr - TLE Loader
 * 
 * Loads Two-Line Element sets from files or API.
 */

import type { TLEData } from '@/types/index.js';

/**
 * TLE Loader
 * 
 * Fetches and parses TLE data from various sources.
 */
export class TLELoader {
  /**
   * Load TLE data from a file
   */
  static async fromFile(url: string): Promise<TLEData[]> {
    const response = await fetch(url);
    const text = await response.text();
    return TLELoader.parse(text);
  }
  
  /**
   * Parse TLE text into structured data
   */
  static parse(text: string): TLEData[] {
    const lines = text.trim().split('\n');
    const tles: TLEData[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip comments and empty lines
      if (!line || line.startsWith('#')) continue;
      
      // Look for satellite name
      if (!line.startsWith('1 ') && !line.startsWith('2 ')) {
        const name = line;
        const line1 = lines[++i]?.trim();
        const line2 = lines[++i]?.trim();
        
        if (line1?.startsWith('1 ') && line2?.startsWith('2 ')) {
          tles.push({ name, line1, line2 });
        }
      }
    }
    
    return tles;
  }
  
  /**
   * Fetch from CelesTrak API
   */
  static async fromCelesTrak(group: string): Promise<TLEData[]> {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    return TLELoader.fromFile(url);
  }
}

export default TLELoader;
