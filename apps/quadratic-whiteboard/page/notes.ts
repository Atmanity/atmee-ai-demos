// The lesson notes: every equation the class saw today, with the working that
// went up for each method and the answer once a method reached it. Built from
// the board's views as they arrive, so it holds only what was revealed: the
// page never has a line before the class does, and neither do the notes.
import { answerText } from '../engine/director.ts';
import type { MethodId, View } from '../engine/types.ts';

export interface Worked { method: MethodId; label: string; lines: string[]; total: number }

export interface NoteEntry {
  /** `y = x² - 4x + 3`, as the board wrote it. */
  equation: string;
  /** What the board showed above the working: discriminant, vertex, axis. */
  facts: string;
  /** Set once a method reached its last line. */
  answer: string | null;
  worked: Worked[];
}

/** Today's board so far, with this view taken into account. Returns the same list when nothing new was shown. */
export function record(notes: NoteEntry[], view: View): NoteEntry[] {
  if (!view.equation || !view.facts) return notes;
  const at = notes.findIndex((entry) => entry.equation === view.equation!.display);
  let entry: NoteEntry = at >= 0 ? notes[at] : {
    equation: view.equation.display,
    facts: `discriminant ${view.facts.discriminant}; vertex ${view.facts.vertex_display}; axis x = ${view.facts.axis_display}; opens ${view.facts.opens}`,
    answer: null,
    worked: [],
  };
  let changed = at < 0;
  if (view.method && view.method_label) {
    const before = entry.worked.find((w) => w.method === view.method);
    // The most of each method the class saw: going back a line does not unsee it.
    if (view.steps.length > (before?.lines.length ?? 0)) {
      const worked: Worked = { method: view.method, label: view.method_label, lines: view.steps.map((s) => s.working), total: view.total_steps };
      entry = { ...entry, worked: before ? entry.worked.map((w) => (w.method === view.method ? worked : w)) : [...entry.worked, worked] };
      changed = true;
    }
    if (view.remaining === 0 && view.total_steps > 0 && !entry.answer) {
      entry = { ...entry, answer: answerText(view.facts) };
      changed = true;
    }
  }
  if (!changed) return notes;
  return at >= 0 ? notes.map((n, i) => (i === at ? entry : n)) : [...notes, entry];
}

/** The notes as a plain-text file a teacher can keep or hand out. */
export function notesText(notes: NoteEntry[], when: Date): string {
  const day = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const out = [`Chalkline lesson notes, ${day}`, ''];
  notes.forEach((entry, i) => {
    out.push(`${i + 1}. ${entry.equation}`);
    out.push(`   ${entry.facts}`);
    if (entry.answer) out.push(`   Answer: ${entry.answer}`);
    for (const w of entry.worked) {
      out.push('', `   ${w.label}${w.lines.length < w.total ? ` (${w.lines.length} of ${w.total} lines shown)` : ''}`);
      w.lines.forEach((line, n) => out.push(`   ${String(n + 1).padStart(2)}  ${line}`));
    }
    if (!entry.worked.length) out.push('   No working shown.');
    out.push('');
  });
  return `${out.join('\n').trimEnd()}\n`;
}

/** `chalkline-lesson-2026-10-23.txt` */
export const notesFileName = (when: Date) =>
  `chalkline-lesson-${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}.txt`;

/**
 * Maths as the board sets it: a real minus sign (U+2212) for the hyphen the
 * engine writes, except inside a word ("x-axis"). For the screen only; the
 * engine's text is unchanged, and a screen reader says "minus".
 */
export function maths(text: string): string {
  return text.replace(/-/g, (dash, at: number, all: string) => (/[a-z]/i.test(all[at - 1] ?? '') && /[a-z]/i.test(all[at + 1] ?? '') ? dash : '−'));
}
