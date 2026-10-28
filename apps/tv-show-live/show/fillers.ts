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

const FILLER_WORD = /^(?:u+h+m*|u+m+|h+m+|m+h*m+|e+r+m+|e+h+|a+h+|o+h+|yeah|ha|haha|ok|okay|well|so|i|mean|you|know|but|right)$/i;
const isFiller = (w: string) => FILLER_WORD.test(w);

export interface Frame { pcm: Int16Array; at: number; filler: boolean }

export interface FillerGate {
  /** A frame of the voice, as it is made. Returns the frames due at the face now, in order. */
  push(pcm: Int16Array, now: number): Int16Array[];
  /** Words of the voice, as they come. */
  words(delta: string, now: number): void;
  /** A stretch of speech begins (after a pause). */
  stretch(): void;
}

export function createFillerGate(): FillerGate {
  const queue: Frame[] = [];
  let sentenceStart = true;      // the next word starts a sentence (or a stretch)
  let fillerSince: number | null = null;   // marking from then on, while only fillers have come

  const mark = (from: number, on: boolean) => { for (const f of queue) if (f.at >= from) f.filler = on; };

  return {
    push(pcm, now) {
      queue.push({ pcm, at: now, filler: fillerSince !== null });
      const out: Int16Array[] = [];
      while (queue.length && queue[0].at <= now - DELAY_MS) {
        const f = queue.shift()!;
        out.push(f.filler ? new Int16Array(f.pcm.length) : f.pcm);
      }
      return out;
    },
    words(delta, now) {
      for (const raw of delta.split(/\s+/)) {
        const w = raw.replace(/[^\p{L}']/gu, '');
        if (w) {
          if (isFiller(w)) {
            if (sentenceStart && fillerSince === null) { fillerSince = now - LOOKBACK_MS; mark(fillerSince, true); }
          } else {
            if (fillerSince !== null) { mark(fillerSince, false); fillerSince = null; }
            sentenceStart = false;
          }
        }
        if (/[.!?…]$/.test(raw)) sentenceStart = true;
      }
    },
    stretch() { sentenceStart = true; },
  };
}
