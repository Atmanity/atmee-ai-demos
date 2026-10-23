// What the server and the page share. The page only ever sees a TableView:
// the opponent's hole cards are not in it until a real showdown, and the
// deck never leaves the server.

export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const STARTING_STACK = 1000;

export type Seat = 'user' | 'agent';
export type GamePhase = 'lobby' | 'playing' | 'hand-over' | 'game-over';
export type Street = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

/** Wire action kinds: an opening bet travels as `raise`, and amounts are raise-TO totals. */
export type PokerActionKind = 'fold' | 'check' | 'call' | 'raise';

/** What a player or a button can ask the table for. `all_in` is said, not a fifth action. */
export type Intent =
  | { kind: 'deal' }
  | { kind: 'restart' }
  | { kind: PokerActionKind | 'all_in'; amount?: number | null };

/** The last thing that happened at the table, echoed inside every view. */
export interface LastAction {
  by: Seat | 'table';
  kind: PokerActionKind | 'deal';
  amount?: number;
  applied: boolean;
}

export interface PlayerView {
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
}

export interface Winner {
  /** `split` when a showdown tied: the pot was shared, nobody won the hand. */
  who: Seat | 'split';
  amount: number;
  hand_rank: string | null;
}

export interface SessionLine {
  hands_played: number;
  hands_won_user: number;
  hands_won_agent: number;
  chips_up_user: number;
}

/**
 * The PUBLIC table: the shape `engine.py` broadcast to the panel. The user's
 * own cards are in it (the page is the user's surface); the opponent's are
 * not, until a real showdown.
 */
export interface TableView {
  game: 'poker';
  /** Bumped by every change the table accepts. */
  seq: number;
  phase: GamePhase;
  street: Street | null;
  board: string[];
  pot: number;
  current_bet: number;
  /** The increment AND the total, each under an honest name. */
  min_raise: number;
  min_raise_to: number;
  /** The most the player to act could raise to (everything they have). */
  max_raise_to: number;
  to_call: number;
  action_to: Seat | null;
  valid_actions: PokerActionKind[];
  button: Seat;
  players: { user: PlayerView; agent: PlayerView };
  user_hand: string[];
  revealed_hands: { user: string[]; agent: string[] } | null;
  winner: Winner | null;
  last_action: LastAction | null;
  session: SessionLine;
}

/**
 * A line the player said (as recognised) or typed, as the page heard it,
 * tagged with the table's `seq` at the moment it was said: words only ever
 * speak for the hand as it stood when they were said.
 */
export interface Heard {
  text: string;
  seq: number;
}
