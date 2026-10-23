// What the server and the page share. The page only ever sees a View: the
// city's name, country and fun fact stay empty until the round is revealed.
export interface City { name: string; country: string; hints: string[]; funFact: string }

export interface View {
  round: number;          // 1-based; past the last city once the game is over
  rounds: number;
  score: number;
  over: boolean;
  hints: string[];        // the clues handed out this round, in order
  hintsTotal: number;
  revealed: boolean;
  correct: boolean;
  photo: string | null;   // an opaque URL that never names the city
  city: { name: string; country: string; funFact: string } | null;   // null until revealed
  results: RoundResult[];  // the rounds already revealed, in order (never one still hidden)
}

export interface RoundResult { name: string; country: string; correct: boolean; points: number }
