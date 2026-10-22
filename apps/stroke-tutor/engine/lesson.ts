// The tutor wired to the app: one intent in, the new board and what the
// avatar should be told out. SERVER ONLY (it holds the tutor).
//
// This replaces three pieces of the original: the reducer (the only writer,
// validate-before-mutate, a refusal leaves the board exactly where it was),
// the tools (each returned a cue for the model to say), and the coach (which
// spoke for changes nobody else spoke for, and rescued after two misses).
// Here every input (a button, a stroke, a typed or spoken line) takes this one
// path, so each change produces exactly one event: the original's seq-claiming
// that stopped a change being narrated twice is not needed.
import { say } from './director.ts';
import { StrokeTutor, TutorRefusal } from './tutor.ts';
import type { Intent, Outcome } from './types.ts';

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
        return { view, handled: true, kind, event: say.verdict(view) };
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
