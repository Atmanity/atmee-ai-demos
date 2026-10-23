// Is the place the player named the mystery city? The avatar passes the place
// it heard to check_guess; the server decides with its own model call (other
// names, spellings and mishearings count), or by the name without one.

export type Command = 'hint' | 'skip' | 'next' | 'new';

/**
 * The game action the player's words clearly ask for, among those safe to do
 * twice (a clue is not: a second one would cost a point). The app's safety
 * net does it when the host does not call the tool itself.
 */
export function mustDo(text: string): 'reveal_answer' | 'next_city' | 'new_game' | null {
  const t = norm(text);
  if (/\b(new game|play again|start (a new game|over|again))\b/.test(t)) return 'new_game';
  if (/\b(i give up|give up|i (don't|do not) know|tell me (the answer|what it is)|reveal (it|the answer))\b/.test(t)) return 'reveal_answer';
  if (/^(ok(ay)? )?(next|next city|next one|go on|next round|move on|on to the next( one| city)?)( please)?$|\b(next city|next round|the next one)\b/.test(t)) return 'next_city';
  return null;
}

const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Without a model: the city's name (accents and case aside) appearing in what was said. */
export function namesCity(text: string, city: { name: string }): boolean {
  const t = ` ${norm(text)} `;
  return t.includes(` ${norm(city.name)} `);
}

export const MATCH_SCHEMA = {
  type: 'object',
  properties: { correct: { type: 'boolean', description: 'The place is the mystery city (other names, spellings and mishearings of it count).' } },
  required: ['correct'],
};

export const matchPrompt = (city: { name: string; country: string }, place: string) => `In a city-guessing game the mystery city is ${city.name}, ${city.country}. The player's answer, as speech recognition heard it, is: "${place}".
Is that answer the mystery city? Other names, local spellings and plausible mishearings of it count; a different city, a region or a country does not.`;
