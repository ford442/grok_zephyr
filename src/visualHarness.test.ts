import { describe, expect, it } from 'vitest';
import { parseVisualHarnessParams } from '@/visualHarness.js';
import { GroundObserverPreset } from '@/camera/GroundObserverCamera.js';

describe('parseVisualHarnessParams', () => {
  it('parses deterministic harness flags', () => {
    const p = parseVisualHarnessParams(
      '?demo=0&simTime=180&timescale=0&ground=houseWindow&seed=42',
    );
    expect(p.demoAuto).toBe(false);
    expect(p.simTime).toBe(180);
    expect(p.timeScale).toBe(0);
    expect(p.groundPreset).toBe(GroundObserverPreset.HOUSE_WINDOW);
    expect(p.seed).toBe(42);
  });

  it('ignores unknown ground presets', () => {
    const p = parseVisualHarnessParams('?ground=not-a-preset');
    expect(p.groundPreset).toBeNull();
  });
});
