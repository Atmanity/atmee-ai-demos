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
  /** When the last delivery ended (by `now`); 0 before any. */
  quietSince = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get talking(): boolean { return this.playing.size > 0; }

  /** A delivery began to play; true when that starts her talking. */
  started(delivery: number): boolean {
    const was = this.talking;
    this.playing.add(delivery);
    return !was;
  }

  /** A delivery is over; true when that leaves her quiet. One that never began changes nothing. */
  finished(delivery: number): boolean {
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
