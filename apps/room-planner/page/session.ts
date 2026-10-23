// One client at the drawing board: the planner, the critic, and the three ways
// a change arrives (the architect's tool calls, a hand on the plan, a photo),
// wired to the architect.
//
// Framework-free so the order of things can be tested without a browser:
// every change is applied, then the architect's state is replaced, then she
// hears about it (a tool's result, or an event for a change by hand), so what
// she says next is grounded in the plan as it now is.
import { issues } from '../engine/compliance.ts';
import { byHand, issueCue, planState, say, type Step } from '../engine/director.ts';
import { contextOf, type JudgeContext } from '../engine/judge.ts';
import { Critic, isDrawn, Planner } from '../engine/planner.ts';
import { runTool } from '../engine/tools.ts';
import type { Intent, PlanSnapshot } from '../engine/types.ts';

/** What the session needs from the architect (useAvatar provides it). */
export interface AvatarPort {
  state(text: string): void;
  event(text: string, ttlS?: number): void;
  /** Whether she is in the room. What happened before she arrived is not news. */
  live(): boolean;
}

/** What the session needs from the app's server (reading photos). */
export interface ServerPort {
  photo(purpose: 'room' | 'piece', input: { image: { mimeType: string; base64: string } } | { sample: 'room' }, plan: JudgeContext): Promise<{ intents: Intent[]; seen: string } | { error: string }>;
}

/** What the page shows after a change: the plan, a refusal to point at, whether the sheet was just drawn. */
export interface Change { snapshot: PlanSnapshot; refusal: string | null; drew: boolean }

export type SendResult = { applied: true } | { applied: false; reason: string };

export class HomeSession {
  readonly planner: Planner;
  private critic = new Critic();
  private lastState = '';

  constructor(private avatar: AvatarPort, private server: ServerPort, private onChange: (change: Change) => void, size = { w_cm: 900, h_cm: 700 }) {
    this.planner = new Planner(size.w_cm, size.h_cm);
    this.critic.look(issues(this.planner.home), { hasRooms: false });
  }

  snapshot(): PlanSnapshot { return this.planner.snapshot(); }

  /** Re-send the state (a new call starts with it). */
  restate(): void {
    this.lastState = '';
    this.publish({ snapshot: this.snapshot(), refusal: null, drew: false });
  }

  /** The opening, told once the architect is on her way. */
  opening(): string {
    return say.opening(this.snapshot());
  }

  /**
   * One of the architect's tool calls: applied, shown, and answered with the
   * words she speaks from. A refusal is shown on the plan as well.
   */
  tool(name: string, args: Record<string, unknown> = {}): string {
    const outcome = runTool(this.planner, this.critic, name, args);
    const last = [...outcome.steps].reverse().find((s) => s.result.applied)?.result;
    this.publish({ snapshot: last?.applied ? last.snapshot : this.snapshot(), refusal: outcome.refusal, drew: outcome.drew });
    return outcome.text;
  }

  /** A click or a drag: applied at once; a refusal is shown, not spoken. */
  panel(intent: Intent): SendResult {
    const result = this.planner.apply(intent);
    if (!result.applied) return result;
    const steps: Step[] = [{ intent, result }];
    const fresh = this.critic.look(result.snapshot.issues, { hasRooms: isDrawn(result.snapshot) });
    this.publish({ snapshot: result.snapshot, refusal: null, drew: result.done.kind === 'draw_sheet' });
    for (const event of byHand(steps, fresh, result.snapshot)) this.tell(event.text, event.ttl);
    return { applied: true };
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
    this.publish({ snapshot: snap, refusal: null, drew: false });
    let text = say.photo(purpose, added, refused, answer.seen);
    if (fresh.length) text += ` ${issueCue(fresh[0], fresh.length)}`;
    this.tell(text, 40);
    return { added, refused, seen: answer.seen };
  }

  /**
   * An event, only while the architect is there: a plan worked on by hand
   * before the call would otherwise greet her with stale news.
   */
  private tell(text: string, ttl: number): void {
    if (this.avatar.live()) this.avatar.event(text, ttl);
  }

  private publish(change: Change): void {
    const text = planState(change.snapshot);
    if (text !== this.lastState) {
      this.lastState = text;
      this.avatar.state(text);
    }
    this.onChange(change);
  }
}
