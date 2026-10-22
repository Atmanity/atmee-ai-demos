// What the server and the page share. The board's truth (every line of every
// method) lives in the engine on the server; the page only ever sees a `View`:
// the lines already revealed, a COUNT of the ones that are not, and the one
// sentence the avatar will read when the next line goes up (staged, never
// drawn). Nothing else of the unrevealed working leaves the engine.

export type Phase = 'empty' | 'posed' | 'working';

export type MethodId = 'factoring' | 'completing_square' | 'quadratic_formula';

export interface EquationView {
  /** Floats, for drawing only. The exact values are in the *_display strings. */
  a: number;
  b: number;
  c: number;
  a_display: string;
  b_display: string;
  c_display: string;
  /** `y = x² - 4x + 3` */
  display: string;
  /** `x² - 4x + 3 = 0` */
  zero_form: string;
}

export interface FactsView {
  discriminant: string;
  discriminant_sign: 'positive' | 'zero' | 'negative';
  nature: 'two_rational' | 'one_repeated' | 'two_irrational' | 'two_complex';
  /** Exact, as written: `["2 + √3", "2 - √3"]`. Never decimals. */
  roots: string[];
  /** Where the curve meets the x-axis, to plot. Empty when it does not. */
  crossings: number[];
  vertex: [number, number];
  vertex_display: string;
  axis: number;
  axis_display: string;
  opens: 'upward' | 'downward';
  /** The x range the engine chose to frame this curve. */
  view: { x_min: number; x_max: number };
}

export interface StepView {
  n: number;
  /** The line on the board. */
  working: string;
  /** The avatar's script for this line. The panel deliberately ignores it. */
  say: string;
}

export type LastAction = 'equation' | 'method' | 'reveal' | 'back' | 'reveal_all' | 'graph' | 'clear';

/** The board's public projection (the original `Board.snapshot()`). */
export interface Snapshot {
  phase: Phase;
  equation: EquationView | null;
  facts: FactsView | null;
  method: MethodId | null;
  method_label: string | null;
  methods_available: MethodId[];
  /** Revealed lines only. Never the whole derivation. */
  steps: StepView[];
  revealed: number;
  total_steps: number;
  remaining: number;
  graph_visible: boolean;
  /** What last changed the board: bookkeeping for the narration, not drawn. */
  last_action: LastAction | null;
}

/**
 * The line about to be revealed, staged for the avatar: its spoken sentence
 * only (not the board's `working`), so that the avatar's own immediate answer
 * to a spoken "next" reads the real line. The panel never draws it.
 */
export interface StagedLine { n: number; say: string }

export interface View extends Snapshot {
  /** Bumped on every accepted change, so a late reply cannot overwrite a newer board. */
  seq: number;
  next: StagedLine | null;
}

/** Where an input came from: the user's voice, a typed line, or a control on the page. */
export type Source = 'spoken' | 'typed' | 'button';

export interface Outcome {
  view: View;
  /** Whether the input was a board action; a typed line that wasn't goes to the avatar as-is. */
  handled: boolean;
  /** The action it was, when it was one. */
  kind?: string;
  /** What the avatar should be told about it, in its own words. */
  event?: string;
  /** How long that event stays worth saying (seconds). */
  ttl?: number;
  /** A refusal or a misreading, shown on the panel. */
  message?: string;
}
