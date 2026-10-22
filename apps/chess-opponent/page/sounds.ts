// Procedural sound effects for the chess board, ported unchanged from the
// source panel. Everything is synthesised from an AudioContext: the panel is
// sandboxed with no network, so an audio asset would have to be inlined into
// the bundle, and these cost nothing.
//
// `localStorage` is wrapped in try/catch because the panel's iframe has an
// opaque origin (sandbox without allow-same-origin), where reading it throws
// rather than returning null. Muted by default, as in the source — a board
// that starts making noise inside a video call is not a good first impression.

let ctx: AudioContext | null = null;
let muted = true;
const MUTE_KEY = 'chess.sounds.muted';

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

try {
  const stored = localStorage.getItem(MUTE_KEY);
  if (stored !== null) muted = stored === '1';
} catch {
  // ignore
}

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // ignore
  }
}

type ToneOptions = {
  freq: number;
  endFreq?: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  release?: number;
  delay?: number;
};

function tone(opts: ToneOptions) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(opts.endFreq, 1), now + opts.duration);
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
  duration = 0.05,
  volume = 0.12,
  highpass = 2000,
  lowpass = 9000,
  delay = 0,
}: { duration?: number; volume?: number; highpass?: number; lowpass?: number; delay?: number } = {}) {
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
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
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
  move() {
    tone({ freq: 700, endFreq: 420, duration: 0.06, type: 'triangle', volume: 0.1 });
    noiseBurst({ duration: 0.04, volume: 0.08, highpass: 2400, lowpass: 8000 });
  },
  capture() {
    noiseBurst({ duration: 0.12, volume: 0.18, highpass: 1200, lowpass: 6000 });
    tone({ freq: 320, endFreq: 160, duration: 0.12, type: 'sawtooth', volume: 0.08 });
  },
  check() {
    tone({ freq: 880, endFreq: 660, duration: 0.1, type: 'square', volume: 0.12 });
    tone({ freq: 880, endFreq: 660, duration: 0.1, type: 'square', volume: 0.1, delay: 0.12 });
  },
  castle() {
    tone({ freq: 520, endFreq: 760, duration: 0.08, type: 'triangle', volume: 0.1 });
    tone({ freq: 760, endFreq: 520, duration: 0.08, type: 'triangle', volume: 0.1, delay: 0.09 });
  },
  win() {
    const c = getCtx();
    if (!c || muted) return;
    [
      { f: 523.25, d: 0.18, t: 0 },
      { f: 659.25, d: 0.18, t: 0.12 },
      { f: 783.99, d: 0.22, t: 0.24 },
      { f: 1046.5, d: 0.28, t: 0.36 },
    ].forEach(({ f, d, t }) => {
      tone({ freq: f, duration: d, type: 'triangle', volume: 0.14, delay: t });
    });
  },
  lose() {
    tone({ freq: 380, endFreq: 180, duration: 0.35, type: 'sawtooth', volume: 0.1 });
    tone({ freq: 280, endFreq: 130, duration: 0.45, type: 'sawtooth', volume: 0.08, delay: 0.18 });
  },
  draw() {
    tone({ freq: 440, duration: 0.22, type: 'sine', volume: 0.1 });
    tone({ freq: 440, duration: 0.22, type: 'sine', volume: 0.08, delay: 0.24 });
  },
  buttonTap() {
    tone({ freq: 760, endFreq: 620, duration: 0.05, type: 'sine', volume: 0.09 });
  },
};

export function primeAudio() {
  getCtx();
}
