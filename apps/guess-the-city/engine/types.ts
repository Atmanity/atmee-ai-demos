// What the server and the page share. The page only ever sees a View: the
// city's name, country and fun fact stay empty until the round is revealed.
export interface City { name: string; country: string; hints: string[]; funFact: string }

export interface View {
  round: number;          // 1-based; past the last city once the game is over
  rounds: number;
  score: number;
  over: boolean;
  hints: string[];        // the clues handed out this round, in order
  nextHint: string | null; // the clue the avatar gives if asked (staged, not shown); null when none is left
  hintsTotal: number;
  revealed: boolean;
  correct: boolean;
  photo: string | null;   // an opaque URL that never names the city
  city: { name: string; country: string; funFact: string } | null;   // null until revealed
}

export type ActionKind = 'hint' | 'skip' | 'next' | 'new' | 'guess';

export interface Outcome {
  view: View;
  /** Which action it was, when it was one. */
  kind?: ActionKind;
  /** Whether the input was a game action; a typed turn that wasn't goes to the avatar as-is. */
  handled: boolean;
  /** What the avatar should be told about it, in its own words. */
  event?: string;
}
