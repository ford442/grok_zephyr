import { GROUND_STATION_PRESETS, GROUND_STATION_STORAGE_KEY, validateGroundStation, type GroundStation } from './GroundStation.js';

interface PersistedState { active: GroundStation | null; saved: GroundStation[]; showFootprint: boolean; showLos: boolean }
export type GroundStationListener = () => void;

export class GroundStationController {
  active: GroundStation | null = null;
  saved: GroundStation[] = [];
  showFootprint = true;
  showLos = true;
  revision = 0;
  private readonly listeners = new Set<GroundStationListener>();

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.restore();
  }

  subscribe(listener: GroundStationListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  setActive(station: GroundStation | null, persist = station?.source !== 'geolocation'): void {
    this.active = station ? validateGroundStation(station) : null;
    this.changed(persist);
  }

  usePreset(name: string): void {
    const station = GROUND_STATION_PRESETS.find((candidate) => candidate.name === name);
    if (!station) throw new RangeError(`Unknown ground station preset: ${name}`);
    this.setActive({ ...station });
  }

  saveActive(name?: string): void {
    if (!this.active) return;
    const saved = validateGroundStation({ ...this.active, name: name?.trim() || this.active.name, source: 'saved' });
    this.saved = [...this.saved.filter((item) => item.name !== saved.name), saved];
    this.active = saved;
    this.changed(true);
  }

  setDisplay(showFootprint: boolean, showLos: boolean): void {
    this.showFootprint = showFootprint; this.showLos = showLos; this.changed(true);
  }

  private changed(persist: boolean): void { this.revision++; if (persist) this.persist(); for (const listener of this.listeners) listener(); }
  private persist(): void {
    if (!this.storage) return;
    const active = this.active?.source === 'geolocation' ? null : this.active;
    this.storage.setItem(GROUND_STATION_STORAGE_KEY, JSON.stringify({ active, saved: this.saved, showFootprint: this.showFootprint, showLos: this.showLos } satisfies PersistedState));
  }
  private restore(): void {
    try {
      const raw = this.storage?.getItem(GROUND_STATION_STORAGE_KEY); if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.active = parsed.active ? validateGroundStation(parsed.active) : null;
      this.saved = Array.isArray(parsed.saved) ? parsed.saved.map(validateGroundStation) : [];
      this.showFootprint = parsed.showFootprint ?? true; this.showLos = parsed.showLos ?? true;
    } catch { this.active = null; this.saved = []; }
  }
}
