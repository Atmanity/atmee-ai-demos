// The booth's moves, pure: the page applies them and the player follows the deck.
import type { Deck, Track } from './types.ts';

/** The crate's track the host means by its number, or null. */
export function pick(deck: Deck, number: unknown): Track | null {
  const n = Math.round(Number(number));
  return Number.isFinite(n) && n >= 1 && n <= deck.crate.length ? deck.crate[n - 1] : null;
}

export const dig = (deck: Deck, dug: string, crate: Track[]): Deck => ({ ...deck, dug, crate });

export const playNow = (deck: Deck, track: Track): Deck => ({ ...deck, playing: track, paused: false });

/** Lines a track up after the others; the same track twice in a row is kept once. */
export const queueNext = (deck: Deck, track: Track): Deck =>
  deck.queue.at(-1)?.id === track.id ? deck : { ...deck, queue: [...deck.queue, track] };

/** The next record on, out of the queue; nothing queued leaves the decks empty. */
export const advance = (deck: Deck): Deck => ({ ...deck, playing: deck.queue[0] ?? null, paused: false, queue: deck.queue.slice(1) });

export const setPaused = (deck: Deck, paused: boolean): Deck => (deck.playing ? { ...deck, paused } : deck);

export const label = (t: Track) => `"${t.title}" by ${t.artist}${t.year ? ` (${t.year})` : ''}`;
