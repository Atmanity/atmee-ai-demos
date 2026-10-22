// What an utterance means to the game. The avatar never knows the city, so
// the app decides: the few command words by rules, and "is this a guess, and
// is it the city?" by the app's own model call (server-side only: the page
// never learns the answer early).

export type Command = 'hint' | 'skip' | 'next' | 'new';

const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

const COMMANDS: [Command, RegExp][] = [
  ['new', /\b(new game|play again|start (a new game|over|again)|restart)\b/],
  ['skip', /\b(i give up|give up|skip (it|this|this one|the city)?|reveal (it|the answer)|tell me (the answer|what it is)|i (don't|do not) know)\b|^skip$/],
  ['next', /^(ok(ay)? )?(next|next city|next one|go on|next round|let's go on|move on|on to the next( one| city)?)( please)?$|\b(next city|next round|the next one)\b/],
  ['hint', /\b(hint|clue)s?\b/],
];

/** A command named in the utterance, or null. Checked before any guess. */
export function commandIn(text: string): Command | null {
  const t = norm(text);
  for (const [command, pattern] of COMMANDS) if (pattern.test(t)) return command;
  return null;
}

/** Without a model: the city's name (accents and case aside) appearing in the utterance. */
export function namesCity(text: string, city: { name: string }): boolean {
  const t = ` ${norm(text)} `;
  return t.includes(` ${norm(city.name)} `);
}

export const GUESS_SCHEMA = {
  type: 'object',
  properties: {
    isGuess: { type: 'boolean', description: 'The player is naming a place as their answer.' },
    place: { type: 'string', description: 'The place they named, as said; empty if none.' },
    correct: { type: 'boolean', description: 'The place is the mystery city (other names, spellings and mishearings of it count).' },
  },
  required: ['isGuess', 'place', 'correct'],
};

export const guessPrompt = (city: { name: string; country: string }, utterance: string) => `A player in a city-guessing game said: "${utterance}"
The mystery city is ${city.name}, ${city.country}. Speech recognition may have misheard place names.
Decide whether they are naming a place as their guess (a question about the game, small talk or "I don't know" is not a guess), which place, and whether it is the mystery city.`;
