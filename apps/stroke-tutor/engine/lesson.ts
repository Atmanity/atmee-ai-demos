// The tutor wired to the app: one intent in, the new sheet and what Ren
// should be told out; and Ren's tools (and the page's buttons), each one
// intent. SERVER ONLY (it holds the tutor).
//
// This replaces three pieces of the original: the reducer (the only writer,
// validate-before-mutate, a refusal leaves the board exactly where it was),
// the tools (each returned a cue for the model to say), and the coach (which
// spoke for changes nobody else spoke for, and rescued after two misses).
// Here every input (a button, a stroke, a typed or spoken line) takes this one
// path, so each change produces exactly one event: the original's seq-claiming
// that stopped a change being narrated twice is not needed.
import { find } from './characters.ts';
import { say } from './director.ts';
import { characterIn } from './judge.ts';
import { StrokeTutor, TutorRefusal, UNKNOWN_CHARACTER } from './tutor.ts';
import type { Intent, Outcome, Snapshot } from './types.ts';

/**
 * Drawing is something a hand does. Words (typed or spoken, read by rules or
 * a model) never submit a stroke: a model that could would be grading itself,
 * which is the one thing the grader exists to prevent.
 */
export const STROKE_IS_THE_USERS = 'Only the person holding the pen can draw a stroke.';

/** Who asked: the page's own controls and canvas, or the learner's words. */
export type Source = 'panel' | 'words';

export function perform(tutor: StrokeTutor, intent: Intent, by: Source): Outcome {
  const kind = String((intent as { kind?: unknown })?.kind ?? '').trim().toLowerCase();
  const hadCharacter = tutor.character !== null;
  try {
    switch (kind) {
      case 'start_character': {
        const id = (intent as { id?: unknown }).id;
        tutor.startCharacter(typeof id === 'string' ? id : null);
        const view = tutor.snapshot();
        const fresh = typeof id === 'string' && id.length > 0 || !hadCharacter;
        return { view, handled: true, kind, event: fresh ? say.started(view) : say.restarted(view) };
      }
      case 'next_character': {
        tutor.nextCharacter();
        const view = tutor.snapshot();
        return { view, handled: true, kind, event: say.started(view) };
      }
      case 'stroke': {
        if (by !== 'panel') throw new TutorRefusal(STROKE_IS_THE_USERS);
        const verdict = tutor.stroke((intent as { points?: unknown }).points);
        // The rescue: a second miss on the same stroke and the board shows it.
        // Single-shot by construction: reveal is refused once the stroke is
        // resolved, so nothing has to remember that it already happened.
        if (!verdict.ok && tutor.phase === 'writing' && tutor.snapshot().attempts >= 2) tutor.reveal();
        const view = tutor.snapshot();
        return { view, handled: true, kind, event: say.drawn(view) };
      }
      case 'reveal': {
        tutor.reveal();
        const view = tutor.snapshot();
        return { view, handled: true, kind, event: say.verdict(view) };
      }
      case 'next_stroke': {
        tutor.nextStroke();
        const view = tutor.snapshot();
        // The character can be finished from either side (the learner saying
        // "next", or the Next stroke button), and both get the debrief: a
        // teacher who goes quiet at the end reads as one who stopped listening.
        return { view, handled: true, kind, event: view.phase === 'debrief' ? say.debrief(view) : say.next(view) };
      }
      case 'clear_attempt': {
        tutor.clearAttempt();
        const view = tutor.snapshot();
        return { view, handled: true, kind, event: say.cleared(view) };
      }
      default:
        // Refused BY NAME, so a typo in the page is a visible refusal rather than a silent no-op.
        throw new TutorRefusal(`'${kind}' is not something this tutor can do`);
    }
  } catch (err) {
    if (!(err instanceof TutorRefusal)) throw err;
    return { view: tutor.snapshot(), handled: true, kind: kind as Intent['kind'], refused: err.reason, event: say.refused(err.reason) };
  }
}

/** Ren's tools, by name; the page's buttons call the same ones. */
export const TOOL_NAMES = ['show_stroke', 'next_stroke', 'choose_character', 'next_character', 'start_over'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolOutcome {
  view: Snapshot;
  /** What Ren speaks from: the result of a tool, or (after a button) the outcome to tell. */
  text: string;
  /** The sheet refused it; this sentence is shown on screen. */
  refused?: string;
}

/** A character as Ren or the learner named it ("tree", "木", "the letter A"), as an id, or what was said if none matches. */
export function resolveCharacter(said: string): string {
  return find(said)?.id ?? characterIn(said, true) ?? said;
}

const spoken = (outcome: Outcome): ToolOutcome => ({ view: outcome.view, text: outcome.event ?? 'Done.', refused: outcome.refused });

/**
 * One of Ren's tools (or the button that does the same), on the sheet. The
 * result says what happened, in words Ren speaks from. Never a stroke: there
 * is no tool for drawing, and words go through 'words', which refuses one.
 */
export function runTool(tutor: StrokeTutor, name: string, args: Record<string, unknown> = {}): ToolOutcome {
  switch (name) {
    case 'show_stroke': return spoken(perform(tutor, { kind: 'reveal' }, 'words'));
    case 'next_stroke': return spoken(perform(tutor, { kind: 'next_stroke' }, 'words'));
    case 'next_character': return spoken(perform(tutor, { kind: 'next_character' }, 'words'));
    case 'start_over': return spoken(perform(tutor, { kind: 'start_character' }, 'words'));
    case 'choose_character': {
      // Whatever the host passed: `character`, or any other string it put the name in.
      const given = typeof args.character === 'string' ? args.character : Object.values(args).find((v) => typeof v === 'string');
      const asked = String(given ?? '').trim().slice(0, 60);
      if (!asked) return { view: tutor.snapshot(), text: say.unnamed(tutor.snapshot()) };
      const id = resolveCharacter(asked);
      if (!find(id)) return { view: tutor.snapshot(), text: say.unknown(asked, tutor.snapshot()), refused: UNKNOWN_CHARACTER };
      // The one already up is not started again: that would wipe their
      // progress on a request that only named it. Starting over is its own tool.
      if (id === tutor.character?.id && tutor.phase !== 'debrief') {
        const view = tutor.snapshot();
        return { view, text: say.alreadyUp(view) };
      }
      return spoken(perform(tutor, { kind: 'start_character', id }, 'words'));
    }
  }
  throw new Error(`unknown tool ${name}`);
}

/** Said on screen when a stroke reaches the server after the sheet moved on under it. */
export const SHEET_MOVED = "The sheet moved on before that stroke arrived; draw it again on the stroke that's live now.";

/**
 * A stroke the learner drew, graded only against the stroke they were drawing
 * (`at`: the character and stroke on their screen). A stroke can reach the
 * server after the sheet moved on under it (Ren started the character over, or
 * moved to the next stroke, on a faster connection); graded against whatever
 * is live by then, its verdict would land on a stroke the learner never drew.
 */
export function drawStroke(tutor: StrokeTutor, points: unknown, at?: { character?: unknown; stroke?: unknown }): Outcome {
  if (at && (at.character !== (tutor.character?.id ?? null) || at.stroke !== tutor.snapshot().stroke_index)) {
    return { view: tutor.snapshot(), handled: true, kind: 'stroke', refused: SHEET_MOVED, event: say.refused(SHEET_MOVED) };
  }
  return perform(tutor, { kind: 'stroke', points }, 'panel');
}
