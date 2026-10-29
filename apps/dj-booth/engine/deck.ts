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

/** The next record on, out of the queue; nothing queued leaves the decks empty. */
export const advance = (deck: Deck): Deck => ({ ...deck, played: retire(deck), playing: deck.queue[0] ?? null, paused: false, queue: deck.queue.slice(1) });

export const setPaused = (deck: Deck, paused: boolean): Deck => (deck.playing ? { ...deck, paused } : deck);

export const label = (t: Track) => `"${t.title}" by ${t.artist}${t.year ? ` (${t.year})` : ''}`;

/** A change of vibe: the host's own picks leave the line, what the listener asked for stays. */
export const clearHostPicks = (deck: Deck, askedFor: (t: Track) => boolean): Deck => ({ ...deck, queue: deck.queue.filter(askedFor) });

/** How long a listener's ask stays open for the host to act on (a search and a reply can take a while). */
export const ASK_OPEN_MS = 90_000;

/**
 * Whether the host acting now is acting on the listener's ask: they spoke since the last record
 * the host put on for them, and not too long ago. One ask, one change: it is used up when the
 * host puts a record on "now".
 */
export const askOpen = (askedAt: number, usedAt: number, at: number) => askedAt > usedAt && at - askedAt <= ASK_OPEN_MS;
