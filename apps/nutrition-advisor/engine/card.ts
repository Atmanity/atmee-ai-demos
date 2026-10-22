// The app's own model calls for content: a card for a named food, a card from
// a photo, and a recipe's ingredients and steps (server.ts makes the calls with
// `structured()`). In the original, the avatar's LLM filled these in as tool
// arguments; the rules its tool body applied to them (clamp the score, coerce
// the source, drop blank recipe slots, never render one letter per step) are
// here, applied to the model's JSON before anything reaches the screen.
import type { FoodAsk, NutritionData, RecipeDetails, RecipeIdea, Source } from './types.ts';

const RECIPES = {
  type: 'array',
  description: 'Three simple, practical recipe ideas that use this food.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name, at most five words.' },
      description: { type: 'string', description: 'One plain sentence.' },
    },
    required: ['name', 'description'],
  },
};

const CARD_PROPERTIES = {
  product_name: { type: 'string', description: 'A short title for the food, with its portion word if it has one ("Medium banana").' },
  serving_size: { type: 'string', description: 'The portion these figures are for, with grams where known ("1 medium (118 g)").' },
  calories: { type: 'number' },
  protein_g: { type: 'number' },
  carbs_g: { type: 'number' },
  fat_g: { type: 'number' },
  fiber_g: { type: 'number' },
  sugar_g: { type: 'number', description: 'TOTAL sugars, in grams.' },
  sodium_mg: { type: 'number' },
  health_score: { type: 'integer', description: "1 to 10: the food's general nutrition. Never a judgement about anyone's health or condition." },
  health_summary: { type: 'string', description: 'One or two short, warm sentences on what stands out. No advice to the user, no markdown.' },
  recipes: RECIPES,
};

export const CARD_SCHEMA = {
  type: 'object',
  properties: CARD_PROPERTIES,
  required: Object.keys(CARD_PROPERTIES),
};

export const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    is_food: { type: 'boolean', description: "The photo shows a food, a drink, or a food product's packaging or label." },
    seen: { type: 'string', description: 'What the photo shows, in a few words.' },
    source: { type: 'string', enum: ['label', 'estimate'], description: '"label" only when the figures are read off a legible nutrition label in the photo.' },
    portion_assumed: { type: 'boolean', description: 'The portion is your assumption rather than printed on a label.' },
    ...CARD_PROPERTIES,
  },
  required: ['is_food', 'seen', 'source', 'portion_assumed', ...Object.keys(CARD_PROPERTIES)],
};

export const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    ingredients: { type: 'array', items: { type: 'string' }, description: '4 to 8 practical ingredients, each with its amount.' },
    preparation_steps: { type: 'array', items: { type: 'string' }, description: '4 to 8 concise steps, in order.' },
  },
  required: ['ingredients', 'preparation_steps'],
};

export const CARD_SYSTEM = 'You are a careful nutrition reference for a food app. You give typical figures for one food, as a nutrition label would, and simple recipe ideas.';
export const RECIPE_SYSTEM = 'You write short, practical home recipes for a food app. Everything you write is shown on a card and read aloud.';

const CARD_RULES = `Figures are per that serving; sugar_g is TOTAL sugars; sodium is in mg. Round sensibly (at most one decimal).
health_score: 1 to 10 for the food's general nutrition (fiber, protein and nutrient density count up; added sugar, sodium, saturated fat and heavy processing count down). It ranks the food, never anyone's health or medical condition.
health_summary: one or two short sentences on what stands out, warm and non-judgmental ("high in sugar for a snack", never "you shouldn't eat this"). No advice to the reader, no markdown.
recipes: three simple, practical ideas that use this food: a short name and one sentence each.`;

/** The card for a food the user named (or typed). */
export function cardPrompt(food: FoodAsk): string {
  const quantity = food.quantity.trim();
  return `The user asked about: "${food.name}"${quantity ? `, and said how much: "${quantity}"` : ' (they did not say how much)'}.
Give the nutrition for ${quantity ? 'exactly that quantity' : 'one typical serving or item (a medium banana, a 170 g pot of yogurt, a cup of cooked rice)'}, from standard reference values (USDA or a typical label). Name the portion in serving_size, with grams where you can.
product_name: a short title for the food${quantity ? '' : ', with its portion word if it has one ("Medium banana")'}; no brand unless the user named one.
${CARD_RULES}`;
}

/** The card for a photo the user shared (or the sample). */
export const PHOTO_PROMPT = `The user shared this photo with a nutrition app.
is_food: whether it shows a food, a drink, or a food product's packaging or nutrition label; seen: what it shows, in a few words.
If a nutrition facts label is visible and legible, read it: source "label", the label's own serving size and figures, portion_assumed false, product_name from the package.
Otherwise identify the food and estimate typical figures for the portion you can see: source "estimate", portion_assumed true, serving_size naming the portion you assumed (with grams where you can). A plate of several foods is one card for the whole plate.
${CARD_RULES}
If it is not food, set is_food false, say what it shows in seen, and fill the rest with zeros and empty strings.`;

/** The ingredients and steps for a recipe, under the name the user chose. */
export function recipePrompt(idea: RecipeIdea, food: string): string {
  return `Write the recipe "${idea.name}"${idea.description ? ` (${idea.description})` : ''}${food ? `, a recipe idea for ${food}` : ''}.
ingredients: 4 to 8 practical ingredients, each with its amount ("1 ripe banana", "120 g Greek yogurt").
preparation_steps: 4 to 8 concise steps in order, each one plain sentence that can be said aloud.
No numbering, bullets, asterisks or markdown in any item.`;
}

// -- what the model sends, made safe to show ---------------------------------

const MAX_NAME = 80;
const MAX_SUMMARY = 320;
const MAX_INGREDIENT = 100;
const MAX_STEP = 220;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** A figure: finite, never negative, at most one decimal. */
function figure(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10) / 10;
}

/**
 * The score, clamped rather than trusted: it drives a gauge, and a model that
 * returns 0 or 11 would render off the end of it. Missing means the middle.
 */
export function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/**
 * Where the numbers came from. Anything that is not "label" is an estimate:
 * the default has to be the humbler claim. A figure read off a label and one
 * recalled from training are different claims, and the thing users say they
 * fear most is a number they cannot check.
 */
export function sourceOf(value: unknown): Source {
  return String(value ?? '').trim().toLowerCase() === 'label' ? 'label' : 'estimate';
}

/**
 * The model's list of steps or ingredients, however it sent it.
 *
 * A plain string gets through often enough, and splitting it into characters
 * renders one letter per step: a card of single letters is a worse outcome than
 * no card. And numbering, bullets or asterisks inside an item are printed as
 * literal punctuation on the card and read aloud.
 */
export function lines(value: unknown): string[] {
  let items: string[] = [];
  if (typeof value === 'string') items = value.split(',');
  else if (Array.isArray(value)) items = value.map((item) => (item == null ? '' : String(item)));
  return items
    .map((item) => item.replace(/^\s*(?:#+\s+|[-*•·]+\s+|\d+[.)]\s+|step\s*\d+\s*[.:)-]?\s*)/i, '').replace(/\*\*|__|`/g, '').trim())
    .filter(Boolean);
}

/**
 * A card from the model's JSON, or null when there is no food to show.
 *
 * `source` and `portionAssumed` are the app's decision where it can make one:
 * a food the user only named is always an estimate, and its portion is assumed
 * unless they said how much. Only a photo's reading can claim "label".
 */
export function cardFrom(raw: unknown, claims: { source: unknown; portionAssumed: unknown }): NutritionData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = clip(str(r.product_name), MAX_NAME);
  if (!name) return null;
  const recipes: RecipeIdea[] = Array.isArray(r.recipes)
    ? r.recipes
        .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}))
        .map((item) => ({ name: clip(str(item.name), 60), description: clip(str(item.description), 200) }))
        .filter((idea) => idea.name)
        .slice(0, 3)
    : [];
  return {
    product_name: name,
    serving_size: clip(str(r.serving_size), 80),
    calories: Math.round(figure(r.calories)),
    nutrients: {
      protein_g: figure(r.protein_g),
      carbs_g: figure(r.carbs_g),
      fat_g: figure(r.fat_g),
      fiber_g: figure(r.fiber_g),
      sugar_g: figure(r.sugar_g),
      sodium_mg: Math.round(figure(r.sodium_mg)),
    },
    health_score: clampScore(r.health_score),
    health_summary: clip(str(r.health_summary), MAX_SUMMARY),
    recipes,
    source: sourceOf(claims.source),
    portion_assumed: claims.portionAssumed === true,
  };
}

/**
 * A recipe from the model's JSON, titled with the name the user chose.
 *
 * The name is the app's, never the model's: the user pointed at a card, and no
 * paraphrase of it is truer. (In the original the model echoed the name back
 * and paraphrased it, "Berry Parfait Bowl" for a card that said "Berry
 * parfait", and the tapped card spun forever waiting for a title it never got.)
 */
export function recipeFrom(raw: unknown, name: string, description = ''): RecipeDetails | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ingredients = lines(r.ingredients).slice(0, 10).map((item) => clip(item, MAX_INGREDIENT));
  const steps = lines(r.preparation_steps).slice(0, 8).map((item) => clip(item, MAX_STEP));
  const title = clip(name.trim(), 60);
  if (!title || (!ingredients.length && !steps.length)) return null;
  return { recipe_name: title, description, ingredients, preparation_steps: steps };
}
