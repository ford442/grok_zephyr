import type { CameraState } from '@/camera/CameraController.js';
import { CONSTANTS } from '@/types/constants.js';
import type { Vec3 } from '@/types/index.js';
import { footprintAngularRadius, isSatelliteVisible, stationGpuState, type GroundStation } from '@/ground/GroundStation.js';

function normalize(v: Vec3): Vec3 { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

/** Renderer-neutral dynamic guide overlay with analytic Earth depth rejection. */
export class GroundStationGuides {
  private readonly svg: SVGSVGElement;
  private readonly footprint: SVGPathElement;
  private readonly los: SVGLineElement;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg'); this.svg.id = 'ground-station-guides'; this.svg.setAttribute('aria-hidden', 'true');
    this.footprint = document.createElementNS(ns, 'path'); this.footprint.classList.add('station-footprint'); this.svg.appendChild(this.footprint);
    this.los = document.createElementNS(ns, 'line'); this.los.classList.add('station-los'); this.svg.appendChild(this.los);
    document.body.appendChild(this.svg);
  }

  update(options: { station: GroundStation | null; utcMs: number; satellite: Vec3 | null; camera: CameraState; viewProjection: Float32Array; showFootprint: boolean; showLos: boolean }): void {
    const { station, satellite } = options;
    if (!station || !satellite) { this.svg.style.display = 'none'; return; }
    this.svg.style.display = '';
    const rect = this.canvas.getBoundingClientRect();
    this.svg.style.left = `${rect.left}px`; this.svg.style.top = `${rect.top}px`; this.svg.setAttribute('width', `${rect.width}`); this.svg.setAttribute('height', `${rect.height}`); this.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const project = (p: Vec3): [number, number] | null => {
      const m = options.viewProjection; const x = p[0], y = p[1], z = p[2];
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0) return null; return [(cx / cw * .5 + .5) * rect.width, (-cy / cw * .5 + .5) * rect.height];
    };
    const visibleSurface = (p: Vec3): boolean => p[0] * (options.camera.position[0] - p[0]) + p[1] * (options.camera.position[1] - p[1]) + p[2] * (options.camera.position[2] - p[2]) > -1;
    this.footprint.style.display = options.showFootprint ? '' : 'none';
    if (options.showFootprint) {
      const radial = normalize(satellite); const satRadius = Math.hypot(...satellite);
      const angle = footprintAngularRadius(CONSTANTS.EARTH_RADIUS_KM, satRadius, station.minimumElevationDeg);
      let axisA = normalize(cross(radial, Math.abs(radial[2]) > .9 ? [0, 1, 0] : [0, 0, 1])); const axisB = normalize(cross(radial, axisA));
      const radius = CONSTANTS.EARTH_RADIUS_KM + 1.5; const commands: string[] = []; let drawing = false;
      for (let i = 0; i <= 128; i++) {
        const a = i / 128 * Math.PI * 2;
        const p: Vec3 = [radius * (radial[0] * Math.cos(angle) + (axisA[0] * Math.cos(a) + axisB[0] * Math.sin(a)) * Math.sin(angle)), radius * (radial[1] * Math.cos(angle) + (axisA[1] * Math.cos(a) + axisB[1] * Math.sin(a)) * Math.sin(angle)), radius * (radial[2] * Math.cos(angle) + (axisA[2] * Math.cos(a) + axisB[2] * Math.sin(a)) * Math.sin(angle))];
        const q = visibleSurface(p) ? project(p) : null;
        if (q) { commands.push(`${drawing ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`); drawing = true; } else drawing = false;
      }
      this.footprint.setAttribute('d', commands.join(' '));
    }
    this.los.style.display = options.showLos ? '' : 'none';
    if (options.showLos) {
      const stationPos = stationGpuState(station, options.utcMs).positionEciKm; const a = project(stationPos), b = project(satellite);
      if (a && b) { this.los.setAttribute('x1', `${a[0]}`); this.los.setAttribute('y1', `${a[1]}`); this.los.setAttribute('x2', `${b[0]}`); this.los.setAttribute('y2', `${b[1]}`); this.los.classList.toggle('visible', isSatelliteVisible(station, satellite, options.utcMs)); }
      else this.los.style.display = 'none';
    }
  }
}
