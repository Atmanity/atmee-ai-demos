// Where a game's cities come from: a fresh deck from the app's own model call
// each game, so two games differ; the built-in deck when that fails, so a game
// always starts.
import type { City } from './types.ts';

export const FALLBACK_CITIES: City[] = [
  {
    name: 'Tokyo', country: 'Japan',
    hints: ['It has the busiest railway station on earth.', 'A famous scramble crossing sits outside that station.', "The world's tallest tower stands here."],
    funFact: 'Its metro area is home to more people than all of Canada.',
  },
  {
    name: 'Istanbul', country: 'Turkey',
    hints: ['This city spans two continents.', 'A strait runs through the middle of it.', 'It was once called Constantinople.'],
    funFact: 'It is the only major city built on two continents at once.',
  },
  {
    name: 'Rome', country: 'Italy',
    hints: ['An entire independent country sits inside it.', 'Its most famous arena is nearly 2,000 years old.', 'Legend says it was founded by twin brothers.'],
    funFact: 'Around €1.5 million is thrown into one of its fountains each year.',
  },
];

const REGIONS = ['Africa', 'South America', 'East Asia', 'South Asia', 'the Middle East', 'Northern Europe', 'Southern Europe', 'Eastern Europe', 'North America', 'Central America and the Caribbean', 'Oceania', 'Southeast Asia'];

/** The model favours a handful of cities; a random starting region and the recent ones to avoid keep games different. */
export function deckPrompt(avoid: string[], random = Math.random) {
  const region = REGIONS[Math.floor(random() * REGIONS.length)];
  return `Pick 3 well-known cities for a guessing game, from 3 different countries and different continents; make the first one from ${region}.
For each, write three hints ordered EASIEST LAST: the first genuinely hard, the third obvious.
Never name the city or its country in a hint. Add one surprising fun fact.
Prefer cities a photo would make recognisable.${avoid.length ? ` Do not use: ${avoid.join(', ')}.` : ''}`;
}

export const DECK_SCHEMA = {
  type: 'object',
  properties: {
    cities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, country: { type: 'string' },
          hints: { type: 'array', items: { type: 'string' } }, funFact: { type: 'string' },
        },
        required: ['name', 'country', 'hints', 'funFact'],
      },
    },
  },
  required: ['cities'],
};

/** A city the game can run: a name, a country, three usable hints, none of which names it. */
export function validCity(c: unknown): c is City {
  if (!c || typeof c !== 'object') return false;
  const { name, country, hints, funFact } = c as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || typeof country !== 'string' || !country.trim()) return false;
  if (!Array.isArray(hints) || hints.length < 3 || hints.slice(0, 3).some((h) => typeof h !== 'string' || !h.trim())) return false;
  if (typeof funFact !== 'string') return false;
  return !hints.slice(0, 3).some((h) => (h as string).toLowerCase().includes(name.toLowerCase()));
}

export function deckFrom(raw: unknown): City[] | null {
  const cities = ((raw as { cities?: unknown[] })?.cities ?? []).filter(validCity);
  if (cities.length < 3) return null;
  return cities.slice(0, 3).map((c) => ({ name: c.name.trim(), country: c.country.trim(), hints: c.hints.slice(0, 3).map((h) => h.trim()), funFact: c.funFact.trim() }));
}

export function shuffledFallback(): City[] {
  return structuredClone(FALLBACK_CITIES).sort(() => Math.random() - 0.5);
}
