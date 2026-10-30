// A playback-control delivery played by an avatar-only face instead of in the page: its 24 kHz
// audio goes to the face's renderer as it comes (resampled to the 16 kHz the face takes), and
// what the renderer reports becomes the server's acknowledgments, as full-stack's own client
// does for its renderer. A face holds whatever it is sent, so a reply that comes seconds ahead of
// real time is a cushion there, not a gap.
//
// The server's rules (LIVE_API.md, "Playback control for a public client") decide every report:
// - played out: `finished`, not interrupted, every sample sent;
// - after the server's `clear` (and only then): `finished`, interrupted, where the face got to,
//   for a delivery that had already played out too;
// - cut by the face on its own, or never reported: no usable position, which the server settles
//   from its own estimate. A claim of `interrupted` without a clear would end the session.
import { Resampler24to16 } from '../avatar/pcm.ts';
import type { Played, SpeechWriter } from '../avatar/render.ts';
import { playbackAck, type Delivery, type PlaybackAck } from './protocol.ts';

/** The voice's rate, which acknowledgments count in. */
const RATE = 24_000;

/** What a face gives a delivery: a piece to write (16 kHz), and a way to cut what it is saying. */
export interface Face {
  open(): Promise<SpeechWriter>;
  interrupt(): Promise<void>;
}

export class FaceDelivery {
  /** Samples of the voice (24 kHz) sent to the face. */
  private sent = 0;
  private readonly resampler = new Resampler24to16();
  private readonly writer: Promise<SpeechWriter | null>;
  /** The writes in order, each after the one before (only the writes: a clear waits for them). */
  private writes: Promise<unknown>;
  /** The piece closed, waiting for the face's report of it. */
  private ending: Promise<Played> | null = null;
  private ended = false;
  private clearing = false;
  private startedSent = false;
  /** Samples reported played once it played out; -1 until then, or when it had no position. */
  private playedOut = -1;
  private done = false;

  constructor(face: Face, readonly delivery: Delivery, private readonly send: (event: Record<string, unknown>) => void,
    private readonly cut: () => Promise<void> = () => face.interrupt()) {
    this.writer = face.open().catch(() => null);
    this.writes = this.writer;
  }

  /** The face began to play it (its renderer's lk.playback_started). */
  started(): void {
    if (this.startedSent || this.done || this.clearing) return;
    this.startedSent = true;
    this.ack({ status: 'started' });
  }

  /** More of the delivery's audio, as it comes. */
  push(pcm: Int16Array): void {
    if (this.ended || this.clearing || this.done || !pcm.length) return;
    this.sent += pcm.length;
    const face = this.resampler.push(pcm);
    this.writes = this.writes.then(async () => {
      const writer = await this.writer;
      if (writer && face.length && !this.clearing) await writer.write(face);
    }).catch(() => {});
  }

  /** All of the delivery's audio has come: the piece closes, and is reported once the face played it. */
  end(): void {
    if (this.ended || this.clearing || this.done) return;
    this.ended = true;
    void this.writes.then(async () => {
      const writer = await this.writer;
      if (!writer) return this.noPosition();
      this.ending ??= writer.end();
      const played = await this.ending;
      if (this.clearing || this.done) return;
      if (played.interrupted) return this.noPosition();
      this.done = true;
      this.playedOut = this.sent;
      this.ack({ status: 'finished', played_samples: this.sent, interrupted: false });
    }).catch(() => this.noPosition());
  }

  /** The server's clear: the face stops, and the server is told where it got to. */
  async clear(): Promise<void> {
    if (this.done) {
      // Played out before the clear came: answered with all of it, as the server waits for.
      if (this.playedOut >= 0) this.ack({ status: 'finished', played_samples: this.playedOut, interrupted: true });
      return;
    }
    if (this.clearing) return;
    this.clearing = true;
    const writer = await this.writer;
    if (!writer) return this.finishCut(0, 'not_submitted');
    await this.writes;
    // Closed first, so the face's report of the cut settles this piece; then cut.
    this.ending ??= writer.end();
    await this.cut().catch(() => {});
    const played = await this.ending.catch(() => ({ interrupted: true, position: 0 }));
    if (this.done) return;
    const count = played.interrupted ? Math.min(this.sent, Math.max(0, Math.round(played.position * RATE))) : this.sent;
    this.finishCut(count, 'renderer_reported');
  }

  private finishCut(played: number, source: 'renderer_reported' | 'not_submitted'): void {
    if (this.done) return;
    this.done = true;
    this.playedOut = played;
    this.ack({ status: 'finished', played_samples: source === 'not_submitted' ? 0 : played, interrupted: true, position_source: source });
  }

  private noPosition(): void {
    if (this.done || this.clearing) return;
    this.done = true;
    this.ack({ status: 'finished', played_samples: 0, interrupted: false, position_source: 'unavailable' });
  }

  private ack(ack: PlaybackAck): void {
    this.send(playbackAck(this.delivery, ack));
  }
}
