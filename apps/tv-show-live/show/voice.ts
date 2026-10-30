// An avatar's voice as the speech session sends it: one continuous stream of
// 24 kHz mono PCM16 in 20 ms frames, silence included, in real time. Its face
// (an avatar-only render) takes 16 kHz PCM (createResampler); the page streams
// it the whole voice as one piece. createVoice finds the stretches of speech in
// it (on at the first sound, off after a moment of quiet): when the avatar
// speaks, for the booth and the transcript.
import { Resampler24to16 } from '../../../src/avatar/pcm.ts';

export const SPEECH_RATE = 24_000;
export const FACE_RATE = 16_000;
/** Below this peak a frame counts as silence (PCM16; the session pads with digital zeros). */
export const QUIET_PEAK = 300;
/** Quiet this long closes a piece: shorter than a pause between sentences would split every reply. */
export const PIECE_QUIET_MS = 600;

export const isQuiet = (frame: Int16Array, peak = QUIET_PEAK) => {
  for (let i = 0; i < frame.length; i++) if (frame[i] > peak || frame[i] < -peak) return false;
  return true;
};

/**
 * 24 kHz to 16 kHz (2 samples out for every 3 in), keeping its place across frames. Filtered
 * (the kit's resampler): sound above 8 kHz, the hiss of an "s", is taken out rather than folded
 * back down into what the face plays, as plain interpolation would.
 */
export function createResampler() {
  const resampler = new Resampler24to16();
  return (input: Int16Array): Int16Array => resampler.push(input);
}

export interface VoiceEvents {
  /** The avatar started speaking: a new piece for its face. */
  onStart(): void;
  /** One frame of the piece, at the face's rate. */
  onFrame(pcm: Int16Array): void;
  /** The piece is over: the avatar has been quiet for PIECE_QUIET_MS. */
  onEnd(): void;
}

/** Feeds one avatar's 24 kHz frames, in order, and reports its pieces at 16 kHz. */
export function createVoice(events: VoiceEvents, quietMs = PIECE_QUIET_MS) {
  const resample = createResampler();
  let open = false;
  let quietSamples = 0;
  const quietLimit = (quietMs / 1000) * SPEECH_RATE;
  return {
    feed(frame: Int16Array) {
      const pcm = resample(frame);
      const quiet = isQuiet(frame);
      if (!open) {
        if (quiet) return;
        open = true;
        quietSamples = 0;
        events.onStart();
      }
      events.onFrame(pcm);
      quietSamples = quiet ? quietSamples + frame.length : 0;
      if (quietSamples >= quietLimit) {
        open = false;
        events.onEnd();
      }
    },
    get speaking() { return open; },
    /** Closes an open piece (the session ended mid-sentence). */
    flush() {
      if (!open) return;
      open = false;
      events.onEnd();
    },
  };
}
