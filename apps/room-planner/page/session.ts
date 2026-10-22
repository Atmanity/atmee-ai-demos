// One client at the drawing board: the planner, the critic, and the three ways
// in (a hand on the plan, typed words, spoken words), wired to the avatar.
//
// Framework-free so the order of things can be tested without a browser:
// every change is applied, then the avatar's state is replaced, then the event
// for it is sent, in that order, so the avatar's next words are grounded.
import { issues } from '../engine/compliance.ts';
import { eventsFor, issueCue, planState, say, type Source, type Step } from '../engine/director.ts';
import { contextOf, rulesFor, type JudgeContext, type Line } from '../engine/judge.ts';
import { Critic, isDrawn, Planner } from '../engine/planner.ts';
import type { Intent, PlanSnapshot } from '../engine/types.ts';

/** What the session needs from the avatar (useAvatar provides it). */
export interface AvatarPort {
  state(text: string): void;
  event(text: string, ttlS?: number): void;
  /** Whether the avatar is in the room. Outcomes from before it arrived are not news. */
  live(): boolean;
}

/** What the session needs from the app's server (the model calls). */
export interface ServerPort {
  judge(text: string, plan: JudgeContext, recent: Line[]): Promise<{ intents: Intent[]; ask: string | null } | null>;
  photo(purpose: 'room' | 'piece', input: { image: { mimeType: string; base64: string } } | { sample: 'room' }, plan: JudgeContext): Promise<{ intents: Intent[]; seen: string } | { error: string }>;
}

export interface Change { snapshot: PlanSnapshot; refusal: string | null }

/** Whether words were an app action, and what the planner said to it. */
export interface Heard { handled: boolean; refusal: string | null }

export class HomeSession {
  readonly planner: Planner;
  private critic = new Critic();
  private lastState = '';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private avatar: AvatarPort, private server: ServerPort, private onChange: (change: Change) => void, size = { w_cm: 900, h_cm: 700 }) {
    this.planner = new Planner(size.w_cm, size.h_cm);
    this.critic.look(issues(this.planner.home), { hasRooms: false });
  }

  snapshot(): PlanSnapshot { return this.planner.snapshot(); }

  /** Re-send the state (a new avatar session starts with it). */
  restate(): void {
    this.lastState = '';
    this.publish(this.snapshot(), null);
  }

  /** The app's opening, as an event, once per avatar session. */
  open(): void {
    this.avatar.event(say.opening(this.snapshot()), 60);
  }

  /** A click or a drag: applied at once; a refusal is shown, not spoken. */
  panel(intent: Intent): { applied: true } | { applied: false; reason: string } {
    const result = this.planner.apply(intent);
    if (!result.applied) return result;
    this.after('panel', [{ intent, result }]);
    return { applied: true };
  }

  /**
   * Words, spoken or typed: judged by the rules, then by the server's model,
   * then applied in order (stopping at the first refusal), and told to the
   * avatar as one event. Utterances are handled one at a time, in order.
   */
  words(text: string, how: 'spoken' | 'typed', recent: Line[] = []): Promise<Heard> {
    const run = this.queue.then(() => this.judgeAndApply(text, how, recent));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async judgeAndApply(text: string, how: 'spoken' | 'typed', recent: Line[]): Promise<Heard> {
    const plan = contextOf(this.snapshot());
    let intents = rulesFor(text, plan);
    let ask: string | null = null;
    if (!intents) {
      const answer = await this.server.judge(text, plan, recent).catch(() => null);
      intents = answer?.intents ?? null;
      ask = answer?.ask ?? null;
    }
    if (!intents?.length) {
      if (!ask) return { handled: false, refusal: null };
      this.tell(say.ask(ask), 20);
      return { handled: true, refusal: null };
    }
    const steps: Step[] = [];
    for (const intent of intents) {
      const result = this.planner.apply(intent);
      steps.push({ intent, result });
      if (!result.applied) break;
    }
    this.after(how, steps);
    const refused = steps.find((s) => !s.result.applied);
    return { handled: true, refusal: refused && !refused.result.applied ? refused.result.reason : null };
  }

  /**
   * A photo of a room or a piece: read on the server into kit pieces, each
   * placed by the planner (one that does not fit is reported, not forced).
   */
  async photo(purpose: 'room' | 'piece', input: { image: { mimeType: string; base64: string } } | { sample: 'room' }): Promise<{ added: string[]; refused: string[]; seen: string } | { error: string }> {
    const answer = await this.server.photo(purpose, input, contextOf(this.snapshot()));
    if ('error' in answer) return answer;
    const added: string[] = [];
    const refused: string[] = [];
    for (const intent of answer.intents) {
      const result = this.planner.apply(intent);
      const label = String(intent.type).replaceAll('_', ' ');
      if (result.applied) added.push(`a ${result.done.item!.label.toLowerCase()}${result.done.item!.room ? ` in the ${result.done.item!.room.toLowerCase()}` : ''}`);
      else refused.push(`a ${label} (${result.reason})`);
    }
    const snap = this.snapshot();
    const fresh = this.critic.look(snap.issues, { hasRooms: isDrawn(snap) });
    this.publish(snap, null);
    let text = say.photo(purpose, added, refused, answer.seen);
    if (fresh.length) text += ` ${issueCue(fresh[0], fresh.length)}`;
    this.tell(text, 40);
    return { added, refused, seen: answer.seen };
  }

  private after(source: Source, steps: Step[]): void {
    // The last accepted step already carries the plan as it is now (a refused
    // step changes nothing), so the snapshot is not computed twice per click.
    const last = [...steps].reverse().find((s) => s.result.applied)?.result;
    const snap = last?.applied ? last.snapshot : this.snapshot();
    const fresh = this.critic.look(snap.issues, { hasRooms: isDrawn(snap) });
    const refused = steps.find((s) => !s.result.applied);
    this.publish(snap, refused && !refused.result.applied ? refused.result.reason : null);
    for (const event of eventsFor(source, steps, fresh, snap)) this.tell(event.text, event.ttl);
  }

  /**
   * An event, only while the avatar is there: a plan worked on by hand before
   * the session starts would otherwise greet the avatar with stale news.
   */
  private tell(text: string, ttl: number): void {
    if (this.avatar.live()) this.avatar.event(text, ttl);
  }

  private publish(snapshot: PlanSnapshot, refusal: string | null): void {
    const text = planState(snapshot);
    if (text !== this.lastState) {
      this.lastState = text;
      this.avatar.state(text);
    }
    this.onChange({ snapshot, refusal });
  }
}
