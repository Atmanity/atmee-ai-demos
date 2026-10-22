// The drill wired to its inputs: one function from (tutor, what the learner
// did) to an Outcome (the new view, and what the avatar should be told).
//
// It replaces three pieces of the original: the reducer (table.py), the six
// tools (tools.py) and the coach that spoke after every change. Each input
// produces at most one event, which is the old "claim(seq)" double-speak guard
// rebuilt: the tool and the coach can no longer both narrate one change,
// because there is only one narrator.
//
// Every line crosses the emergency watch first, typed, spoken or typed into the
// panel's answer box, before the tutor sees it.
import { say } from './director.ts';
import { interpret } from './judge.ts';
import { clearsEmergency, isRealEmergency } from './safety.ts';
import { BlsTutor, TutorRefusal } from './tutor.ts';
import type { ActionKind, Intent, Outcome, Phase, Source, View } from './types.ts';

export interface Input {
  /** A control: the panel's buttons and its answer box. */
  intent?: Intent;
  /** A line the learner typed into the composer or said out loud. */
  text?: string;
  from: Source;
}

/** Important events wait longest for the floor. */
export const TTL = { normal: 30, emergency: 60 } as const;

export const viewOf = (tutor: BlsTutor): View => ({ ...tutor.snapshot(), staged: tutor.staged() });

const KIND: Record<Intent['kind'], ActionKind> = {
  answer: 'answer', reveal: 'reveal', next: 'next', start_scenario: 'start', leave_scenario: 'leave', ack_safety: 'resume', emergency_mode: 'emergency',
};

/**
 * Open the step for a learner who has missed it twice. Returns the reveal's
 * verdict if it fired, else null. Single-shot for free: reveal is refused once
 * the step is resolved.
 */
export function rescueIfStuck(tutor: BlsTutor) {
  const snapshot = tutor.snapshot();
  const verdict = snapshot.last_verdict;
  if (!verdict || snapshot.phase !== 'answering' || verdict.ok) return null;
  if ((snapshot.attempts ?? 0) < 2) return null;
  try {
    return tutor.reveal();
  } catch (err) {
    if (err instanceof TutorRefusal) return null;   // resolved under us: nothing to rescue
    throw err;
  }
}

export function act(tutor: BlsTutor, input: Input): Outcome {
  const said = (input.text ?? (input.intent?.kind === 'answer' ? input.intent.text : '') ?? '').trim();

  // 1. The real-emergency watch, before anything else reads the words. On the
  // card, a plain "it's not a real emergency" is the way off it, not a second
  // report (it contains "real emergency"); clearsEmergency() checks the rest.
  const clearing = tutor.phase === 'emergency' && !input.intent && clearsEmergency(said);
  if (said && !clearing && isRealEmergency(said)) {
    if (tutor.phase !== 'emergency') {
      tutor.emergency();
      return { view: viewOf(tutor), kind: 'emergency', handled: true, applied: true, event: say.emergency(), ttl: TTL.emergency };
    }
    // Already on the card. The line is said once, not on every following
    // turn; a typed line goes to the avatar as it is, and it answers it under
    // the emergency rules it holds.
    return { view: viewOf(tutor), kind: 'emergency', handled: Boolean(input.intent), applied: false };
  }

  // 2. A control is its own meaning; a line is judged.
  const current = tutor.scenario?.id ?? null;
  const intent = input.intent ?? (said ? interpret(said, tutor.phase, current) : null);
  if (!intent) return { view: viewOf(tutor), handled: false, applied: false };
  return apply(tutor, intent, input.from, said);
}

function apply(tutor: BlsTutor, intent: Intent, from: Source, said: string): Outcome {
  const before: Phase = tutor.phase;
  const spoken = from === 'spoken';
  const kind = KIND[intent.kind] ?? undefined;
  // What the avatar's own reply to a spoken request already covered, because
  // the state staged it (director.ts): no event follows, or it says it twice.
  const done = (k: ActionKind, event: string | undefined, staged = false): Outcome =>
    staged && spoken
      ? { view: viewOf(tutor), kind: k, handled: true, applied: true, staged: true }
      : { view: viewOf(tutor), kind: k, handled: true, applied: true, event, ttl: TTL.normal };

  try {
    switch (intent.kind) {
      case 'start_scenario': {
        tutor.startScenario(intent.id);
        return done('start', say.started(viewOf(tutor)), before === 'intro' || before === 'debrief');
      }
      case 'answer': {
        const verdict = tutor.answer(intent.step_key ?? '', intent.text);
        if (verdict.ok) return done('answer', say.correct(verdict.note));
        const rescued = rescueIfStuck(tutor);
        if (rescued) return done('rescue', say.rescued(rescued.note));
        return done('answer', say.wrong(verdict.note));
      }
      case 'reveal': {
        const verdict = tutor.reveal();
        return done('reveal', say.revealed(verdict.note), true);
      }
      case 'next': {
        tutor.nextStep();
        const view = viewOf(tutor);
        return done('next', view.phase === 'debrief' ? say.debrief(view) : say.next(view), true);
      }
      case 'leave_scenario': {
        tutor.leaveScenario();
        return done('leave', say.left(), true);
      }
      case 'ack_safety': {
        tutor.ackSafety();
        if (before !== 'emergency') return { view: viewOf(tutor), kind: 'resume', handled: true, applied: true };
        // "False alarm, let's do choking" / "nobody's hurt, new scenario
        // please": off the card, then where they asked to go. Only a scenario
        // or the menu: the rest of the line is not an answer to grade.
        const then = from === 'button' ? null : interpret(said, tutor.phase, tutor.scenario?.id ?? null);
        if (then?.kind === 'start_scenario') tutor.startScenario(then.id);
        else if (then?.kind === 'leave_scenario' && tutor.scenario) tutor.leaveScenario();
        // Never staged: the avatar must not talk anyone off the card by itself.
        return { view: viewOf(tutor), kind: 'resume', handled: true, applied: true, event: say.resumed(viewOf(tutor), then?.kind === 'start_scenario'), ttl: TTL.normal };
      }
      case 'emergency_mode': {
        const already = tutor.phase === 'emergency';
        tutor.emergency();
        return already
          ? { view: viewOf(tutor), kind: 'emergency', handled: true, applied: false }
          : { view: viewOf(tutor), kind: 'emergency', handled: true, applied: true, event: say.emergency(), ttl: TTL.emergency };
      }
      default: {
        // Anything else is refused by name, so a typo in a control is a visible refusal rather than a silent no-op.
        const unknown = String((intent as { kind?: unknown }).kind ?? '');
        throw new TutorRefusal(`'${unknown}' is not something this tutor can do`);
      }
    }
  } catch (err) {
    if (!(err instanceof TutorRefusal)) throw err;
    // A refusal changes nothing. A button's refusal is shown on the panel only
    // (as in the original). A spoken one was already answered from the state,
    // which says what each phase allows; a typed one is said by the avatar.
    const event = from === 'typed' ? say.refused(err.reason) : undefined;
    return { view: viewOf(tutor), kind, handled: true, applied: false, reason: err.reason, event, ttl: event ? TTL.normal : undefined, staged: spoken || undefined };
  }
}
