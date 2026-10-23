// The drill's actions: one function from (tutor, action, what Alex heard) to
// what it did, as the words Alex speaks from. Alex's tool calls and the
// learner's buttons both come through here, so a button and a sentence can
// never do two different things.
//
// It replaces the old reducer, the rules that read every line, and the coach
// that spoke after each change: the tool result IS the narration now, and
// the two-miss rescue rides on the answer that triggered it.
//
// Every answer crosses the real-emergency watch before the tutor grades it.
// Server only: it reads the tutor, which reads scenarios.ts.
import { said } from './director.ts';
import { resolveScenario } from './judge.ts';
import { isRealEmergency } from './safety.ts';
import { BETWEEN_STEPS, BlsTutor, IN_EMERGENCY, SCENARIO_FINISHED, TutorRefusal, UNKNOWN_SCENARIO } from './tutor.ts';
import type { Action, Done, View } from './types.ts';

export const viewOf = (tutor: BlsTutor): View => tutor.snapshot();

/** A step action with no drill running (the tutor's own refusal there talks about steps). */
export const NO_DRILL = "No drill is running yet — pick one first.";
const NEEDS_A_DRILL = new Set<Action>(['check_answer', 'show_step', 'give_hint', 'next_step']);

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

const labelOf = (tutor: BlsTutor) => {
  const v = viewOf(tutor);
  return v.steps?.[v.step_index ?? 0]?.label ?? '';
};

const ACTIONS = new Set<Action>(['start_scenario', 'check_answer', 'show_step', 'give_hint', 'next_step', 'leave_scenario', 'stop_for_emergency', 'resume_practice']);
export const isAction = (name: unknown): name is Action => ACTIONS.has(name as Action);

/** Do one action. A refusal changes nothing and comes back as the sentence to say. */
export function run(tutor: BlsTutor, action: Action, args: Record<string, unknown> = {}): Done {
  // The watch first, from any phase: an answer is the learner's own words too.
  if (action === 'check_answer' && isRealEmergency(String(args.answer ?? ''))) return stop(tutor);
  try {
    if (NEEDS_A_DRILL.has(action) && tutor.phase === 'intro') throw new TutorRefusal(NO_DRILL);
    switch (action) {
      case 'check_answer': {
        const answer = String(args.answer ?? '').trim().slice(0, 500);
        if (!answer) return { applied: false, text: 'No answer: nothing reached the drill. Ask them what they would do.' };
        const verdict = tutor.answer('', answer);
        if (verdict.ok) return { applied: true, text: said.right(viewOf(tutor), verdict.note) };
        const rescued = rescueIfStuck(tutor);
        if (rescued) return { applied: true, text: said.rescued(labelOf(tutor), rescued.note) };
        return { applied: true, text: said.wrong(verdict.note) };
      }
      case 'show_step': {
        const verdict = tutor.reveal();
        return { applied: true, text: said.shown(labelOf(tutor), verdict.note) };
      }
      case 'give_hint': {
        if (tutor.phase === 'emergency') throw new TutorRefusal(IN_EMERGENCY);
        if (tutor.phase !== 'answering') throw new TutorRefusal(tutor.phase === 'debrief' ? SCENARIO_FINISHED : BETWEEN_STEPS);
        const hint = tutor.currentStep()!.hint;
        return { applied: true, text: said.hint(hint), hint };
      }
      case 'next_step': {
        tutor.nextStep();
        const view = viewOf(tutor);
        return { applied: true, text: view.phase === 'debrief' ? said.debrief(view) : said.next(view) };
      }
      case 'start_scenario': {
        // The tutor would also take a new scenario as the way off the
        // emergency card; only the learner's plain words or button may do that.
        if (tutor.phase === 'emergency') throw new TutorRefusal(IN_EMERGENCY);
        const words = String(args.scenario ?? '').trim().slice(0, 200);
        const id = resolveScenario(words);
        if (!id) return { applied: false, text: said.unknown(words), reason: UNKNOWN_SCENARIO };
        tutor.startScenario(id);
        return { applied: true, text: said.started(viewOf(tutor)) };
      }
      case 'leave_scenario': {
        tutor.leaveScenario();
        return { applied: true, text: said.left() };
      }
      case 'stop_for_emergency':
        return stop(tutor);
      case 'resume_practice': {
        if (tutor.phase !== 'emergency') return { applied: false, text: said.notStopped() };
        tutor.ackSafety();
        return { applied: true, text: said.resumed(viewOf(tutor)) };
      }
    }
    throw new TutorRefusal(`'${String(action)}' is not something this drill can do`);
  } catch (err) {
    if (!(err instanceof TutorRefusal)) throw err;
    return { applied: false, text: said.refused(err.reason), reason: err.reason };
  }
}

/** Never refused, from any phase, including the card itself: the line is said again if asked for. */
function stop(tutor: BlsTutor): Done {
  tutor.emergency();
  return { applied: true, text: said.emergency(), emergency: true };
}
