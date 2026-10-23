// What the board, the page and the director share. Chess has no hidden
// information, so the whole snapshot is public: the board lives in the page.

export type Side = 'white' | 'black';
export type Strength = 'full' | 'casual' | 'beginner';

/** Who won. Kept from the original: 'agent' is the avatar, 'opponent' is the player (the avatar's opponent). */
export type GameResultWinner = 'agent' | 'opponent' | 'draw';

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient_material'
  | 'threefold_repetition'
  | 'fifty_moves'
  | 'resignation';

export type GamePhase = 'playing' | 'game-over';

/** One legal move, both notations. */
export interface LegalMove {
  san: string;
  uci: string;
}

export interface LastMove {
  san: string;
  uci: string;
  by: 'user' | 'agent';
}

/** A move the board refused, and why: shown under the board until the position moves on. */
export interface SnapshotRefusal {
  move?: string | null;
  reason?: string | null;
}

/**
 * The board's public snapshot: the one thing the panel draws and the director
 * describes. Same shape as the original agent's snapshot, so the ported panel
 * components read it unchanged.
 */
export interface ChessSnapshot {
  game: 'chess';
  phase: GamePhase;
  user_color: Side;
  /** "full", "casual" or "beginner": how far down its own ranking the opponent plays. Effort, not a rating. */
  difficulty: string;
  fen: string;
  turn: 'user' | 'agent' | null;
  in_check: boolean;
  check_square: string | null;
  legal_moves: LegalMove[];
  history: string[];
  opening?: string | null;
  last_move: LastMove | null;
  result: { winner: GameResultWinner; reason: GameEndReason } | null;
  last_refusal?: SnapshotRefusal | null;
}

/** Something the player asked the board to do, by any route (button, typing, speech). */
export type Action =
  | { kind: 'move'; text: string }
  | { kind: 'side'; side: Side | 'other' | string }
  | { kind: 'difficulty'; level: string }
  | { kind: 'resign' }
  | { kind: 'new' };
