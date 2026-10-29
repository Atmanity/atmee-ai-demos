export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  durationMs: number;
  /** A small cover for lists (about 300 px). */
  art: string | null;
  /** The biggest cover (about 640 px), for the stage. */
  cover: string | null;
}

/** The booth as the page holds it: the last search, the record on, and what is lined up. */
export interface Deck {
  /** The last search's tracks, numbered from 1 for the host. */
  crate: Track[];
  /** What the crate was searched for. */
  dug: string;
  playing: Track | null;
  paused: boolean;
  queue: Track[];
}

export const emptyDeck: Deck = { crate: [], dug: '', playing: null, paused: false, queue: [] };
