// The tutor's rules: pure, no I/O. Runs on the server (it reads scenarios.ts).
//
// `BlsTutor` is the truth the page projects. It holds which scenario is
// running, which rung of the ladder is live, how many attempts this rung has
// taken, the score, and the last verdict. Everything it refuses throws a
// `TutorRefusal` whose message IS the sentence the learner hears.
//
// Two properties are worth stating because the app is a safety app:
//
// - snapshot() strips the label of every step not yet ANSWERED, including
//   the live one. The label is the answer. A ladder that prints "Start chest
//   compressions" on the rung the learner is being asked about has answered its
//   own question, and a learner who reads the rung instead of recalling it has
//   practised nothing. A rung earns its words by being resolved: answered
//   correctly, or revealed on purpose. The key survives throughout, because the
//   panel needs a stable list identity and a key is not a sentence.
// - Grading is deterministic. `expected` / `forbidden` from scenarios.ts,
//   substring matching, no model in the loop. The host reads `teach` aloud from
//   a tool result; it never decides whether an answer was right, and it never
//   sources a number.
import { emergencySnapshot } from './lines.ts';
import { catalog, DEFAULT_SCENARIO_ID, find, SAFETY_LINE, UNKNOWN_SCENARIO_REASON, type Scenario, type Step } from './scenarios.ts';
import type { Phase, Snapshot, StepOutcome, StepView, Verdict } from './types.ts';

/** A refusal whose message is said to the learner verbatim. */
export class TutorRefusal extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'TutorRefusal';
  }
}

// The refusals, verbatim. They are constants because the tests assert on the
// exact sentence: a refusal the learner cannot act on is the same bug as no
// refusal at all, and rewording one silently is how that happens.
export const BETWEEN_STEPS = "We're between steps — say *next* when you're ready.";
export const SCENARIO_FINISHED = "That scenario's finished; say *new scenario* to start another.";
export const STEP_UNRESOLVED = "You haven't answered this step yet.";
export const UNKNOWN_SCENARIO = UNKNOWN_SCENARIO_REASON;
/** There is nothing to leave from the menu, and saying so is kinder than silently doing nothing. */
export const ALREADY_AT_MENU = "You're already at the scenario menu — pick one when you're ready.";
/**
 * The way OUT of the emergency card is not through the drill. Without saying
 * so, an emergency stop is a dead end and the only recovery is hanging up.
 */
export const IN_EMERGENCY = "If this is a real emergency, call 911 now. When you're ready to practise again, tell me and we'll start a scenario.";

/** Deliberately does not name the step: the label is the answer to the question on screen, and a refusal is not a hint. */
export const wrongStep = (position: number) => `We're still on step ${position} — stay with that one.`;

/** One learner's walk through one scenario at a time. */
export class BlsTutor {
  private _scenario: Scenario | null = null;
  private stepIndex = 0;
  private attempts = 0;
  private resolved = false;
  private correct = 0;
  private total = 0;
  private lastVerdict: Verdict | null = null;
  private _phase: Phase = 'intro';
  private safetyAck = false;
  private phaseBeforeEmergency: Phase | null = null;
  private verdictBeforeEmergency: Verdict | null = null;
  /**
   * How each resolved rung was resolved, by step key: "correct" if the learner
   * got it, "shown" if it had to be given to them. Kept for the whole scenario,
   * because a debrief that only prints "3 of 5" tells a learner their score and
   * not one thing about what to go and revise.
   */
  private outcomes = new Map<string, StepOutcome>();

  // ---------------------------------------------------------------- reads

  get phase(): Phase { return this._phase; }

  get scenario(): Scenario | null { return this._scenario; }

  currentStep(): Step | null {
    if (!this._scenario || this.stepIndex >= this._scenario.steps.length) return null;
    return this._scenario.steps[this.stepIndex];
  }

  // ------------------------------------------------------------ mutations

  /** Begin (or restart) a scenario. Also a way out of `emergency`: the learner has said they are practising again. */
  startScenario(scenarioId?: string | null): void {
    const scenario = find(scenarioId || DEFAULT_SCENARIO_ID);
    if (!scenario) throw new TutorRefusal(UNKNOWN_SCENARIO);
    this._scenario = scenario;
    this.stepIndex = 0;
    this.attempts = 0;
    this.resolved = false;
    this.correct = 0;
    this.total = 1;
    this.lastVerdict = null;
    this._phase = 'answering';
    this.outcomes = new Map();
  }

  /**
   * Abandon the scenario in progress and go back to the menu.
   *
   * The one thing a learner mid-drill could not do. `nextStep` refuses an
   * unresolved step on purpose (you do not skip a rung), so "this one is too
   * hard, can I pick a different scenario?" was answered with "you haven't
   * answered this step yet", which reads as being held there. The drill is
   * practice: leaving it has to cost nothing and be refusable by nothing
   * except being already out.
   *
   * Deliberately NOT reachable from `emergency`: that card has exactly one way
   * off it (`ackSafety`), and a second one would be a way to dismiss a real
   * 911 screen by asking for a different scenario.
   */
  leaveScenario(): void {
    if (this._phase === 'emergency') throw new TutorRefusal(IN_EMERGENCY);
    if (!this._scenario) throw new TutorRefusal(ALREADY_AT_MENU);
    // A full reset rather than just a phase change: the score, the ladder and
    // the last verdict all belong to the scenario being left, and a menu still
    // showing "2 / 6" from an abandoned run is a number the learner cannot act on.
    this._scenario = null;
    this.stepIndex = 0;
    this.attempts = 0;
    this.resolved = false;
    this.correct = 0;
    this.total = 0;
    this.lastVerdict = null;
    this._phase = 'intro';
    this.outcomes = new Map();
    this.phaseBeforeEmergency = null;
    this.verdictBeforeEmergency = null;
  }

  /**
   * The learner has heard the safety line. From `emergency` this is also how
   * they say they are practising again.
   *
   * Resuming puts them back where they WERE, not always at `answering`: a step
   * they had already resolved came back unanswered, so `next` then refused a
   * finished rung and a debrief resumed onto a step that no longer exists.
   */
  ackSafety(): void {
    this.safetyAck = true;
    if (this._phase !== 'emergency') return;
    if (!this._scenario) {
      this._phase = 'intro';
      return;
    }
    this._phase = this.phaseBeforeEmergency ?? 'answering';
    this.lastVerdict = this.verdictBeforeEmergency;
    this.phaseBeforeEmergency = null;
    this.verdictBeforeEmergency = null;
  }

  /** Drop the drill. Applied when a turn reads as a real emergency; never refused, from any phase, including itself. */
  emergency(): void {
    if (this._phase !== 'emergency') {
      // Remember where they were, so resuming is a return rather than a
      // guess. Guarded because the watch can fire twice on one turn and the
      // second must not overwrite the real phase with `emergency`.
      this.phaseBeforeEmergency = this._phase;
      this.verdictBeforeEmergency = this.lastVerdict;
    }
    this._phase = 'emergency';
    this.lastVerdict = null;
  }

  /** Grade a free-text answer against the current step. */
  answer(stepKey: string, text: string): Verdict {
    this.requirePractice();
    if (this._phase !== 'answering') throw new TutorRefusal(this._phase === 'debrief' ? SCENARIO_FINISHED : BETWEEN_STEPS);
    const step = this.currentStep()!;   // answering implies a live step
    const wanted = (stepKey ?? '').trim();
    if (wanted && wanted !== step.key) throw new TutorRefusal(wrongStep(this.stepIndex + 1));

    const verdict = grade(step, text);
    this.attempts += 1;
    this.lastVerdict = verdict;
    if (verdict.ok) {
      this.correct += 1;
      this.resolve(step.key, 'correct');
    }
    return verdict;
  }

  /**
   * Teach the step instead of grading it. Refused once the step is resolved,
   * which is what makes the two-wrong-attempts rescue single-shot without the
   * rescue having to remember anything.
   */
  reveal(): Verdict {
    this.requirePractice();
    if (this._phase === 'debrief') throw new TutorRefusal(SCENARIO_FINISHED);
    if (this._phase !== 'answering') throw new TutorRefusal(BETWEEN_STEPS);
    const step = this.currentStep()!;
    const verdict: Verdict = { ok: false, note: step.teach, revealed: true };
    this.lastVerdict = verdict;
    this.resolve(step.key, 'shown');
    return verdict;
  }

  /** Move to the next rung. Refused while this one is unresolved: the whole point of the app is that you do not skip a step. */
  nextStep(): void {
    this.requirePractice();
    if (this._phase === 'answering') throw new TutorRefusal(STEP_UNRESOLVED);
    if (this._phase !== 'coaching') throw new TutorRefusal(this._phase === 'debrief' ? SCENARIO_FINISHED : BETWEEN_STEPS);
    const scenario = this._scenario!;
    this.stepIndex += 1;
    this.attempts = 0;
    this.resolved = false;
    this.lastVerdict = null;
    if (this.stepIndex >= scenario.steps.length) {
      this.stepIndex = scenario.steps.length;
      this._phase = 'debrief';
      return;
    }
    this.total += 1;
    this._phase = 'answering';
  }

  // ------------------------------------------------------------- internals

  private requirePractice(): void {
    if (this._phase === 'emergency') throw new TutorRefusal(IN_EMERGENCY);
    if (!this._scenario) throw new TutorRefusal(BETWEEN_STEPS);
  }

  private resolve(stepKey: string, outcome: StepOutcome): void {
    this.resolved = true;
    this._phase = 'coaching';
    this.outcomes.set(stepKey, outcome);
  }

  // -------------------------------------------------------------- snapshot

  /**
   * The PUBLIC projection: what the panel draws. Kept small and, in
   * `emergency`, kept almost empty: there is nothing to practise on that screen.
   */
  snapshot(): Snapshot {
    if (this._phase === 'emergency') {
      return emergencySnapshot({ scenario: this.scenarioSummary(), score: this.score(), safety_ack: this.safetyAck });
    }
    const step = this.currentStep();
    const snapshot: Snapshot = {
      phase: this._phase,
      scenario: this.scenarioSummary(),
      step_index: this.stepIndex,
      steps: this.stepsView(),
      attempts: this.attempts,
      score: this.score(),
      last_verdict: this.lastVerdict,
      prompt: step && this._phase === 'answering' ? step.prompt : null,
      visual: step ? step.visual : 'scene',
      metronome_bpm: step ? step.metronomeBpm : null,
      safety_ack: this.safetyAck,
      safety_notice: SAFETY_LINE,
    };
    // Only where the learner is choosing.
    if (this._phase === 'intro' || this._phase === 'debrief') snapshot.catalog = catalog();
    return snapshot;
  }

  private score() {
    return { correct: this.correct, total: this.total };
  }

  private scenarioSummary() {
    const s = this._scenario;
    return s ? { id: s.id, title: s.title, victim: s.victim, opening: s.opening } : null;
  }

  /**
   * The ladder, with every unanswered label stripped.
   *
   * The live rung is stripped too: it is the question. Showing its words beside
   * "What is the very first thing you do?" hands the learner the answer and
   * turns a drill into reading practice. A rung gets its words when it
   * resolves: right, or revealed on request.
   *
   * This is the leak the app is most exposed to, so it is one function with one
   * test per status.
   */
  private stepsView(): StepView[] {
    if (!this._scenario) return [];
    return this._scenario.steps.map((step, index) => {
      let status: StepView['status'];
      if (index < this.stepIndex) status = 'done';
      else if (index === this.stepIndex) status = this.resolved ? 'done' : 'current';
      else status = 'hidden';
      return {
        key: step.key,
        // "current" is unanswered by definition: `resolved` promotes it to "done" the moment it is not.
        label: status === 'done' ? step.label : '',
        status,
        // How it was resolved, so the ladder and the debrief can tell a rung the
        // learner got from one they were handed. Never set on an unresolved
        // rung, so it leaks nothing.
        outcome: status === 'done' ? this.outcomes.get(step.key) ?? null : null,
      };
    });
  }
}

/**
 * Deterministic verdict for one answer.
 *
 * Forbidden first: "start compressions" at the call-for-help step is a wrong
 * ORDER, and telling someone their answer was simply not recognised would
 * teach them nothing. The note is the step's own sentence either way.
 */
export function grade(step: Step, text: string): Verdict {
  const said = ` ${answerForm(text)} `;
  if (!said.trim()) return { ok: false, note: step.hint };
  // "check + breathing": every part somewhere in the answer.
  const has = (phrase: string) => phrase.split(' + ').every((part) => said.includes(answerForm(part)));
  if (step.forbidden.some(has)) return { ok: false, note: step.forbiddenNote || step.hint };
  if (step.expected.some(has)) return { ok: true, note: step.teach };
  return { ok: false, note: step.hint };
}

const NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60',
};
const PRONOUNS: Record<string, string> = {
  i: 'you', me: 'you', we: 'you', us: 'you', my: 'your', our: 'your', myself: 'yourself',
  he: 'they', she: 'they', him: 'them', her: 'them', his: 'their', hers: 'their',
  okay: 'ok', alright: 'ok',
};

/**
 * One form for an answer and for every phrase it is matched against, so a
 * step's phrases say the action once and every way of saying it lands on
 * them: numbers in words become digits; a ratio said any way ("30:2",
 * "thirty two", "30 to two", "thirty-two", "32") becomes "30:2"; 9-1-1 and
 * "nine one one" become 911; contractions are expanded, possessives and
 * articles dropped, punctuation gone; first and second person become one
 * ("tells me to stop" is "tells you to stop"), and so do he, she, him, her
 * (phrases are written in the same form: "they ok" takes "is he ok"); okay
 * and alright are ok;
 * giving breaths ("rescue breathing", "mouth to mouth") becomes "rescue
 * breaths", which a breathing check does not contain.
 */
export function answerForm(text: string): string {
  let t = (text ?? '').toLowerCase().replace(/[‘’ʼ`]/g, "'");
  t = t.replace(/\bcan't\b/g, 'cannot').replace(/\bwon't\b/g, 'will not').replace(/n't\b/g, ' not')
    .replace(/\b(he|she|it|that|there|what|who|where|here)'s\b/g, '$1 is').replace(/'s\b/g, '')
    .replace(/'re\b/g, ' are').replace(/'ll\b/g, ' will').replace(/'ve\b/g, ' have').replace(/'d\b/g, ' would').replace(/'m\b/g, ' am');
  t = t.replace(/(\d)\s*[:/]\s*(\d)/g, '$1 to $2').replace(/[^a-z0-9 ]+/g, ' ');
  t = t.split(/\s+/).filter(Boolean).map((w) => NUMBERS[w] ?? w).join(' ');
  t = ` ${t} `
    .replace(/ 9 1 1 /g, ' 911 ').replace(/ 1 1 2 /g, ' 112 ').replace(/ 9 9 9 /g, ' 999 ')
    .replace(/ 32 /g, ' 30:2 ').replace(/ 152 /g, ' 15:2 ')
    .replace(/ (15|30) (?:to |and |for |by )?2 /g, ' $1:2 ')
    .replace(/ rescue breathing /g, ' rescue breaths ').replace(/ mouth to mouth /g, ' rescue breaths ')
    .replace(/ all right /g, ' ok ')
    .replace(/ (a|an|the) /g, ' ').replace(/ (a|an|the) /g, ' ');
  return t.split(' ').filter(Boolean).map((w) => PRONOUNS[w] ?? w).join(' ');
}
