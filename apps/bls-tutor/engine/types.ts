// What the server and the page share. The page only ever sees a View: the
// public snapshot, in which every step the learner has not resolved has an
// empty label (the label is the answer to the question on screen).
//
// Keys stay snake_case because they are the original panel's snapshot, field
// for field.

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

/** The tutor's public projection (`BlsTutor.snapshot()`): what the screen draws and the host is told. */
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

export type View = Snapshot;

/** The host's tools, one per drill action (engine/director.ts declares them). */
export type Action =
  | 'start_scenario'
  | 'check_answer'
  | 'show_step'
  | 'give_hint'
  | 'next_step'
  | 'leave_scenario'
  | 'stop_for_emergency'
  | 'resume_practice';

/** The learner's buttons. Each is one of the actions above, done at once. */
export type Command = 'start' | 'reveal' | 'hint' | 'next' | 'leave' | 'resume' | 'emergency';

/** What one action did. */
export interface Done {
  /** The drill accepted it (a hint counts: nothing changes, but it was given). */
  applied: boolean;
  /** What the host speaks from: the outcome, and how to say it. */
  text: string;
  /** A refusal, as a sentence for the learner. */
  reason?: string;
  /** A hint the learner asked for, to show on screen. */
  hint?: string;
  /** The result handed the host the emergency line. */
  emergency?: boolean;
}

/** `POST /drills/:id/tool`: the host's call (or the page's safety net). */
export interface ToolReply { view: View; result: string; hint?: string; emergency?: boolean }

/** `POST /drills/:id/act`: a button. The event is what the host is told. */
export interface ActReply { view: View; applied: boolean; event?: string; reason?: string; hint?: string }
