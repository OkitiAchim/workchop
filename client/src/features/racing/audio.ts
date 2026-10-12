import { TOP_SPEED, type RaceState } from '../../../../shared/racing';

export function canHearRace(game: RaceState | undefined, selfId: string | null, seated: boolean, visible: boolean): boolean {
  return !!game && game.phase === 'racing' && seated && visible && game.drivers.some((d) => d.id === selfId);
}

/** Synthesized locally in the racer's browser; never connected to office audio or WebRTC. */
export class RaceAudio {
  private context?: AudioContext;
  private engines: { oscillators: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode; pan: StereoPannerNode }[] = [];
  private unavailable = false;

  unlock(allowed: boolean): void {
    if (!allowed || this.unavailable) return;
    try {
      if (!this.context) {
        const ctx = this.context = new AudioContext();
        this.engines = [0, 1].map(() => {
          const gain = ctx.createGain(); gain.gain.value = 0;
          const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.7;
          const pan = ctx.createStereoPanner();
          const oscillators = [ctx.createOscillator(), ctx.createOscillator()];
          oscillators[0].type = 'sawtooth'; oscillators[1].type = 'triangle';
          for (const osc of oscillators) { osc.connect(filter); osc.start(); }
          filter.connect(gain); gain.connect(pan); pan.connect(ctx.destination);
          return { oscillators, gain, filter, pan };
        });
      }
      void this.context.resume().catch(() => { /* A later player gesture can retry. */ });
    } catch { this.unavailable = true; this.dispose(); }
  }

  update(game: RaceState | undefined, selfId: string | null, seated: boolean, visible: boolean, enabled: boolean, now: number): void {
    const ctx = this.context;
    if (!ctx) return; // Spectators never allocate an audio context.
    const audible = enabled && canHearRace(game, selfId, seated, visible);
    const own = game?.drivers.find((d) => d.id === selfId)?.number;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i]; const c = game?.cars[i];
      const speed = c?.speed ?? 0;
      const pitch = 36 + speed / TOP_SPEED * 110;
      const gap = game ? Math.abs(game.cars[0].distance - game.cars[1].distance) : 0;
      const volume = audible ? (own === i + 1 ? 0.035 : 0.018 / (1 + gap / 25)) * (c?.crashVehicle !== null ? 0.35 : 1) : 0;
      e.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.07);
      e.oscillators[0].frequency.setTargetAtTime(pitch, ctx.currentTime, 0.06);
      e.oscillators[1].frequency.setTargetAtTime(pitch * 0.503, ctx.currentTime, 0.06);
      e.filter.frequency.setTargetAtTime(240 + speed * 16 + (c && now < c.boostUntil ? 800 : 0), ctx.currentTime, 0.08);
      e.pan.pan.setTargetAtTime(own === i + 1 ? 0 : Math.max(-0.65, Math.min(0.65, (c?.lane ?? 0) * 0.5)), ctx.currentTime, 0.08);
    }
  }

  silence(): void { const ctx = this.context; if (ctx) for (const e of this.engines) e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.025); }
  dispose(): void {
    for (const e of this.engines) { for (const osc of e.oscillators) { osc.stop(); osc.disconnect(); } e.filter.disconnect(); e.gain.disconnect(); e.pan.disconnect(); }
    this.engines = []; const ctx = this.context; this.context = undefined; if (ctx) void ctx.close().catch(() => {});
  }
}
export const raceAudio = new RaceAudio();
if (import.meta.hot) import.meta.hot.dispose(() => raceAudio.dispose());
