// Small Web Audio synth kit for poker table sound cues.
// Pure procedural sounds so we don't need asset files.

let ctx: AudioContext | null = null;
let muted = true;
const MUTE_KEY = "poker.sounds.muted";

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  return ctx;
}

try {
  const stored = localStorage.getItem(MUTE_KEY);
  if (stored !== null) muted = stored === "1";
} catch {
  // ignore
}

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

interface ToneOptions {
  freq: number;
  endFreq?: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  release?: number;
  delay?: number;
}

function tone(opts: ToneOptions) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(opts.endFreq, 1),
      now + opts.duration,
    );
  }
  const volume = opts.volume ?? 0.18;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? 0.08;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.linearRampToValueAtTime(0.0001, now + opts.duration + release);
  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + opts.duration + release + 0.02);
}

function noiseBurst({
  duration = 0.08,
  volume = 0.18,
  highpass = 2000,
  lowpass = 9000,
  delay = 0,
}: {
  duration?: number;
  volume?: number;
  highpass?: number;
  lowpass?: number;
  delay?: number;
} = {}) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime + delay;
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = highpass;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lowpass;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(hp).connect(lp).connect(gain).connect(c.destination);
  src.start(now);
  src.stop(now + duration + 0.05);
}

export const sounds = {
  cardFlip() {
    noiseBurst({ duration: 0.06, volume: 0.12, highpass: 2500, lowpass: 7500 });
    tone({
      freq: 2200,
      endFreq: 900,
      duration: 0.06,
      type: "triangle",
      volume: 0.08,
    });
  },
  deal() {
    // quick series of flips simulating a card shuffle + deal
    for (let i = 0; i < 5; i++) {
      noiseBurst({
        duration: 0.05,
        volume: 0.1,
        highpass: 2600,
        lowpass: 8000,
        delay: i * 0.06,
      });
    }
    tone({
      freq: 720,
      endFreq: 1100,
      duration: 0.12,
      type: "triangle",
      volume: 0.09,
      delay: 0.35,
    });
  },
  check() {
    tone({
      freq: 520,
      endFreq: 380,
      duration: 0.08,
      type: "sine",
      volume: 0.14,
    });
    tone({
      freq: 520,
      endFreq: 380,
      duration: 0.08,
      type: "sine",
      volume: 0.1,
      delay: 0.09,
    });
  },
  fold() {
    noiseBurst({ duration: 0.18, volume: 0.18, highpass: 800, lowpass: 3500 });
    tone({
      freq: 320,
      endFreq: 120,
      duration: 0.18,
      type: "sawtooth",
      volume: 0.07,
    });
  },
  chip() {
    // short metallic click for a single chip
    tone({
      freq: 1400,
      endFreq: 900,
      duration: 0.05,
      type: "triangle",
      volume: 0.11,
    });
    noiseBurst({ duration: 0.04, volume: 0.12, highpass: 3500, lowpass: 9000 });
  },
  call() {
    // couple of chip clinks
    sounds.chip();
    setTimeout(() => sounds.chip(), 70);
  },
  bet() {
    // bigger stack of chips
    for (let i = 0; i < 4; i++) {
      setTimeout(() => sounds.chip(), i * 55);
    }
  },
  raise() {
    sounds.bet();
    tone({
      freq: 500,
      endFreq: 820,
      duration: 0.1,
      type: "triangle",
      volume: 0.08,
      delay: 0.25,
    });
  },
  win() {
    const c = getCtx();
    if (!c || muted) return;
    const base = c.currentTime;
    [
      { f: 523.25, d: 0.18, t: 0 },
      { f: 659.25, d: 0.18, t: 0.12 },
      { f: 783.99, d: 0.22, t: 0.24 },
      { f: 1046.5, d: 0.28, t: 0.36 },
    ].forEach(({ f, d, t }) => {
      tone({ freq: f, duration: d, type: "triangle", volume: 0.14, delay: t });
    });
    for (let i = 0; i < 10; i++) {
      setTimeout(() => sounds.chip(), 300 + i * 50);
    }
    // subtle applause noise
    noiseBurst({
      duration: 0.9,
      volume: 0.05,
      highpass: 1200,
      lowpass: 5500,
      delay: base - c.currentTime + 0.3,
    });
  },
  lose() {
    tone({
      freq: 380,
      endFreq: 180,
      duration: 0.35,
      type: "sawtooth",
      volume: 0.1,
    });
    tone({
      freq: 280,
      endFreq: 130,
      duration: 0.45,
      type: "sawtooth",
      volume: 0.08,
      delay: 0.18,
    });
  },
  buttonTap() {
    tone({
      freq: 760,
      endFreq: 620,
      duration: 0.05,
      type: "sine",
      volume: 0.09,
    });
  },
};

export function primeAudio() {
  getCtx();
}
