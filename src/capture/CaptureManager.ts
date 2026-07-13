import { getBeamPatternTitle } from '@/patterns.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

const CAPTURE_UI_HIDE_IDS = [
  'ui',
  'controls',
  'horizon-indicator',
  'horizon-limb-line',
  'fleet-cockpit-hud',
  'ground-preset-selector',
  'capture-gallery',
];
const CAPTURE_GALLERY_LIMIT = 6;
const PREFERRED_VIDEO_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export class CaptureManager {
  private captureStatus: HTMLElement | null = null;
  private captureGallery: HTMLElement | null = null;
  private captureOverlayToggle: HTMLInputElement | null = null;
  private captureHideUIToggle: HTMLInputElement | null = null;
  private captureVideoLength: HTMLSelectElement | null = null;
  private captureVideoButton: HTMLButtonElement | null = null;
  private captureInProgress = false;
  private captureHideElements: HTMLElement[] = [];

  constructor(private readonly rt: AppRuntime) {}

  setupCaptureControls(): void {
    this.captureStatus = document.getElementById('captureStatus');
    this.captureGallery = document.getElementById('capture-gallery');
    this.captureOverlayToggle = document.getElementById(
      'capOverlayToggle',
    ) as HTMLInputElement | null;
    this.captureHideUIToggle = document.getElementById(
      'capHideUIToggle',
    ) as HTMLInputElement | null;
    this.captureVideoLength = document.getElementById('capVideoLength') as HTMLSelectElement | null;
    this.captureVideoButton = document.getElementById('capVideoStart') as HTMLButtonElement | null;
    this.captureHideElements = CAPTURE_UI_HIDE_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );

    const still1x = document.getElementById('capStill1x');
    const still2x = document.getElementById('capStill2x');

    still1x?.addEventListener('click', () => {
      void this.captureStillImage(1);
    });
    still2x?.addEventListener('click', () => {
      void this.captureStillImage(2);
    });
    this.captureVideoButton?.addEventListener('click', () => {
      const seconds = parseInt(this.captureVideoLength?.value ?? '5', 10) || 5;
      void this.captureVideoClip(seconds);
    });
  }

  destroyGallery(): void {
    if (!this.captureGallery) return;
    this.captureGallery
      .querySelectorAll<HTMLAnchorElement>('.capture-gallery-item')
      .forEach((item) => {
        const url = item.dataset.captureUrl;
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
  }

  private setCaptureStatus(text: string): void {
    if (this.captureStatus) {
      this.captureStatus.textContent = text;
    }
  }

  private getCurrentViewDisplayName(): string {
    switch (this.rt.camera.getViewMode()) {
      case 'horizon-720':
        return '720km Horizon';
      case 'god':
        return 'God View';
      case 'sat-pov':
        return 'Fleet POV';
      case 'ground':
        return 'Ground View';
      case 'moon':
        return 'Moon View';
      case 'skyline':
        return 'Skyline View';
      default:
        return 'Unknown';
    }
  }

  private getCaptureMeta() {
    const modeName = this.getCurrentViewDisplayName();
    const patternName =
      this.rt.patternNameDisplay?.textContent?.trim() ||
      getBeamPatternTitle(this.rt.simulation.currentPatternMode);
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');
    return { modeName, patternName, timestamp };
  }

  private drawBrandOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const { modeName, patternName, timestamp } = this.getCaptureMeta();
    const pad = Math.max(12, Math.round(width * 0.012));
    const cardWidth = Math.min(width * 0.62, 480);
    const cardHeight = Math.max(78, Math.round(height * 0.16));

    ctx.fillStyle = 'rgba(0, 8, 20, 0.65)';
    ctx.strokeStyle = 'rgba(102, 204, 255, 0.75)';
    ctx.lineWidth = Math.max(1, Math.round(width * 0.0012));
    ctx.fillRect(pad, height - cardHeight - pad, cardWidth, cardHeight);
    ctx.strokeRect(pad, height - cardHeight - pad, cardWidth, cardHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(12, Math.round(width * 0.015))}px "Courier New", monospace`;
    ctx.fillText('GROK ZEPHYR', pad + 10, height - cardHeight + 18 - pad);

    ctx.fillStyle = '#66ccff';
    ctx.font = `${Math.max(10, Math.round(width * 0.0115))}px "Courier New", monospace`;
    ctx.fillText(`View: ${modeName}`, pad + 10, height - cardHeight + 38 - pad);
    ctx.fillText(`Pattern: ${patternName}`, pad + 10, height - cardHeight + 56 - pad);
    ctx.fillText(timestamp, pad + 10, height - cardHeight + 72 - pad);
  }

  private drawGroundCaptureFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.30)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.58)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(180, 210, 255, 0.45)';
    ctx.lineWidth = Math.max(3, Math.round(width * 0.005));
    const inset = Math.round(width * 0.02);
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  }

  private drawCaptureFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.rt.canvas, 0, 0, width, height);

    const hideUI = this.captureHideUIToggle?.checked ?? false;
    if (!hideUI && this.rt.camera.getViewMode() === 'ground') {
      this.drawGroundCaptureFrame(ctx, width, height);
    }

    if (this.captureOverlayToggle?.checked ?? true) {
      this.drawBrandOverlay(ctx, width, height);
    }
  }

  private async withCaptureUIVisibility<T>(fn: () => Promise<T>): Promise<T> {
    const hideUI = this.captureHideUIToggle?.checked ?? false;
    if (!hideUI) {
      return fn();
    }

    const affected = this.captureHideElements;
    const previous = affected.map((el) => el.style.visibility);

    affected.forEach((el) => {
      el.style.visibility = 'hidden';
    });

    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      return await fn();
    } finally {
      affected.forEach((el, idx) => {
        el.style.visibility = previous[idx];
      });
    }
  }

  private downloadUrl(url: string, filename: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private addCaptureToGallery(url: string, type: 'image' | 'video', label: string): void {
    if (!this.captureGallery) return;

    const item = document.createElement('a');
    item.className = 'capture-gallery-item';
    item.href = url;
    item.download = label;
    item.title = label;
    item.dataset.captureUrl = url;
    item.setAttribute('aria-label', `Captured ${type} ${label}`);

    if (type === 'image') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = label;
      item.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      item.appendChild(video);
    }

    const meta = document.createElement('span');
    meta.textContent = label;
    item.appendChild(meta);

    this.captureGallery.prepend(item);
    while (this.captureGallery.children.length > CAPTURE_GALLERY_LIMIT) {
      const last = this.captureGallery.lastElementChild as HTMLAnchorElement | null;
      if (!last) break;
      const oldUrl = last.dataset.captureUrl;
      if (oldUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(oldUrl);
      }
      this.captureGallery.removeChild(last);
    }
  }

  private getCaptureFilename(prefix: string, ext: string): string {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-');
    return `grok-zephyr-${prefix}-${stamp}.${ext}`;
  }

  private toBlobUrl(canvas: HTMLCanvasElement, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode capture'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, mimeType);
    });
  }

  private async captureStillImage(scale: 1 | 2): Promise<void> {
    if (this.captureInProgress) return;
    this.captureInProgress = true;
    this.setCaptureStatus(`Capturing PNG ${scale}x...`);

    try {
      await this.withCaptureUIVisibility(async () => {
        const width = Math.floor(this.rt.canvas.width * scale);
        const height = Math.floor(this.rt.canvas.height * scale);
        const outCanvas = document.createElement('canvas');
        outCanvas.width = width;
        outCanvas.height = height;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) throw new Error('2D capture context unavailable');

        this.drawCaptureFrame(ctx, width, height);
        const url = await this.toBlobUrl(outCanvas, 'image/png');
        const filename = this.getCaptureFilename(`${scale}x`, 'png');
        this.addCaptureToGallery(url, 'image', filename);
        this.downloadUrl(url, filename);
      });
      this.rt.audio.playCaptureToggle(false);
      this.setCaptureStatus(`Saved PNG ${scale}x`);
    } catch (error) {
      console.error('Capture failed:', error);
      this.setCaptureStatus('Capture failed');
    } finally {
      this.captureInProgress = false;
    }
  }

  private getVideoMimeType(): string {
    for (const type of PREFERRED_VIDEO_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  private async captureVideoClip(durationSeconds: number): Promise<void> {
    if (this.captureInProgress || durationSeconds <= 0) return;
    if (!('MediaRecorder' in window)) {
      this.setCaptureStatus('MediaRecorder unsupported');
      return;
    }

    this.captureInProgress = true;
    if (this.captureVideoButton) this.captureVideoButton.disabled = true;
    this.setCaptureStatus(`Recording ${durationSeconds}s...`);
    this.rt.audio.playCaptureToggle(true);

    try {
      await this.withCaptureUIVisibility(async () => {
        const width = this.rt.canvas.width;
        const height = this.rt.canvas.height;
        const recorderCanvas = document.createElement('canvas');
        recorderCanvas.width = width;
        recorderCanvas.height = height;
        const ctx = recorderCanvas.getContext('2d');
        if (!ctx) throw new Error('2D capture context unavailable');

        const stream = recorderCanvas.captureStream(30);
        const mimeType = this.getVideoMimeType();
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch {
          throw new Error(`Failed to initialize video recorder${mimeType ? ` (${mimeType})` : ''}`);
        }
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        const started = performance.now();
        let rafId = 0;

        await new Promise<void>((resolve, reject) => {
          recorder.onerror = () => reject(new Error('Video recording failed'));
          recorder.onstop = () => resolve();
          recorder.start(250);

          const renderFrame = () => {
            const elapsed = (performance.now() - started) / 1000;
            this.drawCaptureFrame(ctx, width, height);
            const remaining = Math.max(0, durationSeconds - elapsed);
            this.setCaptureStatus(`Recording ${remaining.toFixed(1)}s...`);
            if (elapsed >= durationSeconds) {
              recorder.stop();
              return;
            }
            rafId = requestAnimationFrame(renderFrame);
          };
          rafId = requestAnimationFrame(renderFrame);
        }).finally(() => {
          cancelAnimationFrame(rafId);
          stream.getTracks().forEach((track) => track.stop());
        });

        const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const filename = this.getCaptureFilename(`${durationSeconds}s`, 'webm');
        this.addCaptureToGallery(url, 'video', filename);
        this.downloadUrl(url, filename);
      });
      this.rt.audio.playCaptureToggle(false);
      this.setCaptureStatus('Saved video clip');
    } catch (error) {
      console.error('Video capture failed:', error);
      this.setCaptureStatus('Video capture failed');
    } finally {
      if (this.captureVideoButton) this.captureVideoButton.disabled = false;
      this.captureInProgress = false;
    }
  }
}
