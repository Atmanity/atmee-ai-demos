// Is the place the player named the mystery city? The avatar passes the place
// it heard to check_guess; the server decides with its own model call (other
// names, spellings and mishearings count), or by the name without one.

export type Command = 'hint' | 'skip' | 'next' | 'new';

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
