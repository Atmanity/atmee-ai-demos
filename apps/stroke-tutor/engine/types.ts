// What the server and the page share. The page only ever sees a Snapshot: a
// stroke the learner has not earned (drawn correctly, or shown on request)
// arrives with no points, no name and no teaching line. Those ARE the answer
// to the question the board is asking, so they stay on the server.

export type Phase = 'intro' | 'writing' | 'coaching' | 'debrief';

export type StrokeStatus = 'done' | 'current' | 'hidden';

/** A point on the square grid (`Snapshot.grid` across, origin top left), never in pixels. */
export type GridPoint = [number, number];

export interface StrokeView {
  index: number;
  status: StrokeStatus;
  /** Empty unless `status` is "done": the server withholds it, not the page. */
  points: GridPoint[];
  /** How the teacher refers to it ("the horizontal"); only once earned. */
  name?: string;
  /** Its full lesson; only once earned. */
  teach?: string;
}

export interface CharacterView {
  id: string;
  glyph: string;
  meaning: string;
  reading: string;
  script: 'kanji' | 'latin';
  strokes_total: number;
}

export type VerdictKind = 'ok' | 'order' | 'direction' | 'start' | 'shape' | 'reveal';

export interface Verdict {
  ok: boolean;
  kind: VerdictKind;
  /** A sentence from the character data, said aloud unchanged in meaning. */
  note: string;
  revealed?: boolean;
  /** A stroke drawn backwards: which way they drew it and which way it goes, in plain words ("from the bottom up", "from the top down"). */
  travel?: { drawn: string; right: string };
}

export interface CatalogEntry {
  id: string;
  glyph: string;
  meaning: string;
  strokes_total: number;
}

/** How a resolved stroke was earned: drawn right on try N, or shown after N tries. Stroke numbers and counts only, never a shape. */
export interface StrokeResult {
  index: number;
  how: 'drawn' | 'shown';
  /** Graded attempts on it, the right one included. */
  tries: number;
}

export interface Snapshot {
  phase: Phase;
  character: CharacterView | null;
  stroke_index: number;
  strokes: StrokeView[];
  attempts: number;
  last_verdict: Verdict | null;
  /** Drawn right (on any try) of the strokes reached. Not a first-try count: that is `results`. */
  score: { correct: number; total: number };
  /** The record of this character's resolved strokes, in order. */
  results: StrokeResult[];
  /** The width AND height of the coordinate space. */
  grid: number;
  catalog: CatalogEntry[];
}

/**
 * What the page or the learner's words ask the board to do (the original
 * app's intents, by the same names). A `start_character` with no id starts the
 * character on the board over (or the first one, before any).
 */
export type Intent =
  | { kind: 'start_character'; id?: string }
  | { kind: 'stroke'; points: unknown }
  | { kind: 'reveal' }
  | { kind: 'next_stroke' }
  | { kind: 'next_character' }
  | { kind: 'clear_attempt' };

export type IntentKind = Intent['kind'];

/** The page's buttons; each runs the tool Ren would call for the same request. */
export type Command = 'show' | 'next' | 'another' | 'over' | 'choose';

export interface Outcome {
  view: Snapshot;
  /** Whether the input was a board action; a typed line that wasn't goes to the avatar as-is. */
  handled: boolean;
  kind?: IntentKind;
  /** The board refused it; this sentence is shown, and said when the learner asked in words. */
  refused?: string;
  /** What the avatar should be told about it, in its own words. */
  event?: string;
}

/** What the learner is told about the last verdict, in a word. */
export const VERDICT_LABEL: Record<VerdictKind, string> = {
  ok: 'Correct',
  order: 'Wrong order',
  direction: 'Wrong direction',
  start: 'Wrong starting point',
  shape: 'Not that stroke',
  reveal: 'Shown to you',
};
