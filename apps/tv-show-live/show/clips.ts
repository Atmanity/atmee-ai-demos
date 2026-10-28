// Spotting Causeur's filler clips by their sound. While a reply's audio runs
// dry, Causeur plays a stock noise ("uh", "hmm", "I mean", a sigh, a cleared
// throat). Each voice's noises are made once and cached across sessions, so
// every time one plays, the same samples come out; its words reach the
// transcript late or not at all (bracketed sounds are left out of it), too late
// for the filler gate to go by. Speech never repeats sample for sample, so a
// sound this voice has made before, exactly, is one of them.
//
// The voice is fingerprinted as it comes, in WINDOW-long stretches taken
// wherever their running sum says (about 375 a second, the same places
// whatever the chunking): a stretch seen before, or known for this avatar
// from earlier shows, is a filler; the spotter reports the span it covers.

/** 50 ms at Causeur's 24 kHz. */
export const WINDOW = 1_200;
/** Stretches closer than this to their earlier sighting are the same sound still playing, not a replay. */
const REPLAY_AFTER = 24_000;
/** Silence is no fingerprint: every pause would match every other. */
const QUIET = 300;
/** How many stretches a voice remembers before it starts again (about 15 minutes of speech). */
const MEMORY = 350_000;

export interface Span { from: number; to: number }

export interface ClipSpotter {
  /** The voice's next samples; returns the spans (in samples since the first) that are a filler clip. */
  feed(pcm: Int16Array): Span[];
  /** Fingerprints first seen replayed since the last call: for the avatar's record. */
  learned(): string[];
}

export function createClipSpotter(known: Set<string> = new Set()): ClipSpotter {
  const seen = new Map<string, number>();
  const fresh: string[] = [];
  const ring = new Int16Array(WINDOW);
  let n = 0;      // samples so far
  let sum = 0;    // of the last WINDOW samples

  return {
    feed(pcm) {
      const spans: Span[] = [];
      for (let k = 0; k < pcm.length; k++, n++) {
        const v = pcm[k];
        sum += v - ring[n % WINDOW];
        ring[n % WINDOW] = v;
        if (n < WINDOW - 1 || (sum & 63) !== 0) continue;
        let peak = 0;
        let f = 2166136261;
        for (let j = 1; j <= WINDOW; j++) {
          const s = ring[(n + j) % WINDOW];
          if (s > peak) peak = s; else if (-s > peak) peak = -s;
          f = Math.imul(f ^ (s & 0xffff), 16777619) >>> 0;
        }
        if (peak < QUIET) continue;
        const key = `${sum}:${f}`;
        const before = seen.get(key);
        if (!known.has(key) && before !== undefined && n - before >= REPLAY_AFTER) {
          known.add(key);
          fresh.push(key);
        }
        if (seen.size >= MEMORY) seen.clear();
        seen.set(key, n);
        if (known.has(key)) {
          const span = { from: n - WINDOW + 1, to: n + 1 };
          const last = spans[spans.length - 1];
          if (last && span.from <= last.to) last.to = span.to;
          else spans.push(span);
        }
      }
      return spans;
    },
    learned() { return fresh.splice(0); },
  };
}
