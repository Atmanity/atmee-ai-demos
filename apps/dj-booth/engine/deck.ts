// The booth's moves, pure: the page applies them and the player follows the deck.
import type { Deck, Track } from './types.ts';

/** The crate's track the host means by its number, or null. */
export function pick(deck: Deck, number: unknown): Track | null {
  const n = Math.round(Number(number));
  return Number.isFinite(n) && n >= 1 && n <= deck.crate.length ? deck.crate[n - 1] : null;
}

export const dig = (deck: Deck, dug: string, crate: Track[]): Deck => ({ ...deck, dug, crate });

export const playNow = (deck: Deck, track: Track): Deck => ({ ...deck, playing: track, paused: false });

/** A song as people know it: the title without its edit, remaster or mix, and the lead artist. */
export const songOf = (t: Track) =>
  `${t.title.toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim()}|${t.artist.toLowerCase().split(',')[0].trim()}`;

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
export const advance = (deck: Deck): Deck => ({ ...deck, playing: deck.queue[0] ?? null, paused: false, queue: deck.queue.slice(1) });

export const setPaused = (deck: Deck, paused: boolean): Deck => (deck.playing ? { ...deck, paused } : deck);

export const label = (t: Track) => `"${t.title}" by ${t.artist}${t.year ? ` (${t.year})` : ''}`;

/**
 * What the listener's own words clearly ask the decks to do, for the page to do itself when
 * the host does not call the tool (useToolNet). Only plain asks; anything vaguer is the host's.
 */
export function listenerWants(text: string): 'skip_track' | 'pause_music' | 'resume_music' | null {
  const t = text.toLowerCase();
  if (/\b(skip|next (song|track|record|one)|change (the |this )?(song|track|record|music)|another (song|track|record)|(don'?t|do not) like (this|it)|not this (song|one))\b/.test(t)) return 'skip_track';
  if (/\b(resume|unpause|carry on|keep playing|play (it|the music) again)\b/.test(t)) return 'resume_music';
  if (/\b(pause|stop the music|music off)\b/.test(t)) return 'pause_music';
  return null;
}
