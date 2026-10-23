// How each stroke on the sheet was earned, as the page saw it happen: drawn
// by the learner (with their own ink, which the sheet then keeps) or shown by
// Ren (drawn in the teacher's vermilion). The server's snapshot says only
// which strokes are done; this is the page's own memory of the lesson, for the
// sheet's two inks and the summary at the end. View state: it never crosses
// the network, and a stroke the server does not call done is never in it.
import type { GridPoint } from './ink.ts';
import type { Snapshot } from '../engine/types.ts';

export interface Mark {
  how: 'drawn' | 'shown';
  /** Attempts it took: the try that was right, or the misses before it was shown. */
  tries: number;
  /** Shown because they asked (rather than after two misses). */
  asked?: boolean;
  /** The learner's own stroke, for one they drew right. */
  ink?: GridPoint[];
}

export type Marks = Record<string, Mark>;

export const markKey = (character: string, index: number) => `${character}:${index}`;

/**
 * The marks after the sheet moved to `next`. `drawn` is the stroke the learner
 * just drew, when a drawn stroke is what moved it. Marks are kept only for
 * strokes of the character on the sheet that are still done, so starting
 * over or switching character forgets them.
 */
export function nextMarks(marks: Marks, next: Snapshot, drawn?: GridPoint[]): Marks {
  const character = next.character;
  if (!character) return {};
  const kept: Marks = {};
  for (const stroke of next.strokes) {
    const key = markKey(character.id, stroke.index);
    if (stroke.status === 'done' && marks[key]) kept[key] = marks[key];
  }
  const verdict = next.last_verdict;
  const key = markKey(character.id, next.stroke_index);
  if (next.phase === 'coaching' && verdict && !kept[key]) {
    kept[key] = verdict.ok
      ? { how: 'drawn', tries: next.attempts, ...(drawn ? { ink: drawn } : {}) }
      : { how: 'shown', tries: next.attempts, asked: next.attempts < 2 };
  }
  return kept;
}

/** One line of the summary for a stroke: from the sheet's record (`Snapshot.results`) or the page's mark. */
export function markLabel(mark: { how: 'drawn' | 'shown'; tries: number; asked?: boolean } | undefined): string {
  if (!mark) return 'Done';
  if (mark.how === 'shown') return (mark.asked ?? mark.tries < 2) ? 'Shown when you asked' : 'Shown after two misses';
  return mark.tries <= 1 ? 'Right first try' : `Right on try ${mark.tries}`;
}
