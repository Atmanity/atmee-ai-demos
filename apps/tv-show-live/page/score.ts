// The trailer's score, made in the page with Web Audio (there is no music
// model on the site's keys): a low desert drone with wind under the whole
// trailer, a hit on every card, a bigger one and a swell on the title, and a
// fade at the end.
export interface Score {
  hit(big?: boolean): void;
  end(): void;
}

export function startScore(seconds: number): Score | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  void ctx.resume();
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.9, t0 + 2.5);
  master.connect(ctx.destination);

  // The drone: a low fifth, detuned, through a slowly opening filter.
  const drone = ctx.createBiquadFilter();
  drone.type = 'lowpass';
  drone.frequency.setValueAtTime(180, t0);
  drone.frequency.linearRampToValueAtTime(900, t0 + seconds);
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.16;
  drone.connect(droneGain).connect(master);
  const oscs = [55, 55.4, 82.4, 110.2].map((f) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(drone);
    o.start(t0);
    return o;
  });

  // The wind: noise through a band that drifts.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.8;
  band.frequency.setValueAtTime(500, t0);
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.15;
  lfoDepth.gain.value = 300;
  lfo.connect(lfoDepth).connect(band.frequency);
  const windGain = ctx.createGain();
  windGain.gain.value = 0.05;
  wind.connect(band).connect(windGain).connect(master);
  wind.start(t0);
  lfo.start(t0);

  const hit = (big = false) => {
    const t = ctx.currentTime;
    // A low boom that drops in pitch...
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(big ? 90 : 75, t);
    boom.frequency.exponentialRampToValueAtTime(32, t + 1.4);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(big ? 0.9 : 0.6, t);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + (big ? 3.5 : 2));
    boom.connect(boomGain).connect(master);
    boom.start(t);
    boom.stop(t + 4);
    // ...with a burst of filtered noise on top.
    const burst = ctx.createBufferSource();
    burst.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = big ? 2400 : 1400;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(big ? 0.35 : 0.22, t);
    burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    burst.connect(lp).connect(burstGain).connect(master);
    burst.start(t);
    burst.stop(t + 1);
    // The title also lifts the drone.
    if (big) droneGain.gain.setTargetAtTime(0.26, t, 0.4);
  };

  let ended = false;
  return {
    hit,
    end() {
      if (ended) return;
      ended = true;
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => { oscs.forEach((o) => o.stop()); wind.stop(); lfo.stop(); void ctx.close(); }, 1400);
    },
  };
}
