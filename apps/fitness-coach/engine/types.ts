// What the server and the page share. The engine runs on the server (it
// calls the plan model and the video provider, and it is the one writer of
// the board); the page draws a View and keeps the host's picture of the
// screen in step with it.
//
// The plan, flow, video and constraint shapes are the original app's wire
// payloads, field for field, so the ported panel parsers read them unchanged.

/** The workout plan, in the original wire's field names. */
export interface FitnessPlan {
  plan_title: string;
  goal: string;
  level: string;
  duration_minutes: number;
  warmup_steps: string[];
  workout_steps: string[];
  coaching_cues: string[];
}

/** What the user said they have to work around. Absent fields were never said. */
export interface ConstraintsPayload {
  minutes?: number;
  /** 'none' when they have nothing, otherwise what they named. */
  equipment?: string;
  injuries?: string[];
  avoid?: string[];
  /** Conditions the coach cannot program around (the safety hold). */
  clearance?: string[];
}

export type FlowStep = 'idle' | 'goal_selected' | 'level_selected' | 'planning' | 'plan_ready';

export interface FlowPayload {
  step: FlowStep;
  goal: string;
  level: string;
  /** The move the demo is of. */
  start_move: string;
  constraints: ConstraintsPayload;
}

export type VideoStatus = 'generating' | 'ready' | 'error' | 'unavailable';

export interface VideoPayload {
  status: VideoStatus;
  request_id: string;
  prompt: string;
  /** On `ready` only: the clip, served by this app's own server. */
  video_url?: string;
  /** On `error` and `unavailable`. */
  message?: string;
}

/**
 * Where the guided flow stands. The app's step machine, not the avatar, owns
 * this: goal -> level -> planning -> move -> coach, with `hold` over all of it.
 */
export type Stage = 'goal' | 'level' | 'planning' | 'move' | 'coach' | 'hold';

export interface View {
  /** Monotonic per session: the page ignores a view older than the one it shows. */
  seq: number;
  stage: Stage;
  flow: FlowPayload;
  plan: FitnessPlan | null;
  video: VideoPayload | null;
  constraints: ConstraintsPayload;
  /** A level the user said before anyone asked for it (a hint, not an answer). */
  overheardLevel: string;
  /** Whether demo videos can be rendered at all in this session (a video key is configured). */
  demos: boolean;
  /** A plan (the first one, or one at a new level) is being generated. */
  planning: boolean;
  /** A rebuild for new limits is in flight: the moves on screen are the old ones. */
  rebuilding: boolean;
  /** Limits the avatar has already been given the chance to acknowledge. */
  acknowledged: string[];
  /** The six goals the screen offers, in order. */
  goalOptions: string[];
  /** Seeds the goal deal, so a reload shows the same six. */
  seed: string;
}

/** Something for the host to say in its own words: a tool's result, or an event. */
export interface AvatarEvent {
  text: string;
  ttl: number;
}

export interface Outcome {
  view: View;
  /** Whether the coach acted on the input (false: there was nothing for it to do). */
  handled: boolean;
  events: AvatarEvent[];
  /** A tap the app would not take, in words for the board. */
  refused?: string;
}

export type Level = 'Beginner' | 'Intermediate' | 'Advanced';
export const LEVELS: Level[] = ['Beginner', 'Intermediate', 'Advanced'];

/** What a tap or one of the host's tool calls asks the coach to do. */
export type Intent =
  | { kind: 'goal'; goal: string; level?: Level }
  | { kind: 'level'; level: Level }
  | { kind: 'move'; move: string }
  | { kind: 'relevel'; level: Level }
  | { kind: 'restart' }
  | { kind: 'unknownMove'; heard: string };

/** The buttons on the board. */
export type Command = 'goal' | 'level' | 'move' | 'relevel' | 'restart';
