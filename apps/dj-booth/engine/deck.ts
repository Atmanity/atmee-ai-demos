// The booth's moves, pure: the page applies them and the player follows the deck.
import type { Deck, Track } from './types.ts';

/** The crate's track the host means by its number, or null. */
export function pick(deck: Deck, number: unknown): Track | null {
  const n = Math.round(Number(number));
  return Number.isFinite(n) && n >= 1 && n <= deck.crate.length ? deck.crate[n - 1] : null;
}

export const dig = (deck: Deck, dug: string, crate: Track[]): Deck => ({ ...deck, dug, crate });

/** The record on goes into what has played (once, by song), and `next` is on. */
const retire = (deck: Deck): Track[] =>
  deck.playing && !deck.played.some((t) => songOf(t) === songOf(deck.playing!)) ? [...deck.played, deck.playing] : deck.played;

export const playNow = (deck: Deck, track: Track): Deck => ({ ...deck, played: retire(deck), playing: track, paused: false });

/** A song as people know it: the title without its edit, remaster or mix, and the lead artist. */
export const songOf = (t: Track) =>
  `${t.title.toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim()}|${t.artist.toLowerCase().split(',')[0].trim()}`;

/** Whether a song has already played this show (in any release). */
export const playedTonight = (deck: Deck, track: Track) => deck.played.some((t) => songOf(t) === songOf(track));

/** Whether a track is on now or already in line: the same release, or another release of the same song. */
export const lined = (deck: Deck, track: Track) =>
  [deck.playing, ...deck.queue].some((t) => t && (t.id === track.id || songOf(t) === songOf(track)));

/** Lines a track up after the others; one on now or already in line is not lined up twice (the same deck comes back). */
export const queueNext = (deck: Deck, track: Track): Deck => (lined(deck, track) ? deck : { ...deck, queue: [...deck.queue, track] });

/** How soon after a record was put on "now" another "now" would cut it off. */
export const NOW_GUARD_MS = 20_000;

/**
 * Whether a "now" from the host should go in line instead: a record put on moments ago is
 * cut off only when the listener has asked for something since (a request plays at once).
 */
export const nowBecomesNext = (lastNowAt: number, lastListenerAt: number, at: number) =>
  at - lastNowAt < NOW_GUARD_MS && lastListenerAt < lastNowAt;

/** The next record on, out of the queue; nothing queued leaves the decks empty. */
export const advance = (deck: Deck): Deck => ({ ...deck, played: retire(deck), playing: deck.queue[0] ?? null, paused: false, queue: deck.queue.slice(1) });

export const setPaused = (deck: Deck, paused: boolean): Deck => (deck.playing ? { ...deck, paused } : deck);

export const label = (t: Track) => `"${t.title}" by ${t.artist}${t.year ? ` (${t.year})` : ''}`;
