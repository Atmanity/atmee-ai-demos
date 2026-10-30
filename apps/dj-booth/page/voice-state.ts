// Nova's voice under playback control: where each delivery plays, and whether she is talking,
// from the deliveries themselves. Her audio comes seconds ahead of its playing, so how loud it is
// as it arrives says nothing about now: she talks from a delivery's start (it began to play, in
// the page or through the face) to its end (played out or cut), and is quiet since the last end.

export type VoiceOutput = 'face' | 'page';

/** Where a delivery plays, decided once as it opens: through the face while it is up and wanted, else here. */
export const deliveryOutput = (facePhase: string, faceOff: boolean): VoiceOutput =>
  facePhase === 'live' && !faceOff ? 'face' : 'page';

export class Talking {
  private playing = new Set<number>();
  /** Deliveries that are over: a late start for one (a face beginning the next) does not count. */
  private over = new Set<number>();
  /** When the last delivery ended (by `now`); 0 before any. */
  quietSince = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get talking(): boolean { return this.playing.size > 0; }

  /** A delivery began to play; true when that starts her talking. */
  started(delivery: number): boolean {
    if (this.over.has(delivery)) return false;
    const was = this.talking;
    this.playing.add(delivery);
    return !was;
  }

  /** A delivery is over; true when that leaves her quiet. One that never began changes nothing. */
  finished(delivery: number): boolean {
    this.over.add(delivery);
    if (this.over.size > 16) this.over.delete(this.over.values().next().value!);
    if (!this.playing.delete(delivery)) return false;
    if (this.talking) return false;
    this.quietSince = this.now();
    return true;
  }

  /** How long she has been quiet, in milliseconds; 0 while she talks. */
  quietFor(): number {
    return this.talking ? 0 : this.now() - this.quietSince;
  }
}

/** What the cue pump knows when it may send: Nova's voice now, and when her last refusal was. */
export interface CueMoment { talking: boolean; quietForMs: number; now: number; retryAt: number }

/** How long a cue waits after its refusal, and how long she must have been quiet for one. */
export const RETRY_MS = 1500;
export const TYPED_RETRY_MS = 500;
export const QUIET_FOR_CUE_MS = 800;

/**
 * Whether a cue may go now. Causeur refuses commentary while she is speaking, a typed turn too
 * (it waits for her, it does not cut her off). A cue waits for a quiet moment; a typed turn goes at
 * once, the listener is waiting, and once refused waits only for her to stop, not a quiet spell,
 * rather than being sent again and refused every few hundred milliseconds while she talks.
 */
export function cueMayGo(cue: { typed: boolean; refused?: boolean }, at: CueMoment): boolean {
  if (cue.typed) return !cue.refused || (!at.talking && at.now >= at.retryAt);
  return !at.talking && at.quietForMs >= QUIET_FOR_CUE_MS && at.now >= at.retryAt;
}

/** When a refused cue may be sent again. */
export const retryAfter = (cue: { typed: boolean }, now: number) => now + (cue.typed ? TYPED_RETRY_MS : RETRY_MS);
