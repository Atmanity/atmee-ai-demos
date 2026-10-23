// The compression metronome: pure view state, page-local, never sent anywhere.
// Ported unchanged from the original panel.
//
// The RATE is not ours: it arrives in the snapshot as `metronome_bpm`, sourced
// from the scenario data. This file only turns a number into clicks, which is
// why it takes the bpm as an argument and has no default.
//
// WebAudio only (the original panel's CSP blocked audio files; it also keeps
// this sample free of assets).

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | undefined {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export class Metronome {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  start(bpm: number): void {
    this.stop();
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    this.ctx ??= new Ctor();
    void this.ctx.resume?.();
    this.timer = window.setInterval(() => this.click(), 60000 / bpm);
    this.click();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private click(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }
}
