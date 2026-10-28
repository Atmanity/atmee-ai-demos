// Keeping the speech model's fillers off the faces. At the end of a turn, and
// while it waits for the other one, the model says "yeah uh uhhh ummm oh" or a
// lone "hmm" (part of how it hands over a call; a public session cannot turn it
// off). Each voice reaches its face DELAY_MS late, through this gate, and the
// transcript's words decide meanwhile: a filler word at the start of a sentence
// (or of a stretch of speech) marks the audio from then on as filler; a real
// word arriving while that audio is still in the gate unmarks it, so "Yeah, the
// light was..." plays whole; marked audio that leaves the gate goes out as
// silence. The delay is fixed, so nothing drifts.
export const DELAY_MS = 1_500;
// Words can arrive a little after the sound they name: marking reaches this far back.
export const LOOKBACK_MS = 300;
// Sound cut to silence, or back, ramps over this many samples (10 ms at 24 kHz): cut on the spot, it clicked.
export const FADE_SAMPLES = 240;

const FILLER_WORD = /^(?:u+h+m*|u+m+|h+m+|m+h*m+|e+r+m+|e+h+|a+h+|o+h+|yeah|ha|haha|ok|okay|well|so|i|mean|you|know|but|right)$/i;
const isFiller = (w: string) => FILLER_WORD.test(w);
// A pure hesitation is never a word anyone means, so it goes wherever it falls, mid-sentence too
// ("we used, uh, three silks"); its word arrives about 0.1-0.6 s after its sound starts.
const HESITATION = /^(?:u+h+m*|u+m+|h+m+|m+h*m+|e+r+m+|e+h+|a+h+)$/i;
export const HESITATION_LOOKBACK_MS = 200;

export interface Frame { pcm: Int16Array; at: number; filler: boolean; clip?: boolean; muted?: boolean }

export interface FillerGate {
  /** A frame of the voice, as it is made (`muted`: not to be heard, whatever it says). Returns the frames due at the face now, in order. */
  push(pcm: Int16Array, now: number, muted?: boolean): Int16Array[];
  /** Words of the voice, as they come. */
  words(delta: string, now: number): void;
  /** A stretch of speech begins (after a pause). */
  stretch(): void;
  /** The audio made from `from` to `to` (a filler clip, by its sound) goes out as silence, whatever its words. */
  silence(from: number, to: number): void;
}

export function createFillerGate(): FillerGate {
  const queue: Frame[] = [];
  let sentenceStart = true;      // the next word starts a sentence (or a stretch)
  let fillerSince: number | null = null;   // marking from then on, while only fillers have come
  let hesitationSince: number | null = null;   // within that, a hesitation from then on: never unmarked

  let clipUntil = -Infinity;   // audio made until then is a filler clip
  const mark = (from: number, on: boolean) => { for (const f of queue) if (f.at >= from) f.filler = on; };
  let silent = false;   // the last frame out was silence (the stream itself starts in silence)
  const ramp = (pcm: Int16Array, down: boolean) => {
    const out = new Int16Array(pcm.length);
    const n = Math.min(FADE_SAMPLES, pcm.length);
    for (let i = 0; i < n; i++) out[i] = Math.round(pcm[i] * (down ? 1 - i / n : i / n));
    if (!down) out.set(pcm.subarray(n), n);
    return out;
  };

  return {
    push(pcm, now, muted = false) {
      queue.push({ pcm, at: now, filler: fillerSince !== null, clip: now <= clipUntil, muted });
      const out: Int16Array[] = [];
      while (queue.length && queue[0].at <= now - DELAY_MS) {
        const f = queue.shift()!;
        const quiet = f.filler || f.clip || f.muted;
        out.push(quiet ? (silent ? new Int16Array(f.pcm.length) : ramp(f.pcm, true)) : silent ? ramp(f.pcm, false) : f.pcm);
        silent = !!quiet;
      }
      return out;
    },
    words(delta, now) {
      for (const raw of delta.split(/\s+/)) {
        const w = raw.replace(/[^\p{L}']/gu, '');
        if (w) {
          if (isFiller(w)) {
            if (sentenceStart && fillerSince === null) { fillerSince = now - LOOKBACK_MS; mark(fillerSince, true); }
            if (HESITATION.test(w) && hesitationSince === null) {
              hesitationSince = now - HESITATION_LOOKBACK_MS;
              if (fillerSince === null) { fillerSince = hesitationSince; mark(fillerSince, true); }
            }
          } else {
            // A real word: what came before it was meant ("Yeah, the light...") unless it was a
            // hesitation, which stays silent up to where this word's sound begins.
            if (fillerSince !== null) {
              const wordFrom = now - LOOKBACK_MS;
              for (const f of queue) {
                if (f.at < fillerSince) continue;
                f.filler = hesitationSince !== null && f.at >= hesitationSince && f.at < wordFrom;
              }
              fillerSince = hesitationSince = null;
            }
            sentenceStart = false;
          }
        }
        if (/[.!?…]$/.test(raw)) sentenceStart = true;
      }
    },
    stretch() { sentenceStart = true; },
    silence(from, to) {
      for (const f of queue) if (f.at >= from && f.at <= to) f.clip = true;
      clipUntil = Math.max(clipUntil, to);
    },
  };
}
