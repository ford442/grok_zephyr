
import { type WebGPUContext } from '@/core/WebGPUContext.js';
import { type CameraController } from '@/camera/CameraController.js';

export interface CaptureDeps {
  canvas: HTMLCanvasElement;
  context: WebGPUContext | null;
  camera: CameraController;
  audio: any;
  ui: any;
  getQualityLevel: () => string;
  getBeamPatternTitle: () => string;
}

export class CaptureManager {
  private static readonly CAPTURE_UI_HIDE_IDS = ['ui', 'controls', 'horizon-indicator', 'ground-preset-selector', 'capture-gallery'];
  private static readonly CAPTURE_GALLERY_LIMIT = 6;
  private static readonly PREFERRED_VIDEO_MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  private captureInProgress = false;
  private captureHideElements: HTMLElement[] = [];

  private captureStatus: HTMLElement | null = null;
  private captureGallery: HTMLElement | null = null;
  private captureOverlayToggle: HTMLInputElement | null = null;
  private captureHideUIToggle: HTMLInputElement | null = null;
  private captureVideoLength: HTMLSelectElement | null = null;
  private captureVideoButton: HTMLButtonElement | null = null;

  constructor(private deps: CaptureDeps) {}

  public setupCaptureControls(): void {
    const captureButton = document.getElementById('capture-btn') as HTMLButtonElement;
    if (captureButton) {
      captureButton.addEventListener('click', () => this.handleCaptureClick());
    }

    this.captureStatus = document.getElementById('capture-status');
    this.captureGallery = document.getElementById('capture-gallery');
    this.captureOverlayToggle = document.getElementById('capture-overlay-toggle') as HTMLInputElement;
    this.captureHideUIToggle = document.getElementById('capture-hide-ui-toggle') as HTMLInputElement;
    this.captureVideoLength = document.getElementById('capture-video-length') as HTMLSelectElement;
    this.captureVideoButton = document.getElementById('capture-video-btn') as HTMLButtonElement;

    if (this.captureVideoButton) {
      this.captureVideoButton.addEventListener('click', () => {
        if (!this.captureVideoLength) return;
        const duration = parseInt(this.captureVideoLength.value, 10);
        if (duration > 0) void this.captureVideoClip(duration);
      });
    }

    if (!window.MediaRecorder && this.captureVideoButton) {
      this.captureVideoButton.disabled = true;
      this.captureVideoButton.title = 'MediaRecorder API not supported in this browser';
    }

    const clearGalleryBtn = document.getElementById('clear-gallery-btn');
    if (clearGalleryBtn) {
      clearGalleryBtn.addEventListener('click', () => {
        if (this.captureGallery) this.captureGallery.innerHTML = '';
        this.setCaptureStatus('Gallery cleared');
      });
    }

    const testAudioBtn = document.getElementById('test-audio-btn');
    if (testAudioBtn) {
      testAudioBtn.addEventListener('click', () => {
        void this.deps.audio.unlock();
        this.deps.audio.playCaptureToggle(true);
        setTimeout(() => this.deps.audio.playCaptureToggle(false), 500);
      });
    }
  }

  private getCaptureMeta() {
    return {
      cam: this.deps.camera.getViewModeName(),
      fov: Math.round(this.deps.camera.getState().fov * 180 / Math.PI),
      alt: Math.round(this.deps.camera.getCameraAngles().distance),
      q: this.deps.getQualityLevel(),
      bpm: this.deps.getBeamPatternTitle()
    };
  }

  private async withCaptureUIVisibility<T>(fn: () => Promise<T>): Promise<T> {
    const shouldHideUI = this.captureHideUIToggle?.checked ?? true;

    if (shouldHideUI) {
      this.captureHideElements = CaptureManager.CAPTURE_UI_HIDE_IDS
        .map(id => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);

      this.captureHideElements.forEach(el => {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      });

      const hudContainer = document.getElementById('hud-container');
      if (hudContainer) hudContainer.style.opacity = '0';

      await new Promise(resolve => setTimeout(resolve, 150));
    }

    try {
      return await fn();
    } finally {
      if (shouldHideUI) {
        this.captureHideElements.forEach(el => {
          el.style.opacity = '';
          el.style.pointerEvents = '';
        });
        const hudContainer = document.getElementById('hud-container');
        if (hudContainer) hudContainer.style.opacity = '';
        this.captureHideElements = [];
      }
    }
  }

  private async captureVideoClip(durationSeconds: number): Promise<void> {
    if (this.captureInProgress || durationSeconds <= 0) return;

    if (!window.MediaRecorder) {
      this.setCaptureStatus('MediaRecorder unsupported');
      return;
    }

    this.captureInProgress = true;
    if (this.captureVideoButton) this.captureVideoButton.disabled = true;
    this.setCaptureStatus(`Recording ${durationSeconds}s...`);
    this.deps.audio.playCaptureToggle(true);

    try {
      await this.withCaptureUIVisibility(async () => {
        const recorderCanvas = document.createElement('canvas');
        const width = this.deps.canvas.width;
        const height = this.deps.canvas.height;
        recorderCanvas.width = width;
        recorderCanvas.height = height;
        const ctx = recorderCanvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!ctx) throw new Error('2D capture context unavailable');

        const stream = recorderCanvas.captureStream(30);
        const mimeType = this.getVideoMimeType();
        const options = mimeType ? { mimeType, videoBitsPerSecond: 8000000 } : undefined;
        const recorder = new MediaRecorder(stream, options);
        const chunks: Blob[] = [];

        recorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        const recordingPromise = new Promise<string>((resolve, reject) => {
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
            resolve(URL.createObjectURL(blob));
          };
          recorder.onerror = e => reject(e);
        });

        recorder.start();
        const startTime = performance.now();
        const drawInterval = setInterval(() => {
          const elapsed = performance.now() - startTime;
          if (elapsed >= durationSeconds * 1000) {
            clearInterval(drawInterval);
            if (recorder.state === 'recording') recorder.stop();
          } else {
            this.drawCaptureFrame(ctx, width, height);
            const remaining = durationSeconds - (elapsed / 1000);
            this.setCaptureStatus(`Recording ${remaining.toFixed(1)}s...`);
          }
        }, 1000 / 30);

        const url = await recordingPromise;
        const filename = this.getCaptureFilename(`${durationSeconds}s`, 'webm');
        this.addCaptureToGallery(url, 'video', filename);
      });

      this.deps.audio.playCaptureToggle(false);
      this.setCaptureStatus('Saved video clip');
    } catch (error) {
      console.error('Video capture failed:', error);
      this.setCaptureStatus('Video capture failed');
    } finally {
      if (this.captureVideoButton) this.captureVideoButton.disabled = false;
      this.captureInProgress = false;
    }
  }

  private async captureHighResScreenshot(): Promise<void> {
    if (this.captureInProgress) return;
    this.captureInProgress = true;
    this.deps.audio.playCaptureToggle(true);

    try {
      const url = await this.withCaptureUIVisibility(async () => {
        return new Promise<string>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const canvas = document.createElement('canvas');
              canvas.width = this.deps.canvas.width;
              canvas.height = this.deps.canvas.height;
              const ctx = canvas.getContext('2d');
              if (ctx) this.drawCaptureFrame(ctx, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/png'));
            });
          });
        });
      });

      const filename = this.getCaptureFilename('hires', 'png');
      this.addCaptureToGallery(url, 'image', filename);
      this.deps.audio.playCaptureToggle(false);
      this.setCaptureStatus('Saved screenshot');
    } catch (error) {
      console.error('Capture failed:', error);
      this.setCaptureStatus('Screenshot failed');
    } finally {
      this.captureInProgress = false;
    }
  }

  private drawCaptureFrame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.drawImage(this.deps.canvas, 0, 0, width, height);
    if (this.captureOverlayToggle?.checked) {
      const meta = this.getCaptureMeta();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(20, height - 80, 400, 60);
      ctx.fillStyle = '#00ffcc';
      ctx.font = '14px "Space Mono", monospace';
      ctx.fillText(`GROK ZEPHYR v1.0 | ${meta.cam}`, 30, height - 55);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`ALT: ${meta.alt}km | FOV: ${meta.fov}° | ${meta.q.toUpperCase()}`, 30, height - 35);
    }
  }

  private getVideoMimeType(): string {
    for (const type of CaptureManager.PREFERRED_VIDEO_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  private addCaptureToGallery(url: string, type: 'image' | 'video', filename: string): void {
    if (!this.captureGallery) return;
    const item = document.createElement('a');
    item.className = 'capture-gallery-item';
    item.href = url;
    item.download = filename;
    item.dataset.captureUrl = url;

    if (type === 'image') {
      const img = document.createElement('img');
      img.src = url;
      item.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.addEventListener('mouseenter', () => void video.play());
      video.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
      item.appendChild(video);

      const badge = document.createElement('div');
      badge.className = 'capture-badge';
      badge.textContent = 'REC';
      item.appendChild(badge);
    }

    this.captureGallery.insertBefore(item, this.captureGallery.firstChild);
    while (this.captureGallery.children.length > CaptureManager.CAPTURE_GALLERY_LIMIT) {
      const last = this.captureGallery.lastChild as HTMLAnchorElement;
      if (last && last.dataset.captureUrl) URL.revokeObjectURL(last.dataset.captureUrl);
      this.captureGallery.removeChild(last);
    }
  }

  private setCaptureStatus(message: string): void {
    if (!this.captureStatus) return;
    this.captureStatus.textContent = message;
    this.captureStatus.style.opacity = '1';

    setTimeout(() => {
      if (this.captureStatus?.textContent === message) {
        this.captureStatus.style.opacity = '0';
      }
    }, 3000);
  }

  private getCaptureFilename(suffix: string, ext: string): string {
    const now = new Date();
    const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const safeMode = this.deps.camera.getViewModeName().replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `grokzephyr_${safeMode}_${ts}_${suffix}.${ext}`;
  }

  private async handleCaptureClick(): Promise<void> {
    await this.captureHighResScreenshot();
  }
}
