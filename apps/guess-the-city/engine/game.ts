// The game's rules and state, free of everything else so they test alone.
// Scoring: a city guessed with no hints is worth 4 points; each hint costs
// one, never below 1.
import type { City, View } from './types.ts';

export const roundValue = (hintsUsed: number) => Math.max(1, 4 - Math.max(0, Math.floor(hintsUsed)));
/** What the next hint costs: 1 until the floor, then 0. */
export const hintCost = (hintsUsed: number) => roundValue(hintsUsed) - roundValue(hintsUsed + 1);

export class Game {
  round = 1;
  score = 0;
  index = 0;
  hintsGiven = 0;
  revealed = false;
  correct = false;

  constructor(public cities: City[]) {}

  get over() { return this.index >= this.cities.length; }

  /** The city in play: the last one once the deck is spent (clamped, never wrapped). */
  get city() { return this.cities[Math.min(this.index, this.cities.length - 1)]; }

  /** Score a correct guess. Returns the points won (0 if the round was already revealed or the game is over). */
  win(): number {
    if (this.revealed || this.over) return 0;
    const points = roundValue(this.hintsGiven);
    this.score += points;
    this.revealed = true;
    this.correct = true;
    return points;
  }

  hint(): string | null {
    if (this.revealed || this.over || this.hintsGiven >= this.city.hints.length) return null;
    return this.city.hints[this.hintsGiven++];
  }

  skip(): boolean {
    if (this.revealed || this.over) return false;
    this.revealed = true;
    this.correct = false;
    return true;
  }

  /** The next city; refused while the current one is still hidden. */
  next(): boolean {
    if (!this.revealed || this.over) return false;
    this.index += 1;
    this.round += 1;
    this.hintsGiven = 0;
    this.revealed = false;
    this.correct = false;
    return true;
  }

  view(photo: string | null): View {
    const city = this.city;
    return {
      round: this.round,
      rounds: this.cities.length,
      score: this.score,
      over: this.over,
      hints: city.hints.slice(0, this.hintsGiven),
      nextHint: this.revealed || this.over ? null : city.hints[this.hintsGiven] ?? null,
      hintsTotal: city.hints.length,
      revealed: this.revealed,
      correct: this.correct,
      photo,
      city: this.revealed ? { name: city.name, country: city.country, funFact: city.funFact } : null,
    };
  }
}
