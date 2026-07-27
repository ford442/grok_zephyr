import type { AppRuntime } from '@/app/AppRuntime.js';
import { GROUND_STATION_PRESETS, elevationDeg } from '@/ground/GroundStation.js';
import { predictPasses, type SatellitePass, type SatellitePassMethod } from '@/ground/PassPredictor.js';
import { TlePropagator } from '@/physics/TlePropagator.js';

function esc(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function date(value: number): string { return new Date(value).toISOString().replace('T', ' ').slice(0, 19) + 'Z'; }

export class GroundStationPanel {
  private root: HTMLElement;
  private status = 'No active station';
  private passes: SatellitePass[] = [];
  private abort: AbortController | null = null;
  private predictionKey = '';
  private readonly tle = new TlePropagator();

  constructor(private readonly rt: AppRuntime) {
    this.root = document.createElement('section');
    this.root.id = 'ground-station-panel';
    this.root.setAttribute('aria-label', 'Ground station');
    document.body.appendChild(this.root);
    this.tle.load([...rt.loadedTles]);
    void this.tle.initWasm();
    rt.simulation.groundStations.subscribe(() => { this.render(); this.refreshPrediction(true); });
    rt.simulation.clock.subscribe((_clock, kind, deltaSimSec) => {
      if (kind !== 'tick' || Math.abs(deltaSimSec) >= 300) this.refreshPrediction(true);
    });
    this.render();
  }

  selectionChanged(): void { this.tle.load([...this.rt.loadedTles]); this.refreshPrediction(true); this.render(); }
  tick(): void {
    const station = this.rt.simulation.groundStations.active;
    if (station && this.rt.selectedSatelliteIndex >= 0) {
      const pos = this.positionAtUtc(this.rt.simulation.clock.simUtcMs);
      this.status = pos ? `${elevationDeg(station, pos, this.rt.simulation.clock.simUtcMs).toFixed(1)}° elevation` : 'Position unavailable';
    }
    if (this.passes.length && this.passes[0].losUtcMs < this.rt.simulation.clock.simUtcMs) this.refreshPrediction(true);
    this.renderStatusOnly();
  }

  private positionAtUtc(utcMs: number): [number, number, number] | null {
    const index = this.rt.selectedSatelliteIndex;
    if (index < 0) return null;
    if (index < this.rt.tleRealCount && index < this.tle.count) return this.tle.propagatePositionEci(index, utcMs);
    const seconds = (utcMs - this.rt.simulation.clock.epochTimeMs) / 1000;
    return this.rt.buffers?.calculateSatellitePosition(index, seconds) ?? this.rt.webglOrbital?.calculatePosition(index, seconds) ?? null;
  }

  private refreshPrediction(force = false): void {
    const station = this.rt.simulation.groundStations.active;
    const index = this.rt.selectedSatelliteIndex;
    const key = `${this.rt.simulation.groundStations.revision}:${index}:${this.rt.tleRealCount}:${Math.floor(this.rt.simulation.clock.simUtcMs / 300000)}`;
    if (!force && key === this.predictionKey) return;
    this.predictionKey = key; this.abort?.abort(); this.passes = [];
    if (!station || index < 0) { this.status = station ? 'Select a satellite to predict passes' : 'No active station'; this.render(); return; }
    const abort = new AbortController(); this.abort = abort; this.status = 'Predicting passes…'; this.render();
    const method: SatellitePassMethod = index < this.rt.tleRealCount ? (this.tle.isWasmActive() ? 'sgp4-wasm' : 'sgp4-js') : 'keplerian-approximate';
    void predictPasses({ startUtcMs: this.rt.simulation.clock.simUtcMs, station, positionAtUtc: (utcMs) => this.positionAtUtc(utcMs), method, signal: abort.signal }).then((passes) => {
      if (abort.signal.aborted) return; this.passes = passes; this.status = passes.length ? `${passes.length} pass${passes.length === 1 ? '' : 'es'} predicted` : 'No passes in the next seven days'; this.render();
    }).catch((error: unknown) => { if ((error as { name?: string }).name !== 'AbortError') { this.status = 'Prediction unavailable'; this.render(); } });
  }

  private render(): void {
    const controller = this.rt.simulation.groundStations;
    const s = controller.active;
    const options = [...GROUND_STATION_PRESETS, ...controller.saved].map((p) => `<option value="${esc(p.name)}" ${s?.name === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    this.root.innerHTML = `<details open><summary>GROUND STATION</summary><div class="gs-body">
      <label>Station <select id="gs-preset"><option value="">Choose…</option>${options}</select></label>
      <div class="gs-grid"><label>Name<input id="gs-name" value="${esc(s?.name ?? 'Custom Station')}"></label><label>Latitude<input id="gs-lat" type="number" min="-90" max="90" step="0.0001" value="${s?.latitudeDeg ?? ''}"></label><label>Longitude<input id="gs-lon" type="number" step="0.0001" value="${s?.longitudeDeg ?? ''}"></label><label>Altitude m<input id="gs-alt" type="number" value="${s?.altitudeM ?? 0}"></label><label>Min elevation °<input id="gs-min" type="number" min="0" max="90" value="${s?.minimumElevationDeg ?? 0}"></label></div>
      <div class="gs-actions"><button id="gs-apply">Apply</button><button id="gs-location">Use My Location</button><button id="gs-save" ${s ? '' : 'disabled'}>Save Custom</button><button id="gs-clear" ${s ? '' : 'disabled'}>Clear</button></div>
      <div class="gs-toggles"><label><input id="gs-footprint" type="checkbox" ${controller.showFootprint ? 'checked' : ''}> Footprint</label><label><input id="gs-los" type="checkbox" ${controller.showLos ? 'checked' : ''}> LOS</label></div>
      <div class="gs-coords">${s ? `${s.latitudeDeg.toFixed(4)}°, ${s.longitudeDeg.toFixed(4)}° · ${s.altitudeM.toFixed(0)} m · ${s.source}` : 'Station features disabled'}</div>
      <div id="gs-status" aria-live="polite">${esc(this.status)}</div><div class="gs-passes">${this.passHtml()}</div>
    </div></details>`;
    this.bind();
  }

  private passHtml(): string { return this.passes.map((p) => `<div class="gs-pass"><strong>${p.inProgress ? 'IN PROGRESS' : date(p.aosUtcMs)}</strong><span>LOS ${date(p.losUtcMs)} · max ${p.maxElevationDeg.toFixed(1)}°</span><small>${p.method === 'keplerian-approximate' ? 'Approximate' : p.method}</small></div>`).join(''); }
  private renderStatusOnly(): void { const el = this.root.querySelector('#gs-status'); if (el) el.textContent = this.status; }
  private input(id: string): HTMLInputElement { return this.root.querySelector(`#${id}`) as HTMLInputElement; }
  private bind(): void {
    const controller = this.rt.simulation.groundStations;
    (this.root.querySelector('#gs-preset') as HTMLSelectElement).onchange = (event) => { const name = (event.target as HTMLSelectElement).value; if (name) { const saved = controller.saved.find((s) => s.name === name); if (saved) controller.setActive(saved); else controller.usePreset(name); } };
    this.input('gs-apply').onclick = () => { try { controller.setActive({ name: this.input('gs-name').value, latitudeDeg: this.input('gs-lat').valueAsNumber, longitudeDeg: this.input('gs-lon').valueAsNumber, altitudeM: this.input('gs-alt').valueAsNumber, minimumElevationDeg: this.input('gs-min').valueAsNumber, source: 'manual' }); } catch (e) { this.status = (e as Error).message; this.renderStatusOnly(); } };
    this.input('gs-save').onclick = () => controller.saveActive(this.input('gs-name').value);
    this.input('gs-clear').onclick = () => controller.setActive(null);
    this.input('gs-footprint').onchange = () => controller.setDisplay(this.input('gs-footprint').checked, this.input('gs-los').checked);
    this.input('gs-los').onchange = () => controller.setDisplay(this.input('gs-footprint').checked, this.input('gs-los').checked);
    this.input('gs-location').onclick = () => {
      if (!navigator.geolocation) { this.status = 'Geolocation unavailable'; this.renderStatusOnly(); return; }
      this.status = 'Requesting location…'; this.renderStatusOnly();
      navigator.geolocation.getCurrentPosition((position) => controller.setActive({ name: 'My Location', latitudeDeg: position.coords.latitude, longitudeDeg: position.coords.longitude, altitudeM: position.coords.altitude ?? 0, minimumElevationDeg: Number.isFinite(this.input('gs-min').valueAsNumber) ? this.input('gs-min').valueAsNumber : 0, source: 'geolocation' }, false), (error) => { this.status = error.code === 1 ? 'Location permission denied' : error.code === 3 ? 'Location request timed out' : 'Location unavailable'; this.renderStatusOnly(); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    };
  }
}
