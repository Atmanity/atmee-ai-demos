// What the server and the page share. The page only ever sees a View: the
// public snapshot (every step the learner has not resolved has an empty label)
// plus `staged`, the few facts the avatar may need for its very next reply.
//
// Keys stay snake_case because they are the original panel's snapshot, field
// for field: the ported panel and its tests read them unchanged.

export type Phase = 'intro' | 'answering' | 'coaching' | 'debrief' | 'emergency';

export type StepStatus = 'done' | 'current' | 'hidden';

/** How a resolved rung got resolved. Absent until it is one. */
export type StepOutcome = 'correct' | 'shown';

export interface StepView {
  key: string;
  /** Empty while the step is unresolved: the label is the answer to the question being asked. */
  label: string;
  status: StepStatus;
  /** Only ever set on a "done" rung. */
  outcome?: StepOutcome | null;
}

export interface ScenarioView {
  id: string;
  title: string;
  victim: string;
  opening: string;
}

export interface Verdict {
  ok: boolean;
  note: string;
  revealed?: boolean;
}

export interface CatalogEntry {
  id: string;
  title: string;
  victim: string;
  steps: number;
}

/** The tutor's public projection (`BlsTutor.snapshot()`): what the panel draws. */
export interface Snapshot {
  phase: Phase;
  scenario: ScenarioView | null;
  step_index?: number;
  steps?: StepView[];
  attempts?: number;
  score: { correct: number; total: number };
  last_verdict?: Verdict | null;
  prompt?: string | null;
  visual?: string;
  metronome_bpm?: number | null;
  safety_ack: boolean;
  safety_notice: string;
  catalog?: CatalogEntry[];
  /** Only on the emergency card, and the only thing that matters there. */
  emergency_message?: string;
}

/** A scenario as the menu offers it out loud: its scene and its first question. */
export interface StagedScenario {
  id: string;
  title: string;
  victim: string;
  opening: string;
  firstPrompt: string;
  steps: number;
}

/**
 * What the avatar may need for its next reply before the app can act on the
 * learner's words (it answers a spoken request at once; the app hears it about
 * a second later). Never drawn on the panel.
 */
export interface Staged {
  /** answering: the live step's key facts, for "show me", a hint, and so no number comes from memory. */
  step?: { label: string; teach: string; hint: string };
  /** coaching: where "next" leads: the next question, or the end of the scenario. */
  next?: { step: number; prompt: string } | 'debrief';
  /** intro and debrief: the four scenarios, for a choice made out loud. */
  scenarios?: StagedScenario[];
}

export interface View extends Snapshot {
  staged: Staged | null;
}

/** The original panel's intents, unchanged. */
export type Intent =
  | { kind: 'answer'; step_key?: string; text: string }
  | { kind: 'reveal' }
  | { kind: 'next' }
  | { kind: 'start_scenario'; id: string }
  | { kind: 'leave_scenario' }
  | { kind: 'ack_safety' }
  | { kind: 'emergency_mode' };

/** Where an input came from. A spoken one has already been answered by the avatar. */
export type Source = 'button' | 'typed' | 'spoken';

export type ActionKind = 'start' | 'answer' | 'rescue' | 'reveal' | 'next' | 'leave' | 'resume' | 'emergency';

export interface Outcome {
  view: View;
  /** Which action it was, when it was one (refused or not). */
  kind?: ActionKind;
  /** Whether the input was a drill action; a typed line that wasn't goes to the avatar as-is. */
  handled: boolean;
  /** Whether the drill accepted it. */
  applied: boolean;
  /** The drill's refusal, a sentence for the learner. */
  reason?: string;
  /** What the avatar should be told, in its own words. Absent when its own reply already covered it. */
  event?: string;
  ttl?: number;
  /** A spoken request the avatar answered from the staged facts, so no event follows. */
  staged?: boolean;
}
