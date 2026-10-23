// The whiteboard's rules: pure, no I/O. Ported from the original `board.py`.
//
// `Board` holds the quadratic on the board, the method being worked through,
// how much of that working the class has been shown, and whether the graph is
// up. Everything it refuses throws `BoardRefusal`, whose message IS the
// sentence the teacher hears.
//
// Two properties make this a teaching board rather than a calculator:
//
// - `snapshot()` carries only the steps that have been revealed. The rest is a
//   count. A board that shipped the whole derivation and let the page choose
//   how much to draw would put the answer one devtools tab away from the class,
//   and in front of the avatar, which would then narrate step six while the
//   room is looking at step two. (`nextStep()` hands out exactly one more line,
//   for staging; see `View.next`.)
// - The facts are NOT hidden. Roots, vertex, discriminant and the shape of the
//   curve ride in every snapshot, because they are what the graph draws and
//   what the avatar must not get wrong when a teacher asks mid-lesson. The
//   teacher who wants the roots off the screen hides the graph.
import { Q, q } from './fraction.ts';
import { METHOD_LABELS, availableMethods, stepsFor, whyNotFactorable, type Step } from './methods.ts';
import { Equation, fmt } from './solve.ts';
import type { EquationView, FactsView, LastAction, MethodId, Snapshot } from './types.ts';

/** A refusal whose message is said to the teacher verbatim. */
export class BoardRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'BoardRefusal';
  }
}

// The refusals, verbatim, as constants: the tests assert the exact sentence. A
// refusal the teacher cannot act on is the same bug as no refusal at all, and
// quietly rewording one is how that happens.
export const NOT_A_QUADRATIC = "That's linear — I need an x² term to work with.";
export const NO_EQUATION = 'Put an equation on the board first.';
export const NO_METHOD = 'Pick a method first — factoring, completing the square, or the formula.';
export const UNKNOWN_METHOD = 'I know three methods: factoring, completing the square, and the quadratic formula.';
export const AT_LAST_STEP = "That's the last step.";
export const AT_FIRST_STEP = "We're back at the start already.";
export const ALL_SHOWN = "It's all up there already.";
export const NOTHING_TO_GRAPH = 'Nothing to graph yet.';
export const ALREADY_CLEAR = "The board's already clean.";
// New in the port: the board runs on a shared server, and simplifying the
// surd of an enormous discriminant is trial division that would stall it. No
// classroom quadratic comes near this.
export const TOO_BIG = 'Those numbers are too big for this board — keep the coefficients smaller.';
const MAX_RADICAND = 10n ** 12n;

/**
 * How far either side of the vertex the page should draw, in x units, when the
 * roots are complex or coincident and there is nothing else to frame by.
 */
export const DEFAULT_HALF_SPAN = q(5);

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** One quadratic, one method, and how much of it the class has seen. */
export class Board {
  private _equation: Equation | null = null;
  private _method: MethodId | null = null;
  private _steps: Step[] = [];
  private _revealed = 0;
  private _graphVisible = true;
  /**
   * What last changed the board. The narration reads it to decide what, if
   * anything, to say about a change made with a button.
   */
  private _lastAction: LastAction | null = null;

  // ------------------------------------------------------------- reads

  get equation(): Equation | null { return this._equation; }
  get method(): MethodId | null { return this._method; }
  get revealed(): number { return this._revealed; }
  get isEmpty(): boolean { return this._equation === null; }

  // --------------------------------------------------------- mutations

  /**
   * Put a quadratic up, clearing whatever was being worked through. The method
   * is dropped rather than re-derived: working carried over from the previous
   * equation would be working that does not match the line above it.
   */
  setEquation(a: Q, b: Q, c: Q): void {
    if (a.isZero()) throw new BoardRefusal(NOT_A_QUADRATIC);
    const discriminant = b.mul(b).sub(a.mul(c).mul(4)).abs();
    if (discriminant.n * discriminant.d > MAX_RADICAND) throw new BoardRefusal(TOO_BIG);
    this._equation = new Equation(a, b, c);
    this._method = null;
    this._steps = [];
    this._revealed = 0;
    this._lastAction = 'equation';
    // `graphVisible` deliberately survives: a teacher who hid the graph to
    // work algebraically does not want it back on every new equation.
  }

  /** Choose how to solve it. `method` is already normalised by the caller. */
  setMethod(method: string | null): void {
    if (this._equation === null) throw new BoardRefusal(NO_EQUATION);
    if (method === null || !(method in METHOD_LABELS)) throw new BoardRefusal(UNKNOWN_METHOD);
    const id = method as MethodId;
    if (!availableMethods(this._equation).includes(id)) {
      throw new BoardRefusal(whyNotFactorable(this._equation) ?? UNKNOWN_METHOD);
    }
    this._method = id;
    this._steps = stepsFor(this._equation, id);
    this._revealed = 0;
    this._lastAction = 'method';
  }

  /** Show the class one more line. Returns the line, for the avatar to read. */
  revealStep(): Step {
    this.requireMethod();
    if (this._revealed >= this._steps.length) throw new BoardRefusal(AT_LAST_STEP);
    this._revealed += 1;
    this._lastAction = 'reveal';
    return this._steps[this._revealed - 1];
  }

  /** Take the last line back down. */
  backStep(): void {
    this.requireMethod();
    if (this._revealed === 0) throw new BoardRefusal(AT_FIRST_STEP);
    this._revealed -= 1;
    this._lastAction = 'back';
  }

  /** Put the whole derivation up at once. */
  revealAll(): void {
    this.requireMethod();
    if (this._revealed >= this._steps.length) throw new BoardRefusal(ALL_SHOWN);
    this._revealed = this._steps.length;
    this._lastAction = 'reveal_all';
  }

  /**
   * Show or hide the curve. Idempotent on purpose: "show the graph" when it is
   * already up is a no-op, not a refusal. Refusing it would mean a teacher who
   * lost track gets corrected in front of a class over nothing.
   */
  setGraph(visible: boolean): void {
    if (this._equation === null) throw new BoardRefusal(NOTHING_TO_GRAPH);
    this._graphVisible = visible;
    this._lastAction = 'graph';
  }

  /** Wipe the board back to empty. */
  clear(): void {
    if (this._equation === null) throw new BoardRefusal(ALREADY_CLEAR);
    this._equation = null;
    this._method = null;
    this._steps = [];
    this._revealed = 0;
    this._graphVisible = true;
    this._lastAction = 'clear';
  }

  private requireMethod(): void {
    if (this._equation === null) throw new BoardRefusal(NO_EQUATION);
    if (this._method === null) throw new BoardRefusal(NO_METHOD);
  }

  // ---------------------------------------------------------- snapshot

  /** The line most recently revealed, or null before the first one. */
  currentStep(): Step | null {
    return this._revealed === 0 ? null : this._steps[this._revealed - 1];
  }

  /** The line the next reveal will put up, or null when there is none. For staging only. */
  nextStep(): Step | null {
    return this._steps[this._revealed] ?? null;
  }

  /** The whole working, revealed or not. Engine-side only: never put this in a view. */
  derivation(): readonly Step[] {
    return this._steps;
  }

  /** The PUBLIC projection: what the page draws and the avatar reads. */
  snapshot(): Snapshot {
    const equation = this._equation;
    if (equation === null) {
      return {
        phase: 'empty',
        equation: null,
        facts: null,
        method: null,
        method_label: null,
        methods_available: [],
        steps: [],
        revealed: 0,
        total_steps: 0,
        remaining: 0,
        graph_visible: this._graphVisible,
        last_action: this._lastAction,
      };
    }
    return {
      phase: this._method ? 'working' : 'posed',
      equation: equationView(equation),
      facts: factsView(equation),
      method: this._method,
      method_label: this._method ? METHOD_LABELS[this._method] : null,
      methods_available: availableMethods(equation),
      // Only what has been shown. The rest is `remaining`, a number: the class
      // cannot read ahead and neither can the avatar. `say` rides along with
      // each revealed line (the same content the class is reading, in words);
      // the panel ignores it.
      steps: this._steps.slice(0, this._revealed).map((step, index) => ({ n: index + 1, working: step.working, say: step.say })),
      revealed: this._revealed,
      total_steps: this._steps.length,
      remaining: this._steps.length - this._revealed,
      graph_visible: this._graphVisible,
      last_action: this._lastAction,
    };
  }
}

function equationView(equation: Equation): EquationView {
  return {
    // Floats for the page to draw with; the exact values are already in
    // `display` and in every derived fact. This is the one place a float is
    // the right answer, because it is going to pixels.
    a: equation.a.toNumber(),
    b: equation.b.toNumber(),
    c: equation.c.toNumber(),
    a_display: fmt(equation.a),
    b_display: fmt(equation.b),
    c_display: fmt(equation.c),
    display: equation.display,
    zero_form: equation.zeroForm,
  };
}

function factsView(equation: Equation): FactsView {
  const [vertexX, vertexY] = equation.vertex;
  const roots = equation.roots;
  const crossings =
    roots.nature === 'two_complex' ? []
      : roots.nature === 'one_repeated' ? [vertexX.toNumber()]
        : roots.values.map((root) => root.approx).sort((x, y) => x - y);
  const discriminant = equation.discriminant;
  return {
    discriminant: fmt(discriminant),
    discriminant_sign: discriminant.gt(0) ? 'positive' : discriminant.isZero() ? 'zero' : 'negative',
    nature: roots.nature,
    roots: roots.texts(),
    // Where the curve actually meets the x-axis, as numbers to plot. Empty for
    // a complex pair, which is exactly what the picture shows.
    crossings,
    vertex: [vertexX.toNumber(), vertexY.toNumber()],
    vertex_display: `(${fmt(vertexX)}, ${fmt(vertexY)})`,
    axis: vertexX.toNumber(),
    axis_display: fmt(vertexX),
    opens: equation.a.gt(0) ? 'upward' : 'downward',
    view: viewWindow(equation),
  };
}

/**
 * The x range the page should frame, chosen where the maths is. Framing is a
 * fact about this quadratic, not about the screen: a curve with roots at 40
 * and 60 drawn on a fixed -10..10 window is an empty graph, and the page,
 * which has no engine, cannot know that.
 */
function viewWindow(equation: Equation): { x_min: number; x_max: number } {
  const [vertexX] = equation.vertex;
  const interesting = [vertexX.toNumber()];
  const roots = equation.roots;
  if (roots.nature === 'two_rational' || roots.nature === 'two_irrational') interesting.push(...roots.values.map((root) => root.approx));
  const low = Math.min(...interesting);
  const high = Math.max(...interesting);
  const pad = Math.max((high - low) / 2, DEFAULT_HALF_SPAN.toNumber());
  return { x_min: round4(low - pad), x_max: round4(high + pad) };
}
