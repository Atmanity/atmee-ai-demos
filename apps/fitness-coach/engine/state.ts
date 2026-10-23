// The session's board: what the screen shows, held in one place.
//
// Ported from the original `state.py`. The original kept this so a remounted
// panel could be handed the whole board back; here it is simply the server's
// truth, and `snapshot()` is what the page draws (in the original wire shapes,
// so the ported panel parsers read it unchanged).
import * as cons from './constraints.ts';
import type { FitnessPlan, FlowPayload, FlowStep, VideoPayload } from './types.ts';

/**
 * Steps the board knows, in order. `planning` is not set here (the board
 * infers it from a goal and a level with no plan yet) but it is listed so both
 * halves agree on the vocabulary.
 */
export const FLOW_STEPS: FlowStep[] = ['idle', 'goal_selected', 'level_selected', 'planning', 'plan_ready'];

export class FitnessState {
  step: FlowStep = 'idle';
  goal = '';
  /** The level the flow has ACCEPTED. It goes on the wire, so it never holds a guess. */
  level = '';
  /**
   * A level heard in passing ("core and cardio, I'm a beginner") before the
   * flow asked for one. Kept apart from `level`: broadcasting it drew a
   * selected level and a "Setting up your plan…" spinner while the flow was
   * still waiting to be told, and the spinner never resolved.
   */
  overheardLevel = '';
  plan: FitnessPlan | null = null;
  video: VideoPayload | null = null;
  startMove = '';
  constraints: cons.Constraints = cons.EMPTY;

  noteGoal(goal: string) {
    this.goal = goal;
    this.step = 'goal_selected';
  }

  noteLevel(level: string) {
    this.level = level;
    this.step = 'level_selected';
  }

  /**
   * The plan carries its own goal and level: a plan whose header disagreed
   * with the flow chips above it looked like two workouts on one screen.
   */
  notePlan(plan: FitnessPlan) {
    this.plan = plan;
    this.goal = plan.goal || this.goal;
    this.level = plan.level || this.level;
    this.step = 'plan_ready';
  }

  /**
   * Merge in what one utterance carried. True when anything changed: that is
   * what decides whether a plan is rebuilt, and republishing an identical plan
   * every turn would redraw the board under the user for no reason.
   */
  noteConstraints(heard: cons.Constraints): boolean {
    const merged = cons.mergeConstraints(this.constraints, heard);
    if (cons.sameConstraints(merged, this.constraints)) return false;
    this.constraints = merged;
    return true;
  }

  constraintsPayload() {
    return cons.payload(this.constraints);
  }

  flowPayload(): FlowPayload {
    return {
      step: this.step,
      goal: this.goal,
      level: this.level,
      // The move the clip is OF: a video stage that cannot name its move is
      // the "prominent empty box" the original brief warns about.
      start_move: this.startMove,
      constraints: this.constraintsPayload(),
    };
  }

  /** Everything the board needs, in the original wire shapes. */
  snapshot() {
    return {
      flow: this.flowPayload(),
      plan: this.plan ? structuredClone(this.plan) : null,
      video: this.video ? { ...this.video } : null,
      constraints: this.constraintsPayload(),
    };
  }
}
