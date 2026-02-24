/**
 * Grok Zephyr - RGB Color Matrix
 * 
 * Manages RGB projection patterns for the constellation light show.
 * Placeholder for future beam projection implementation.
 */

import type { Vec3 } from '@/types/index.js';

/**
 * Color matrix for RGB beam projections
 */
export class ColorMatrix {
  private colors: Vec3[] = [
    [1.0, 0.18, 0.18],  // Red
    [0.18, 1.0, 0.18],  // Green
    [0.25, 0.45, 1.0],  // Blue
    [1.0, 1.0, 0.1],    // Yellow
    [0.1, 1.0, 1.0],    // Cyan
    [1.0, 0.1, 1.0],    // Magenta
    [1.0, 1.0, 1.0],    // White
  ];
  
  /**
   * Get color by index
   */
  getColor(index: number): Vec3 {
    return this.colors[index % this.colors.length];
  }
  
  /**
   * Get all colors
   */
  getAllColors(): Vec3[] {
    return [...this.colors];
  }
}

export default ColorMatrix;
