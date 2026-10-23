// The host's tool calls and the user's taps, run against one coach, with what
// each did in words. A tool that builds or rebuilds a plan waits for it (up to
// PLAN_WAIT_MS), so the host's first reply is the plan that is really on the
// screen, not "I'm putting it together" followed by a second announcement.
//
// The Relay sits between the coach's background outcomes (a plan landing, a
// rebuild, a move video finishing) and the page's event stream. While a tool
// waits, it claims those outcomes' words: the tool's result says them, and the
// stream carries only the new screen, so the host is never told twice.
import type { Coach } from './coach.ts';
import * as cons from './constraints.ts';
import { builtAround, PLAN_WAIT_MS, pressed, say } from './director.ts';
import { goalIn, moveIn, readLevel, splitLevel, stepLevel } from './judge.ts';
import { acceptGoal, baseMoveName, rebuildSummaryLine } from './plan.ts';
import type { AvatarEvent, Command, Level, Outcome, View } from './types.ts';

const warn = (message: string, ...args: unknown[]) => console.warn(`[fitness-coach] [Relay] ${message}`, ...args);

interface Waiter { events: AvatarEvent[]; wake: () => void; finish: (settled: boolean) => void }

/** Fans the coach's background outcomes out to the page's streams; a tool waiting on the coach claims their words. */
export class Relay {
  private clients = new Set<(outcome: Outcome) => void>();
  private backlog: Outcome[] = [];
  private waiters: Waiter[] = [];
  private readonly off: () => void;

  constructor(coach: Coach) {
    this.off = coach.subscribe((outcome) => this.push(outcome));
  }

  /** A page's stream. What happened while none was open is handed over first, in order. */
  listen(client: (outcome: Outcome) => void): () => void {
    this.clients.add(client);
    for (const outcome of this.backlog.splice(0)) client(outcome);
    return () => { this.clients.delete(client); };
  }

  private push(outcome: Outcome) {
    let sent = outcome;
    // The oldest waiting tool says these words; the stream carries the screen only.
    const claimer = this.waiters[0];
    if (claimer && outcome.events.length) {
      claimer.events.push(...outcome.events);
      sent = { ...outcome, events: [] };
    }
    for (const waiter of [...this.waiters]) waiter.wake();
    if (!this.clients.size) {
      this.backlog.push(sent);
      if (this.backlog.length > 12) this.backlog.shift();
      return;
    }
    for (const client of this.clients) {
      try {
        client(sent);
      } catch (err) {
        warn('a stream failed (%s)', (err as Error).message);
      }
    }
  }

  /** Wakes waiting tools to look again, after a change the coach does not stream (the safety hold). */
  poke() {
    for (const waiter of [...this.waiters]) waiter.wake();
  }

  /** Resolves when `done()` holds (checked on every outcome and poke) or after `ms`. */
  settle(done: () => boolean, ms: number): Promise<{ events: AvatarEvent[]; settled: boolean }> {
    if (done()) return Promise.resolve({ events: [], settled: true });
    return new Promise((resolve) => {
      const waiter: Waiter = {
        events: [],
        wake: () => { if (done()) waiter.finish(true); },
        finish: (settled) => {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve({ events: waiter.events, settled });
        },
      };
      const timer = setTimeout(() => waiter.finish(false), ms);
      this.waiters.push(waiter);
    });
  }

  close() {
    this.off();
    this.clients.clear();
    for (const waiter of [...this.waiters]) waiter.finish(false);
  }
}

export interface ToolRun { view: View; text: string }

const str = (value: unknown, max: number) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * A tool argument, read leniently: the platform drops a call whose arguments
 * do not fit the schema, so the schemas accept almost anything and the reading
 * happens here. The named field, else (when the host named it differently,
 * "goal_level", "injury") the other text fields joined, never the ones listed
 * in `besides`.
 */
export function arg(args: Record<string, unknown>, key: string, max: number, besides: string[] = []): string {
  const named = str(args?.[key], max);
  if (named) return named;
  // A bare number keeps its field's name: { minutes: 20 } is "20 minutes".
  const others = Object.entries(args ?? {}).filter(([k]) => k !== key && !besides.includes(k))
    .map(([k, v]) => (typeof v === 'number' ? `${v} ${k.replace(/_/g, ' ')}` : str(v, max))).filter(Boolean);
  return others.join(', ').slice(0, max);
}
const joined = (events: AvatarEvent[]) => events.map((e) => e.text).join(' ');
const busy = (coach: Coach) => { const v = coach.view(); return v.planning || v.rebuilding; };

/** What changed on the plan between two screens, in words; '' when nothing did. */
export function planChange(before: View, after: View): string {
  const now = after.plan;
  const was = before.plan;
  if (!now) return '';
  if (!was) return say.planReady(now, builtAround(after.constraints));
  if (JSON.stringify(now) === JSON.stringify(was)) return '';
  // A move video of a move the new plan no longer has was taken down with it.
  const dropped = before.flow.start_move && !after.flow.start_move ? before.flow.start_move : '';
  if (now.level !== was.level) return say.replanned(now, dropped);
  const line = rebuildSummaryLine(was, now);
  return line || dropped ? say.rebuilt(line, now, dropped) : '';
}

/** A move video that finished while a tool waited. */
function videoNews(before: View, after: View): string {
  const was = before.video?.status;
  const now = after.video?.status;
  if (now === was || !after.flow.start_move) return '';
  if (now === 'ready') return ` ${say.demoReady(after.flow.start_move)}`;
  if (now === 'error') return ` ${say.demoFailed(after.flow.start_move)}`;
  return '';
}

/**
 * A condition the host named, as the board and the stop sentence will say it
 * ("You have told me about a recent stroke"). Its own words when they read as
 * a condition; a plain phrase when they would not.
 */
export function conditionLabel(words: string): string {
  const t = words.toLowerCase().replace(/[^a-z' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:i(?:'m| am| was|'ve| have| had)(?: got| been| had)?|i|my)\s+/, '').trim();
  if (!t || t.split(' ').length > 6 || /\b(i|me|my|you)\b/.test(t)) return 'a health condition';
  return t;
}

const WHAT: Record<string, string> = {
  set_goal: 'choose what to train', set_level: 'set the level of the plan', add_limits: 'change the plan',
  start_move: 'start a move', start_over: 'start over',
};

/** Wait (bounded) for a plan being built or rebuilt to land. True when it did. */
async function landed(coach: Coach, relay: Relay, waitMs: number): Promise<boolean> {
  if (!busy(coach)) return true;
  const { settled } = await relay.settle(() => !busy(coach) || coach.halted, waitMs);
  return settled;
}

/** After an action that may build a plan: the plan that landed, or what is still on its way. */
async function finish(coach: Coach, relay: Relay, before: View, out: Outcome, waitMs: number): Promise<ToolRun> {
  const ok = await landed(coach, relay, waitMs);
  const after = coach.view();
  // The safety stop landed while the plan was being built: nothing was built, and that is what to say.
  if (coach.halted) return { view: after, text: say.clearance(after.constraints.clearance ?? []) };
  const change = planChange(before, after);
  if (change) return { view: after, text: change + videoNews(before, after) };
  const text = joined(out.events);
  if (!ok) return { view: after, text: text ? `${text} You will be told when it lands.` : say.stillBuilding(after) };
  return { view: after, text: text || say.nothingNew(after) };
}

/** The safety stop, from the host's words. Null when the words are an ordinary limit, not a stop. */
function stopFor(coach: Coach, words: string): string | null {
  const heard = cons.parseConstraints(words);
  const ordinary = heard.minutes || heard.equipment || heard.injuries.length || heard.avoid.length;
  if (!heard.clearance.length && ordinary) return coach.halted ? say.clearance([...coach.constraints.clearance]) : null;
  // Not a condition the rules know: the host judged it one a doctor must clear,
  // and a missed stop costs more than a needless one.
  const labels = heard.clearance.length ? heard.clearance : [conditionLabel(words)];
  const known = [...coach.constraints.clearance];
  coach.hear({ constraints: { ...cons.EMPTY, clearance: labels }, intent: null });
  const fresh = labels.filter((label) => !known.includes(label));
  return say.clearance(fresh.length ? fresh : [...coach.constraints.clearance]);
}

/** One of the host's tool calls. The text is what the host says next. */
export async function runTool(coach: Coach, relay: Relay, name: string, args: Record<string, unknown> = {}, waitMs = PLAN_WAIT_MS): Promise<ToolRun> {
  const before = coach.view();
  const done = (text: string): ToolRun => ({ view: coach.view(), text });

  if (name === 'stop_for_safety') {
    const condition = arg(args, 'condition', 160);
    const stopped = stopFor(coach, condition || 'a health condition');
    if (stopped) return done(stopped);
    const limits = await runTool(coach, relay, 'add_limits', { words: condition }, waitMs);
    return { ...limits, text: `${say.notAStop()} ${limits.text}` };
  }
  if (!(name in WHAT)) throw new Error(`unknown tool ${name}`);
  if (coach.halted) return done(say.onHold(WHAT[name]));

  switch (name) {
    case 'set_goal': {
      const raw = arg(args, 'goal', 80, ['level']);
      const read = readLevel(str(args.level, 60));
      const level = read === 'easier' || read === 'harder' ? null : read;
      const said = readLevel(raw);
      // "Beginner" given as what to train: it is the level.
      if (said && said !== 'easier' && said !== 'harder' && !goalIn(raw) && (raw.split(' ').length <= 3)) {
        return runTool(coach, relay, 'set_level', { level: said.toLowerCase() }, waitMs);
      }
      // A level said inside the goal ("core and cardio, I'm a beginner") is the level, not part of the goal.
      const inside = splitLevel(raw);
      const goal = inside.goal ? goalIn(inside.goal, coach.constraints.injuries) ?? acceptGoal(inside.goal) : null;
      if (!goal) return done(say.noGoal());
      const stage = coach.stage();
      if (stage !== 'goal' && stage !== 'level') return done(say.goalLocked(before));
      const known = level ?? inside.level;
      const out = coach.hear({ constraints: cons.EMPTY, intent: { kind: 'goal', goal, ...(known ? { level: known } : {}) } });
      return finish(coach, relay, before, out, waitMs);
    }

    case 'set_level': {
      // "Beginner", "a beginner", "beginner level", "a bit harder": all read here.
      const read = readLevel(arg(args, 'level', 80));
      let level: Level | null;
      if (read === 'easier' || read === 'harder') {
        const current = before.plan || before.planning ? before.flow.level : '';
        level = current ? stepLevel(current, read) : null;
        if (!level) return done(say.noPlanToChange());
        if (level === current) return done(say.levelEdge(level, read));
      } else {
        level = read;
      }
      if (!level) return done(say.noLevel());
      const relevel = Boolean(before.plan || before.planning);
      const out = coach.hear({ constraints: cons.EMPTY, intent: relevel ? { kind: 'relevel', level } : { kind: 'level', level } });
      return finish(coach, relay, before, out, waitMs);
    }

    case 'add_limits': {
      const words = arg(args, 'words', 500, ['heard']);
      // The page attaches the user's own recent words: live, "my left knee is bad,
      // and I only have twenty minutes" reached here as "my left knee is bad".
      // A stop is never taken from them here (the page has its own check for that).
      const own = cons.parseConstraints(str(args.heard, 1000));
      // The host's words win where both name the same thing.
      const heard = cons.mergeConstraints({ ...own, clearance: [] }, cons.parseConstraints(words));
      // A condition passed as a limit is still a stop.
      if (heard.clearance.length) return done(stopFor(coach, words)!);
      if (!cons.hasAny(heard)) return done(say.limitUnread());
      const was = coach.constraints;
      coach.hear({ constraints: heard, intent: null });
      const labels = cons.newConstraintLabels(was, coach.constraints);
      if (!labels.length) return done(say.limitKnown(cons.newConstraintLabels(cons.EMPTY, heard).join(', ') || 'that', Boolean(before.plan)));
      // No plan on the screen: the limits go into the plan when it is built (or bind it when it lands).
      if (!before.plan) return done(say.limitNoted(labels, before.planning));
      const ok = await landed(coach, relay, waitMs);
      const after = coach.view();
      if (coach.halted) return { view: after, text: say.clearance(after.constraints.clearance ?? []) };
      const change = planChange(before, after);
      if (change) return { view: after, text: say.limitApplied(labels, change) };
      return { view: after, text: ok ? say.limitNoChange(labels) : say.stillRebuilding(labels) };
    }

    case 'start_move': {
      const raw = arg(args, 'move', 120);
      if (!before.plan) return done(before.planning ? say.stillBuilding(before) : say.noPlanYet());
      if (!raw) return done(say.whichMove(before.plan));
      const move = moveIn(before.plan, raw);
      const out = coach.hear({ constraints: cons.EMPTY, intent: move ? { kind: 'move', move } : { kind: 'unknownMove', heard: raw } });
      return done(joined(out.events) || say.nothingNew(coach.view()));
    }

    case 'start_over': {
      const out = coach.command('restart');
      return done(out.refused ? say.onHold('start over') : joined(out.events));
    }
  }
  throw new Error(`unknown tool ${name}`);
}

const TAPPED: Record<Command, (value: string) => string> = {
  goal: (value) => `the goal "${value}"`,
  level: (value) => `the level "${value}"`,
  relevel: (value) => `"Rebuild as ${value}"`,
  move: (value) => `the move "${baseMoveName(value)}"`,
  restart: () => '"Start over"',
};

/** A tap on the board: it acts at once, and the host is told in an event (it cannot see the screen). */
export function press(coach: Coach, command: Command, value = ''): { view: View; event?: string; refused?: string } {
  const before = coach.view();
  const out = coach.command(command, value);
  if (out.refused) return { view: out.view, refused: out.refused };
  // Without a plan model the plan lands with the tap: say the plan, not "it is being built" and then the plan.
  const text = planChange(before, out.view) || joined(out.events);
  return { view: out.view, ...(text ? { event: pressed(TAPPED[command](value), text) } : {}) };
}

/**
 * The page's own safety check: a condition no exercise swap makes safe, found
 * in the user's words, freezes the plan at once, whether or not the host has
 * called stop_for_safety. Null when the words carry none.
 */
export function hold(coach: Coach, text: string): View | null {
  const clearance = cons.parseConstraints(String(text ?? '').slice(0, 600)).clearance;
  if (!clearance.length) return null;
  coach.hear({ constraints: { ...cons.EMPTY, clearance }, intent: null });
  return coach.view();
}
