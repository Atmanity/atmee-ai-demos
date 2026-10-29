// Auto-booking: the show books its next guest from the conversation, the way
// a producer would, without anyone typing a description. After the guest's
// answers on air (once they have been on BOOK_AFTER_MS, at most every
// ASK_EVERY_MS), a model reads the last lines and says whether there is a
// natural reason to bring on another of the film's makers now (the guest keeps
// mentioning a collaborator, a thread someone else could answer) and, if so,
// describes them. A build takes minutes, so it books early; the page brings
// the guest on at a natural moment once they are ready. At most MAX_GUESTS a
// show, one being made at a time, none after the wrap.
import type { Line } from './advance.ts';

export const BOOK_AFTER_MS = 60_000;
export const ASK_EVERY_MS = 45_000;
export const MAX_GUESTS = 3;
export const WINDOW = 10;

export interface Booking { book: boolean; description: string; reason: string }

export interface BookerOptions {
  ask(lines: Line[], guests: string[]): Promise<Booking>;
  book(description: string, reason: string): void;
  /** Auto-booking on, the guest on air, the wrap not asked for, no guest being made now. */
  enabled(): boolean;
  /** Every guest of the show so far (on air, gone, or being made). */
  guests(): string[];
  now?: () => number;
}

export interface Booker {
  /** A guest is on air from now (the opening guest, or a new one after a handover). */
  guestOn(): void;
  /** A line went on air. */
  line(line: Line): void;
}

export function createBooker(opts: BookerOptions): Booker {
  const now = opts.now ?? Date.now;
  const lines: Line[] = [];
  let onSince: number | null = null;
  let lastAsk = -Infinity;
  let asking = false;

  const ask = async () => {
    if (asking || onSince === null || !opts.enabled()) return;
    if (now() - onSince < BOOK_AFTER_MS || now() - lastAsk < ASK_EVERY_MS) return;
    if (opts.guests().length >= MAX_GUESTS) return;
    asking = true;
    lastAsk = now();
    let booking: Booking;
    try {
      booking = await opts.ask(lines.slice(-WINDOW), opts.guests());
    } catch {
      return;   // no verdict: asked again after ASK_EVERY_MS
    } finally {
      asking = false;
    }
    if (!booking.book || !booking.description.trim() || !opts.enabled() || opts.guests().length >= MAX_GUESTS) return;
    opts.book(booking.description.trim(), booking.reason);
  };

  return {
    guestOn() { onSince = now(); },
    line(line) {
      lines.push(line);
      if (lines.length > WINDOW * 2) lines.splice(0, lines.length - WINDOW);
      if (line.who === 'guest') void ask();
    },
  };
}
