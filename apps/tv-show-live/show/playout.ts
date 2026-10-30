// One avatar's replies under playback control, played back on the page's own clock. The speech
// server sends each reply (a delivery) as fast as the voice makes it; the faces hold it and play
// it at their pace (src/speech/face.ts). Everything else on the page was tuned to the voice as it
// came in real time: when an avatar speaks (its voice's stretches), the floor, the booth, the
// director, the other avatar hearing it (copy A, whose input refuses audio far ahead of real
// time). This replays the deliveries in 20 ms frames, silence between them, as the paced voice
// came, from audio already on the page: a stall on the way is no longer a gap in any of that.
export const FRAME = 480;                                 // 20 ms at 24 kHz

export interface PlayoutFrame {
  frame: Int16Array;
  /** The delivery whose first sample is in this frame. */
  started?: number;
  /** The delivery whose last sample is in this frame: played out here, `played` samples of it. */
  finished?: { id: number; played: number };
}

interface Entry { id: number; pcm: Int16Array[]; at: number; played: number; ended: boolean; started: boolean }

export class LocalPlayout {
  private entries: Entry[] = [];
  /** How much of each delivery that played out here played, the latest few: a clear may still come for one. */
  private done = new Map<number, number>();

  /** A delivery played out: kept a while, as the server answers a clear for it with all of it. */
  private playedOut(e: Entry): void {
    this.done.set(e.id, e.played);
    for (const id of this.done.keys()) if (this.done.size > 5) this.done.delete(id);
  }

  open(id: number): void {
    if (!this.entries.some((e) => e.id === id)) this.entries.push({ id, pcm: [], at: 0, played: 0, ended: false, started: false });
  }

  push(id: number, pcm: Int16Array): void {
    const e = this.entries.find((x) => x.id === id);
    if (e && !e.ended && pcm.length) e.pcm.push(pcm);
  }

  end(id: number): void {
    const e = this.entries.find((x) => x.id === id);
    if (e) e.ended = true;
  }

  /** The server cleared it: the rest is not played. How much of it was (all of it, if it had played out). */
  clear(id: number): number {
    const at = this.entries.findIndex((x) => x.id === id);
    if (at < 0) return this.done.get(id) ?? 0;
    const [e] = this.entries.splice(at, 1);
    return e.played;
  }

  /** Samples of the delivery played so far, on this clock. */
  played(id: number): number {
    return this.entries.find((x) => x.id === id)?.played ?? 0;
  }

  /** The next 20 ms: the oldest delivery's audio where there is some, silence otherwise. */
  next(): PlayoutFrame {
    const out: PlayoutFrame = { frame: new Int16Array(FRAME) };
    let filled = 0;
    while (filled < FRAME && this.entries.length) {
      const e = this.entries[0];
      if (!e.pcm.length) {
        // Played out, and all of it came: the next delivery may follow in the same frame.
        if (e.ended) {
          if (e.started) out.finished = { id: e.id, played: e.played };
          this.playedOut(e);
          this.entries.shift();
          continue;
        }
        break;                                            // the voice is slower than real time: silence until more comes
      }
      if (!e.started) { e.started = true; out.started = e.id; }
      const head = e.pcm[0];
      const take = Math.min(FRAME - filled, head.length - e.at);
      out.frame.set(head.subarray(e.at, e.at + take), filled);
      filled += take;
      e.at += take;
      e.played += take;
      if (e.at === head.length) { e.pcm.shift(); e.at = 0; }
    }
    // One that ended with nothing left in it after this frame: played out now.
    const first = this.entries[0];
    if (first && first.ended && !first.pcm.length && first.started && !out.finished) {
      out.finished = { id: first.id, played: first.played };
      this.playedOut(first);
      this.entries.shift();
    }
    return out;
  }
}
