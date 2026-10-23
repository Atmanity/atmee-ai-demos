// What to eat there. The original let the conversation model choose two or
// three dishes (recommend_local_food); here the app asks its own model once
// per country, as soon as the country is chosen, so the guide has real dishes
// staged before anyone asks. Without a model, a short built-in list.
import { canonicalCountry, FALLBACK_DISHES } from './countries.ts';
import type { DishIdea } from './trip.ts';

export const DISH_SCHEMA = {
  type: 'object',
  properties: {
    dishes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The dish as it is usually called.' },
          description: { type: 'string', description: 'One short, appetising sentence, spoken aloud: no lists, no colons.' },
          wikipediaTitle: { type: 'string', description: 'The title of its English Wikipedia article.' },
        },
        required: ['name', 'description', 'wikipediaTitle'],
      },
    },
  },
  required: ['dishes'],
};

export const dishPrompt = (country: string) => `A traveller is planning a trip to ${country}. Name three real, well-known dishes from ${country} worth crossing a city for: local classics, not international chains. For each, its usual name, one short appetising sentence, and the title of its English Wikipedia article.`;

/** The model's answer as dish ideas ([] when it is not usable). */
export function dishIdeasFrom(raw: unknown): DishIdea[] {
  const list = (raw as { dishes?: unknown })?.dishes;
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => {
    if (typeof d !== 'object' || d === null) return [];
    const { name, description, wikipediaTitle } = d as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return [];
    return [{ name: name.trim(), description: typeof description === 'string' ? description.trim() : '', ...(typeof wikipediaTitle === 'string' && wikipediaTitle.trim() ? { wiki: wikipediaTitle.trim() } : {}) }];
  });
}

/** The built-in dishes for a country, if it has any (the description comes from Wikipedia later). */
export function fallbackDishes(country: string): DishIdea[] {
  const list = FALLBACK_DISHES[country] ?? FALLBACK_DISHES[canonicalCountry(country)] ?? [];
  return list.map(({ name, wiki }) => ({ name, description: '', ...(wiki ? { wiki } : {}) }));
}
