// The guided session: the app's own step machine, and the one writer of the board.
//
// The original ran five LiveKit AgentTasks in a TaskGroup (ask the goal, ask
// the level, await the plan, ask the starting move, coach the move), with the
// recording tools as the only writers and a ConstraintSensing mixin reading
// every user message. The Avatar API has no function calling, so the avatar
// cannot record anything: this class does, from a tap, a typed line or the
// user's speech (judged by `judge.ts`), and tells the avatar what happened.
//
// It keeps the original's hard-won guarantees:
// - a heard constraint is an enforced constraint: every plan that reaches the
//   board goes through `enforce` with the limits as they stand at that moment;
// - a new limit rebuilds an existing plan, and a limit banked while a rebuild
//   awaits the model gets its own pass;
// - a clearance disclosure freezes everything: no plan, rebuild, render or tap
//   advances afterwards, and the hold is re-checked after every await, because
//   the guard before an await cannot see a disclosure that lands during it.
import * as cons from './constraints.ts';
import { ackClause, builtAround, say } from './director.ts';
import { GOAL_COUNT, GOAL_SEED, goalOptions, TRAINING_GOAL_OPTIONS } from './goals.ts';
import { acceptGoal, baseMoveName, buildFallbackPlan, buildStartMovePrompt, findStep, normalizeLevel, rebuildSummaryLine } from './plan.ts';
import { FitnessState } from './state.ts';
import type { AvatarEvent, Command, FitnessPlan, How, Intent, Level, Outcome, Stage, VideoPayload, View } from './types.ts';

/** Renders demo clips (engine/video.ts), seen from the coach. */
export interface Renderer {
  available(): boolean;
  start(request: { prompt: string }): VideoPayload;
  stop(): void;
}

export interface CoachOptions {
  /** One model call for the plan; may throw or hang (the coach falls back). Absent: the built-in plan. */
  generatePlan?: (request: { goal: string; level: string; constraints: cons.Constraints }) => Promise<FitnessPlan>;
  /** Builds the demo renderer with the coach's hooks. Absent: demos are off. */
  renderer?: (hooks: { onStatus: (payload: VideoPayload) => void; suppressed: () => boolean }) => Renderer;
  /** Whether reference images are configured for the demo trainer. */
  hasReference?: boolean;
  planTimeoutMs?: number;
  seed?: string;
}

/** What one typed or spoken line means to the app (see judge.ts). */
export interface Judgement {
  constraints: cons.Constraints;
  intent: Intent | null;
  /** A level said in passing, kept as a hint. */
  level?: Level | null;
}

export interface JudgeContext {
  stage: Stage;
  plan: FitnessPlan | null;
  goal: string;
  level: string;
}

const HOLD_REFUSAL = 'The session is on hold until a doctor or qualified health professional clears you.';
const NO_DEMOS = 'Video demos are not switched on for this session.';

const warn = (message: string, ...args: unknown[]) => console.warn(`[fitness-coach] ${message}`, ...args);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

export class Coach {
  private board = new FitnessState();
  private seq = 0;
  /** Bumped by anything that makes an in-flight plan stale: a restart, a new level, a hold. */
  private planToken = 0;
  private planning = false;
  /** True from a limit landing until the rebuilt plan is on the board. */
  private rebuildPending = false;
  /** A limit landed while a rebuild was awaiting the model: go round again. */
  private rebuildAgain = false;
  private rebuildTask: Promise<void> | null = null;
  private droppedDuringRebuild = '';
  /** Limits the avatar has been given the chance to acknowledge (said once, not every turn). */
  private acknowledged: string[] = [];
  /** Clearance conditions the avatar has been told to stop for; a NEW one is a new thing to be honest about. */
  private clearanceSaid: string[] = [];
  private listeners = new Set<(outcome: Outcome) => void>();
  private backlog: Outcome[] = [];
  private readonly renderer: Renderer | null;
  readonly seed: string;

  constructor(private readonly opts: CoachOptions = {}) {
    this.seed = opts.seed ?? GOAL_SEED;
    this.renderer = opts.renderer?.({ onStatus: (payload) => this.onVideo(payload), suppressed: () => this.halted }) ?? null;
  }

  /** On hold from the moment a condition is PARSED, not when it is spoken. */
  get halted(): boolean {
    return this.board.constraints.clearance.length > 0;
  }

  get demos(): boolean {
    return Boolean(this.renderer?.available());
  }

  get constraints(): cons.Constraints {
    return this.board.constraints;
  }

  stage(): Stage {
    if (this.halted) return 'hold';
    if (!this.board.goal) return 'goal';
    if (!this.board.plan) return this.board.level ? 'planning' : 'level';
    return this.board.startMove ? 'coach' : 'move';
  }

  context(): JudgeContext {
    return { stage: this.stage(), plan: this.board.plan, goal: this.board.goal, level: this.board.level };
  }

  view(): View {
    const snap = this.board.snapshot();
    return {
      seq: this.seq,
      stage: this.stage(),
      flow: snap.flow,
      plan: snap.plan,
      video: snap.video,
      constraints: snap.constraints,
      overheardLevel: this.board.overheardLevel,
      demos: this.demos,
      planning: this.planning,
      rebuilding: this.rebuildPending,
      acknowledged: [...this.acknowledged],
      goalOptions: goalOptions(TRAINING_GOAL_OPTIONS, GOAL_COUNT, this.board.goal, this.seed),
      seed: this.seed,
    };
  }

  private out(events: AvatarEvent[], handled = true, refused?: string): Outcome {
    this.seq += 1;
    return { view: this.view(), handled, events, ...(refused ? { refused } : {}) };
  }

  /** Outcomes of background work (a plan landing, a rebuild, a demo status), for the page's stream. */
  subscribe(listener: (outcome: Outcome) => void): () => void {
    this.listeners.add(listener);
    for (const outcome of this.backlog.splice(0)) listener(outcome);
    return () => { this.listeners.delete(listener); };
  }

  private emit(events: AvatarEvent[]) {
    const outcome = this.out(events);
    if (!this.listeners.size) {
      // Nobody is listening (the page is reconnecting): keep it for when it is back.
      this.backlog.push(outcome);
      if (this.backlog.length > 12) this.backlog.shift();
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(outcome);
      } catch (err) {
        // A listener that broke (a closed stream) must not break the session.
        warn('an outcome listener failed (%s)', (err as Error).message);
      }
    }
  }

  dispose() {
    this.planToken += 1;
    this.renderer?.stop();
    this.listeners.clear();
  }

  // -- the three inputs -----------------------------------------------------

  /** The opening, sent once the app is ready (queued until the avatar arrives). */
  open(): Outcome {
    return this.out([{ text: say.start(this.view()), ttl: 60 }]);
  }

  /** A tap on the board. Refused in words when it cannot be taken. */
  command(command: Command, value = ''): Outcome {
    // The panel is the third way into the flow, and in the original it was
    // the one the hold did not cover: a goal tap walked straight past it.
    if (this.halted) return this.out([], true, HOLD_REFUSAL);
    const refuse = (why: string) => this.out([], true, why);
    const { plan, goal } = this.board;
    switch (command) {
      case 'goal': {
        const chosen = acceptGoal(value);
        if (!chosen) return refuse('That is not a workout goal.');
        if (plan || this.planning) return refuse('Start over to change what you train.');
        return this.out(this.act({ kind: 'goal', goal: chosen }, 'tap'));
      }
      case 'level':
      case 'relevel': {
        const level = normalizeLevel(value);
        if (!level) return refuse('That is not a level.');
        if (!goal) return refuse('Choose what to train first.');
        return this.out(this.act(plan || this.planning ? { kind: 'relevel', level } : { kind: 'level', level }, 'tap'));
      }
      case 'move': {
        if (!plan) return refuse('There is no plan yet.');
        const step = findStep(plan, baseMoveName(value));
        if (!step) return refuse('That move is not on the plan any more.');
        return this.out(this.act({ kind: 'move', move: baseMoveName(step) }, 'tap'));
      }
      case 'restart':
        return this.out(this.act({ kind: 'restart' }, 'tap'));
      default:
        return refuse('Unknown action.');
    }
  }

  /**
   * A typed or spoken line, already judged. Constraints first (the original
   * read them on every user message, before anything else), then the intent.
   */
  hear(judgement: Judgement, how: Exclude<How, 'tap'>): Outcome {
    const board = this.board;
    if (judgement.level && !board.level && !board.overheardLevel) board.overheardLevel = judgement.level;

    const before = board.constraints;
    const changed = board.noteConstraints(judgement.constraints);
    if (changed) {
      const fresh = board.constraints.clearance.filter((c) => !this.clearanceSaid.includes(c));
      if (fresh.length) {
        this.clearanceSaid.push(...fresh);
        this.freeze();
        // Never staged: the avatar's own reply to the disclosure may already
        // have gone wrong ("please name a warm-up move"), so the exact words
        // follow even after a spoken line.
        return this.out([{ text: say.clearance(fresh), ttl: 60 }], true);
      }
    }
    if (this.halted) {
      if (judgement.intent) return this.out([{ text: say.onHold(judgement.intent), ttl: 20, staged: true }], true);
      return this.out([], false);
    }

    const events: AvatarEvent[] = [];
    let labels: string[] = [];
    if (changed) {
      labels = cons.newConstraintLabels(before, board.constraints).filter((l) => !this.acknowledged.includes(l));
      this.acknowledged.push(...labels);
      // No plan yet: the limits go into the plan prompt. A plan being built:
      // it is enforced against the limits as they stand when it lands.
      if (board.plan && !this.planning) events.push(...this.scheduleRebuild());
    }
    // Nothing for the app to do: the avatar answers the line itself (its
    // notes tell it to acknowledge a limit in a few words).
    if (!judgement.intent) return this.out(events, false);

    const done = this.act(judgement.intent, how);
    // An intent with nothing to do at this step: the avatar answers the line.
    if (!done.length) return this.out(events, false);
    // A typed line the app handles is not seen by the avatar, so the event
    // carries the acknowledgement. After speech the avatar has already given it.
    if (how === 'typed' && labels.length && done.length) {
      done[0] = { ...done[0], text: done[0].text + ackClause(labels, this.rebuildPending) };
    }
    return this.out([...done, ...events], true);
  }

  // -- the steps ------------------------------------------------------------

  private act(intent: Intent, how: How): AvatarEvent[] {
    const plan = this.board.plan;
    switch (intent.kind) {
      case 'goal': return this.chooseGoal(intent.goal, intent.level ?? null);
      case 'level': return this.chooseLevel(intent.level);
      case 'relevel': return this.relevel(intent.level);
      case 'move': return this.chooseMove(intent.move);
      case 'demo': {
        if (!plan) return [{ text: say.noPlanYet(), ttl: 20 }];
        // "Show me a demo" while coaching a move means that move.
        const move = intent.move ?? (this.board.startMove || null);
        return move ? this.chooseMove(move, true) : [{ text: say.askWhichMove(plan), ttl: 20, staged: true }];
      }
      case 'unknownMove':
        return plan ? [{ text: say.notOnPlan(intent.heard, plan), ttl: 20, staged: true }] : [{ text: say.noPlanYet(), ttl: 20 }];
      case 'restart': return this.restart();
      default: {
        const unknown: never = intent;
        warn('unknown intent %o (%s)', unknown, how);
        return [];
      }
    }
  }

  private chooseGoal(goal: string, level: Level | null): AvatarEvent[] {
    const stage = this.stage();
    // Once a plan exists or is being built, only "start over" changes the goal.
    if (stage !== 'goal' && stage !== 'level') return [];
    // Pre-staged at the goal step; a change of mind at the level step is not.
    const staged = stage === 'goal';
    this.board.noteGoal(goal);
    // A level already said is an ANSWER: "core and cardio, I'm a beginner"
    // recorded the goal and then asked the one thing the person had just
    // volunteered. At this moment the overheard level is exactly the answer.
    const known = level ?? normalizeLevel(this.board.overheardLevel);
    if (known) {
      this.board.noteLevel(known);
      return [{ text: say.goalAndLevel(goal, known), ttl: 30, staged }, ...this.startPlan('first')];
    }
    return [{ text: say.goal(goal), ttl: 30, staged }];
  }

  private chooseLevel(level: Level): AvatarEvent[] {
    const stage = this.stage();
    if (stage === 'goal') {
      // A bare level is the common derail when asked what to train; a plan
      // for "beginner beginner" is worse than asking again.
      this.board.overheardLevel = level;
      return [{ text: say.levelOnly(level), ttl: 20, staged: true }];
    }
    if (stage === 'level') {
      this.board.noteLevel(level);
      return [{ text: say.level(this.board.goal, level), ttl: 30, staged: true }, ...this.startPlan('first')];
    }
    return this.relevel(level);
  }

  /** "Rebuild that as advanced": the passed level wins over the remembered one. */
  private relevel(level: Level): AvatarEvent[] {
    if (!this.board.goal) return this.chooseLevel(level);
    // Already that level: say so about a plan on screen; one still being built says nothing new.
    if (this.board.level === level) return this.board.plan ? [{ text: say.sameLevel(level), ttl: 20 }] : [];
    this.board.level = level;
    if (!this.board.plan) {
      this.board.noteLevel(level);
      return [{ text: say.level(this.board.goal, level), ttl: 30 }, ...this.startPlan('first')];
    }
    return [{ text: say.relevel(level), ttl: 30, staged: true }, ...this.startPlan('relevel')];
  }

  /** The starting move, or another move later. `askedForDemo`: the user asked for a clip by name. */
  private chooseMove(move: string, askedForDemo = false): AvatarEvent[] {
    const plan = this.board.plan;
    if (!plan) return [{ text: say.noPlanYet(), ttl: 20 }];
    const step = findStep(plan, move);
    if (!step) return [{ text: say.notOnPlan(move, plan), ttl: 20, staged: true }];
    const name = baseMoveName(step);
    const firstPick = this.stage() === 'move';
    const { video } = this.board;
    if (name === this.board.startMove && video && (video.status === 'generating' || video.status === 'ready')) {
      return [{ text: say.moveAgain(name, video), ttl: 20 }];
    }
    this.board.startMove = name;
    if (this.renderer?.available()) {
      // Started at once, so the render has a head start on the avatar's words.
      this.board.video = this.renderer.start({ prompt: buildStartMovePrompt(name, this.board.goal, this.board.level, this.opts.hasReference) });
      return [{ text: say.moveRendering(name), ttl: 30, staged: true }];
    }
    // No key: said plainly, never a spinner that does not resolve.
    this.board.video = { status: 'unavailable', request_id: '', prompt: '', message: NO_DEMOS };
    return [{ text: firstPick || askedForDemo ? say.moveNoDemo(name) : say.switchMove(name), ttl: 30, staged: true }];
  }

  private restart(): AvatarEvent[] {
    this.planToken += 1;
    this.planning = false;
    this.rebuildPending = false;
    this.rebuildAgain = false;
    this.renderer?.stop();
    // The limits are kept: they are about the person, not the plan.
    const { constraints } = this.board;
    this.board = new FitnessState();
    this.board.constraints = constraints;
    return [{ text: say.restart(), ttl: 30 }];
  }

  /** The hold: stop everything that could still advance the plan. */
  private freeze() {
    // A clip already rendering would land under the hold card: stop it. The
    // renderer also asks `halted` before every publish, for a clip in the gap.
    this.renderer?.stop();
    // A plan being built must not land as "here is your workout".
    this.planToken += 1;
    this.planning = false;
  }

  // -- the plan ---------------------------------------------------------------

  /**
   * Build a plan in the background (the board shows "Setting up your plan…").
   * Without a model it is the built-in plan, at once, and its events are
   * returned rather than emitted so they follow the level's own event.
   */
  private startPlan(kind: 'first' | 'relevel'): AvatarEvent[] {
    const token = ++this.planToken;
    this.planning = true;
    const { goal, level } = this.board;
    if (!this.opts.generatePlan) return this.landPlan(token, kind, buildFallbackPlan(goal, level)) ?? [];
    void withTimeout(this.opts.generatePlan({ goal, level, constraints: this.board.constraints }), this.opts.planTimeoutMs ?? 25_000)
      .catch((err) => {
        // A model hiccup must still coach: the built-in plan, enforced like any other.
        warn('plan generation failed (%s); using the built-in plan', (err as Error).message);
        return buildFallbackPlan(goal, level);
      })
      .then((plan) => {
        const events = this.landPlan(token, kind, plan);
        if (events) this.emit(events);
      })
      .catch((err) => warn('landing the plan failed (%s)', (err as Error).message));
    return [];
  }

  /** A plan arriving. Null when it was superseded and there is nothing to say. */
  private landPlan(token: number, kind: 'first' | 'relevel', plan: FitnessPlan): AvatarEvent[] | null {
    if (token !== this.planToken) return null;
    this.planning = false;
    // Re-checked here, after the await: a plan published after a disclosure
    // is "here is your workout" to someone the app just refused.
    if (this.halted) return [];
    // Enforced with the limits as they are NOW, on every path, the built-in
    // plan included: a limit heard while the model was thinking still binds.
    const enforced = cons.enforce(plan, this.board.constraints);
    const dropped = this.publishPlan(enforced);
    const around = builtAround(cons.payload(this.board.constraints));
    return [{ text: kind === 'first' ? say.planReady(enforced, around) : say.replanned(enforced, dropped), ttl: 45 }];
  }

  /** Put a plan on the board. Returns the demoed move it took down, or ''. */
  private publishPlan(plan: FitnessPlan): string {
    this.board.notePlan(plan);
    // New in this port: a demo stays only while its move is still on the
    // plan. A clip of lunges playing beside a plan rebuilt for a bad knee is
    // the board contradicting itself in the most dangerous direction.
    const move = this.board.startMove;
    if (move && !findStep(plan, move)) {
      this.renderer?.stop();
      this.board.startMove = '';
      this.board.video = null;
      return move;
    }
    return '';
  }

  /**
   * Rebuild the plan on the board for new limits. Asking the avatar to redo
   * the plan is what produced the original failure ("let's keep it to twenty
   * minutes without lunges" over a board that never moved): it is done in code.
   */
  private scheduleRebuild(): AvatarEvent[] {
    // The callers check the hold; this is the backstop, because a rebuild
    // armed while halted can only end in a plan that reads as adapted.
    if (this.halted || !this.board.plan) return [];
    if (!this.opts.generatePlan) {
      // No model: enforce in place, now, and say what it changed.
      const before = this.board.plan;
      const dropped = this.publishPlan(cons.enforce(before, this.board.constraints));
      const line = rebuildSummaryLine(before, this.board.plan!);
      return line || dropped ? [{ text: say.rebuilt(line, this.board.plan!, dropped), ttl: 40 }] : [];
    }
    this.rebuildPending = true;
    if (this.rebuildTask) {
      // One rebuild at a time, but a limit banked while it awaits the model
      // must still reshape the plan: mark it dirty and let it go round again.
      this.rebuildAgain = true;
      return [];
    }
    this.rebuildTask = this.rebuildLoop()
      .catch((err) => warn('the rebuild failed (%s)', (err as Error).message))
      .finally(() => { this.rebuildTask = null; });
    return [];
  }

  private async rebuildLoop(): Promise<void> {
    const before = this.board.plan;
    this.droppedDuringRebuild = '';
    try {
      do {
        this.rebuildAgain = false;
        await this.rebuildOnce();
      } while (this.rebuildAgain);
    } catch (err) {
      warn('the rebuild died (%s)', (err as Error).message);
    }
    this.rebuildPending = false;
    const after = this.board.plan;
    // On hold, restarted or relevelled meanwhile: only the view changes.
    if (this.halted || !before || !after || after === before) return this.emit([]);
    const line = rebuildSummaryLine(before, after);
    const dropped = this.droppedDuringRebuild;
    this.emit(line || dropped ? [{ text: say.rebuilt(line, after, dropped), ttl: 40 }] : []);
  }

  private async rebuildOnce(): Promise<void> {
    const plan = this.board.plan;
    if (!plan || this.halted) return;
    const token = this.planToken;
    const constraints = this.board.constraints;
    let rebuilt: FitnessPlan;
    try {
      rebuilt = await withTimeout(
        this.opts.generatePlan!({ goal: this.board.goal || plan.goal, level: this.board.level || plan.level, constraints }),
        this.opts.planTimeoutMs ?? 25_000,
      );
    } catch (err) {
      // A worse plan but an honest one: the plan on the board, with the limits enforced.
      warn('rebuild generation failed (%s); enforcing in place', (err as Error).message);
      rebuilt = plan;
    }
    // THE HOLD CAN ONLY HAVE LANDED HERE: this pass was parked inside the
    // model call for the whole window in which a disclosure is possible.
    if (this.halted || token !== this.planToken) return;
    const dropped = this.publishPlan(cons.enforce(rebuilt, this.board.constraints));
    if (dropped) this.droppedDuringRebuild = dropped;
  }

  // -- the demo -----------------------------------------------------------------

  private onVideo(payload: VideoPayload) {
    if (this.halted) return;
    this.board.video = payload;
    const move = this.board.startMove;
    if (payload.status === 'ready') return this.emit([{ text: say.demoReady(move), ttl: 30 }]);
    if (payload.status === 'error') return this.emit([{ text: say.demoFailed(move), ttl: 30 }]);
    this.emit([]);
  }
}
