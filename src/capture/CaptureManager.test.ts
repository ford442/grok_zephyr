import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_NO_RENDERER_STATUS, CaptureManager } from '@/capture/CaptureManager.js';
import { RENDERER_UNAVAILABLE_CLASS } from '@/ui/rendererUnavailable.js';

function setup(noRenderer: boolean) {
  const status = { textContent: 'Ready' };
  const listeners = new Map<string, (e: unknown) => void>();
  const createElement = vi.fn();
  vi.stubGlobal('document', {
    body: {
      classList: { contains: (c: string) => noRenderer && c === RENDERER_UNAVAILABLE_CLASS },
    },
    getElementById: (id: string) => (id === 'captureStatus' ? status : null),
    createElement,
  });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    removeEventListener: vi.fn(),
  });
  const playCaptureToggle = vi.fn();
  const rt = { audio: { playCaptureToggle }, canvas: { width: 100, height: 100 } };
  const mgr = new CaptureManager(rt as never);
  mgr.setupCaptureControls();
  return { status, listeners, createElement, playCaptureToggle, mgr };
}

describe('CaptureManager without a renderer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('P shortcut reports an error and captures nothing', () => {
    const { status, listeners, createElement, playCaptureToggle } = setup(true);
    listeners.get('keydown')!({ key: 'p', preventDefault: vi.fn(), target: null });
    expect(status.textContent).toBe(CAPTURE_NO_RENDERER_STATUS);
    expect(createElement).not.toHaveBeenCalled();
    expect(playCaptureToggle).not.toHaveBeenCalled();
  });

  it('video clip never starts "Recording" and plays no cue', async () => {
    const { status, createElement, playCaptureToggle, mgr } = setup(true);
    await (mgr as unknown as { captureVideoClip(s: number): Promise<void> }).captureVideoClip(4);
    expect(status.textContent).toBe(CAPTURE_NO_RENDERER_STATUS);
    expect(createElement).not.toHaveBeenCalled();
    expect(playCaptureToggle).not.toHaveBeenCalled();
  });

  it('with a renderer the still capture proceeds past the guard', () => {
    const { status, listeners } = setup(false);
    listeners.get('keydown')!({ key: 'p', preventDefault: vi.fn(), target: null });
    expect(status.textContent).not.toBe(CAPTURE_NO_RENDERER_STATUS);
  });
});
