// What an utterance asks the app to do. The original agent's LLM decided this
// by choosing a tool; the avatar here cannot call the app, so the app hears the
// user's words (spoken or typed) and decides: by rules for the phrasings people
// actually use ("what's in a banana?", "compare it with an apple", "walk me
// through the first one"), by its own model call only when the rules cannot
// tell, and never for a question about what is already on screen (the avatar
// answers those from its board).
import { matchRecipe, recipeKey, sameFood } from './advisor.ts';
import type { FoodAsk, Intent, RecipeIdea, View } from './types.ts';

export interface JudgeContext {
  /** The food on the card, if one is up. */
  card: string | null;
  /** The card's recipe ideas. */
  ideas: RecipeIdea[];
  /** Recipes opened this session. */
  kept: string[];
  /** Foods in the comparison table. */
  shelf: string[];
  /** The recipe open on the page, if any. */
  openRecipe: string | null;
  /** What the avatar said last: "walk me through it" means the recipe it just offered. */
  lastAvatarLine: string;
}

/**
 * The context for a judgement, from the session's view. The page builds it to
 * run the rules at once (most lines need no round trip); the server builds the
 * same one for the model.
 */
export function contextFor(view: View | null, openRecipe: string | null, lastAvatarLine: string): JudgeContext {
  return {
    card: view?.nutrition?.product_name ?? null,
    ideas: view?.nutrition?.recipes ?? [],
    kept: view?.shelf.recipes.map((r) => r.recipe_name) ?? [],
    shelf: view?.shelf.items.map((r) => r.product_name) ?? [],
    openRecipe: openRecipe || null,
    lastAvatarLine: (lastAvatarLine ?? '').slice(0, 500),
  };
}

const NONE: Intent = { kind: 'none' };

/** Lower case, no accents, plain apostrophes, no punctuation but decimal points. */
export const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9'. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const FILLER = /^(?:(?:yes|yeah|yep|yup|no|nope|nah|ok|okay|thanks|thank you|cool|great|nice|sure|hi|hello|hey|bye|goodbye|right|got it|sounds good|awesome|perfect|wow|oh|ah|um+|uh+|hmm+|mm+|alright|all right|please|go on|really|i see|lovely|good|there|everyone|again|so much|a lot|very much)\b ?)+$/;

/** Words that point at what is already on screen rather than naming a food. */
const POINTERS = /^(?:it|its|it's|that|this|them|these|those|they|both|either|one|that one|this one|the one|the same|the card|the food|the table|the other one|everything|all of them|all three|the two|the first one|the second one|the last one)$/;
/** A nutrient or a part of the card: "what about sodium?" is a question about the card, not a food. */
const CARD_WORDS = /^(?:the )?(?:sodium|salt|sugars?|protein|fats?|saturated fat|fib(?:er|re)|carbs?|carbohydrates|calories|cals|energy|score|health score|vitamins?|minerals?|potassium|iron|calcium|macros|nutrients|serving|serving size|portion|recipes?|ideas?|steps?|ingredients?|next step|summary|label|numbers|figures)$/;

const BACK = /^(?:ok(?:ay)? )?(?:go )?back(?: to (?:the )?(?:card|nutrition|food|numbers|label|table))?(?: please)?$|\b(?:go back|close (?:the |this )?recipe|back to the (?:card|nutrition|numbers|food)|show me the card again)\b/;
const SAMPLE = /\b(?:try|use|show me|load|open|read|do) (?:the|a|your) sample\b|^(?:the )?sample(?: please)?$/;

const RECIPE = /\b(?:(?:walk|talk|take) (?:me|us) through|how (?:do|would|can|should|could) (?:i|we|you) (?:make|cook|prepare|do)|how to (?:make|cook|prepare)|(?:show|open|give|tell|read) (?:me|us) (?:the )?(?:recipe|steps|instructions|method)(?: for| of)?|(?:what'?s |what is )?the recipe for|(?:the )?steps for|let'?s (?:make|cook)|i(?:'d| would)? (?:want|like|love) to (?:make|cook)|open (?:the |that |this )?recipe(?: for)?)\s*(.*)$/;

const ORDINAL = /^(?:the )?(first|second|third|last|1st|2nd|3rd)(?: one| recipe| idea| option| dish)?$/;
const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2 };

/** What comes between "which has more" and the foods: "protein", "for you", "to eat". */
const LEAD = /^(?:\s*(?:in|on|for you|to eat|for breakfast|for a snack|between|of the two|protein|sugar|fat|fib(?:er|re)|carbs?|sodium|salt|calories|nutrients|vitamins)\b)*\s*/;

const COMPARE: [RegExp, (m: RegExpMatchArray) => string[]][] = [
  [/\bcompare (?:it|that|this|them)\s+(?:with|to|against|and|vs)\s+(.+)$/, (m) => [m[1]]],
  [/\bhow (?:does|do) (?:it|that|this|they) compare (?:with|to|against) (.+)$/, (m) => [m[1]]],
  [/\bcompare (?:between )?(.+?)\s+(?:with|to|against|and|vs|versus)\s+(.+)$/, (m) => [m[1], m[2]]],
  [/^(?:what about |how about |and )?(.+?)\s+(?:vs|versus)\s+(.+)$/, (m) => [m[1], m[2]]],
  [/\b(?:which|what)(?: one)? (?:is|'s|has|have|gets) (?:the )?(?:\w+ )?(?:better|healthier|worse|more|less|fewer|lower|higher|best|healthiest)\b(.*?) or (.+)$/, (m) => [m[1].replace(LEAD, ''), m[2]]],
  [/\b(?:put|show|add|place|display|bring up) (?:me )?(.+?)\s+(?:next to|beside|alongside|with) (?:it|that|this|them|the \w+(?: \w+)?)$/, (m) => [m[1]]],
  [/\b(?:show|put up|put|display|add|bring up|pull up) (?:me )?(.+?)\s+(?:on (?:the )?(?:panel|screen|table) )?(?:too|as well|also)$/, (m) => [m[1]]],
  [/\bside by side with (.+)$/, (m) => [m[1]]],
];

const LOOKUP: RegExp[] = [
  /\bwhat(?:'s| is| are|s)(?: actually| really| exactly)? in (.+)$/,
  /\bhow many (?:calories|cals|carbs|grams of [a-z]+) (?:are |is )?(?:there )?in (.+)$/,
  /\bhow many (?:calories|cals|carbs) (?:does|do|has|have) (.+?)(?: have| got)?$/,
  /\bhow much (?:protein|sugar|fat|fib(?:er|re)|carbs?|sodium|salt|energy) (?:is |are )?(?:there )?in (.+)$/,
  /\bhow much (?:protein|sugar|fat|fib(?:er|re)|carbs?|sodium|salt|energy) (?:does|do) (.+?) (?:have|contain|got)$/,
  /\b(?:nutrition(?:al)?(?: facts| info(?:rmation)?| values?| label)?|macros|nutrients|calories) (?:for|of|on|in) (.+)$/,
  /\b(?:tell me about|look up|lookup|pull up|bring up|what about|how about|and what about|now do|do the same for|same for|let'?s (?:look at|try|check|do)|can you (?:check|look up|do)|show me) (.+)$/,
  /\bis (.+?) (?:healthy|good for you|bad for you|good|bad|fattening|nutritious|safe)\b/,
  /^(?:and |now |ok |okay |so )?(?:a|an) ([a-z][a-z ]{1,40})$/,
];

/** Something that points at the screen or the card: nothing for the app to put up. */
const ABOUT_SCREEN = /\b(?:it|its|it's|that|this|them|they|which one|which of|score|next step|steps?|ingredients?|the card|the table|recipes?|serving|protein|sugars?|fats?|fib(?:er|re)|carbs?|sodium|salt|calories|healthy|healthier)\b/;

const QUANTITY = /^((?:\d+(?:[.,]\d+)?|a|an|one|two|three|four|five|six|half(?: an?)?|a couple of|a few|a quarter of)\s*(?:g|grams?|kg|kilos?|oz|ounces?|lbs?|pounds?|ml|l|liters?|litres?|cups?|tbsp|tablespoons?|tsp|teaspoons?|slices?|pieces?|pots?|cans?|bowls?|handfuls?|servings?|scoops?|glass(?:es)?|bottles?|bars?|packs?|packets?|bags?|spoonfuls?|portions?))\b(?:\s+of)?\s+(.+)$/;
const COUNT = /^(\d+(?:[.,]\d+)?|two|three|four|five|six|seven|eight|nine|ten|a dozen|half(?: an?)?)\s+(.+)$/;
// Not "big": a Big Mac is not a large mac.
const SIZE = /^(?:(?:a|an|one)\s+)?(small|medium|large|extra large|jumbo)\s+(.+)$/;
const ARTICLE = /^(?:a|an|the|some|my|this|that|these|those|one|any)\s+/;
const DETERMINER = /^(?:the|some|my|this|that|these|those|any)\s+/;

/** The words that are not the food: courtesy, the screen, the verb's tail. */
function clean(target: string): string {
  return target
    .replace(/\b(?:on|to|in|into) (?:the )?(?:panel|screen|card|table|board)\b/g, ' ')
    .replace(/\b(?:please|for me|right now|now|today|again|too|as well|also|then|instead|exactly|actually)\b/g, ' ')
    .replace(/\b(?:have|has|contain|contains|got)$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A food as the user named it, with how much when they said; null for a pointer or a nutrient. */
export function parseFood(phrase: string): FoodAsk | null {
  let t = clean(norm(phrase)).replace(DETERMINER, '');
  if (!t || POINTERS.test(t) || CARD_WORDS.test(t)) return null;
  let quantity = '';
  const measured = QUANTITY.exec(t) ?? COUNT.exec(t) ?? SIZE.exec(t);
  if (measured) {
    quantity = measured[1].trim();
    t = measured[2].trim();
  }
  t = t.replace(ARTICLE, '').trim();
  if (!t || !/[a-z]/.test(t) || POINTERS.test(t) || CARD_WORDS.test(t) || t.split(' ').length > 8) return null;
  return { name: t.slice(0, 60), quantity };
}

/** Several foods in one breath, only where each starts like a food of its own ("a banana and an apple", not "rice and beans"). */
const splitLookup = (t: string) => t.split(/\s+(?:and|&|plus)\s+(?=(?:a|an|some|one|two|three|\d+)\b)/);
const splitList = (t: string) => t.split(/\s*(?:,|\band\b|&|\bor\b|\bvs\b|\bversus\b|\bwith\b|\bagainst\b)\s*/);

function foodsIn(parts: string[], split: (t: string) => string[]): FoodAsk[] {
  const foods: FoodAsk[] = [];
  for (const part of parts.flatMap((p) => split(clean(p)))) {
    const food = parseFood(part);
    if (food && !foods.some((f) => f.name === food.name)) foods.push(food);
  }
  return foods.slice(0, 3);
}

const titled = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Only the food already on the card, with no new quantity: a question about the card, which the avatar answers from its board. */
const onlyTheCard = (foods: FoodAsk[], ctx: JudgeContext) => Boolean(ctx.card) && foods.every((f) => !f.quantity && sameFood(f.name, ctx.card!));

/**
 * The recipe "it" means: the one open on screen, else the idea the avatar
 * mentioned last, else the card's first idea.
 */
function recipeInContext(ctx: JudgeContext): RecipeIdea | null {
  if (ctx.openRecipe) return { name: ctx.openRecipe, description: '' };
  // The idea mentioned last wins: "toast, or pancakes. Want me to walk you through it?" means the pancakes.
  const line = ` ${norm(ctx.lastAvatarLine)} `;
  const words = (name: string) => norm(name).split(' ').filter((w) => w.length >= 4);
  // A word every idea shares ("banana" on a banana card) says nothing about which one.
  const shared = (w: string) => ctx.ideas.length > 1 && ctx.ideas.every((idea) => words(idea.name).includes(w));
  let best: { idea: RecipeIdea; at: number } | null = null;
  for (const idea of ctx.ideas) {
    let at = line.lastIndexOf(` ${norm(idea.name)}`);
    for (const w of words(idea.name)) if (!shared(w)) at = Math.max(at, line.lastIndexOf(` ${w}`));
    if (at >= 0 && (!best || at > best.at)) best = { idea, at };
  }
  return best?.idea ?? ctx.ideas[0] ?? null;
}

/** The recipe intent for a target the user named (or pointed at), or none when it is the one already open. */
function recipeFor(target: string, ctx: JudgeContext): Intent | null {
  const t = clean(target)
    .replace(/^(?:the )?(?:full )?(?:recipe|steps|instructions|method)(?: for| of)?\b/, '')
    .replace(/\b(?:step by step|for it|with it|recipe|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let chosen: RecipeIdea | null = null;
  const ordinal = ORDINAL.exec(t);
  if (ordinal) {
    const index = ordinal[1] === 'last' ? ctx.ideas.length - 1 : ORDINALS[ordinal[1]];
    chosen = ctx.ideas[index] ?? null;
    if (!chosen) return NONE;
  } else if (!t || POINTERS.test(t)) {
    chosen = recipeInContext(ctx);
    if (!chosen) return NONE;
  } else if (/^(?:it|that|this|them)\b/.test(t)) {
    return null; // "how do I make it healthier?": not a recipe name
  } else {
    const bare = t.replace(ARTICLE, '');
    const name = matchRecipe(bare, [...ctx.ideas.map((i) => i.name), ...ctx.kept]) ?? titled(bare);
    chosen = { name, description: ctx.ideas.find((i) => i.name === name)?.description ?? '' };
  }
  // Already open: the avatar has its steps in the board and walks through them; reopening would only repeat it.
  if (ctx.openRecipe && recipeKey(chosen.name) === recipeKey(ctx.openRecipe)) return NONE;
  return { kind: 'recipe', name: chosen.name, description: chosen.description };
}

/**
 * The intent the rules can name, NONE when they can tell it is nothing for the
 * app, or null when only a model can tell.
 */
export function ruleIntent(text: string, ctx: JudgeContext): Intent | null {
  const t = norm(text);
  if (!t || FILLER.test(t)) return NONE;
  if (ctx.openRecipe && BACK.test(t)) return { kind: 'back' };
  if (SAMPLE.test(t)) return { kind: 'sample' };

  const recipe = RECIPE.exec(t);
  if (recipe) return recipeFor(recipe[1] ?? '', ctx);

  for (const [pattern, parts] of COMPARE) {
    const m = t.match(pattern);
    if (!m) continue;
    const foods = foodsIn(parts(m), splitList);
    return foods.length ? { kind: 'compare', foods } : NONE;
  }

  for (const pattern of LOOKUP) {
    const m = t.match(pattern);
    if (!m) continue;
    const target = clean(m[1]);
    if (ORDINAL.test(target)) return null; // "what about the second one?": a food or a recipe; the model reads it in context
    const foods = foodsIn([target], splitLookup);
    return foods.length && !onlyTheCard(foods, ctx) ? { kind: 'lookup', foods } : NONE;
  }

  if (ABOUT_SCREEN.test(t)) return NONE;
  return null;
}

/** Without a model: a typed line that is only a food's name ("greek yogurt") is a lookup. */
export function bareFood(text: string): Intent | null {
  const t = norm(text);
  if (!t || FILLER.test(t) || t.split(' ').length > 4) return null;
  if (/^(?:what|how|why|who|where|when|which|is|are|can|could|do|does|should|would|will|tell|give|show|i|you|my|thanks|let)\b/.test(t)) return null;
  const food = parseFood(t);
  return food ? { kind: 'lookup', foods: [food] } : null;
}

// -- the model, for what the rules cannot tell ---------------------------------

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['lookup', 'compare', 'recipe', 'back', 'none'] },
    foods: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The food as the user named it.' },
          quantity: { type: 'string', description: 'How much, only if they said ("200 g", "two", "a large"); otherwise empty.' },
        },
        required: ['name', 'quantity'],
      },
    },
    recipe: { type: 'string', description: 'For a recipe: its name.' },
  },
  required: ['kind', 'foods', 'recipe'],
};

export const JUDGE_SYSTEM = 'You route one utterance in a nutrition app. You never answer the user; you only say what the app should do.';

const listed = (items: string[]) => (items.length ? items.map((i) => `"${i}"`).join(', ') : 'none');

export function judgePrompt(text: string, ctx: JudgeContext): string {
  return `The user said: "${text}"
On their screen: ${ctx.card ? `the nutrition card for "${ctx.card}"` : 'no card yet'}${ctx.openRecipe ? `, covered by the open recipe "${ctx.openRecipe}"` : ''}.
Recipe ideas on the card, in order: ${listed(ctx.ideas.map((i) => i.name))}. Recipes opened before: ${listed(ctx.kept)}. Foods in the comparison table: ${listed(ctx.shelf)}.
The avatar last said: "${ctx.lastAvatarLine.slice(0, 300)}"
Speech recognition may have misheard food names; use the most likely food.
What should the app do?
- lookup: they name one or more foods, drinks or products and want what is in them, including a question about a food that is not on screen (even with a health question attached). foods: each food, with quantity only if they said how much.
- compare: they want foods side by side, or ask which of them is better on something. foods: the foods they named; "it" or "that" means the card, which is already in the table, so leave it out.
- recipe: they want to make a dish or hear a recipe's steps. recipe: the name exactly as listed when they mean a listed one ("the first one" is the first idea; "it" is the one the avatar just offered), else the dish they named.
- back: they want to leave the recipe and see the card again.
- none: anything else: a question about what is already on screen, small talk, thanks, a question about their own health or diet, or anything you are unsure of.`;
}

/** The model's answer, checked: nothing it says can name a food that is not there or reopen what is open. */
export function intentFrom(raw: unknown, ctx: JudgeContext): Intent {
  if (!raw || typeof raw !== 'object') return NONE;
  const r = raw as { kind?: unknown; foods?: unknown; recipe?: unknown };
  const kind = String(r.kind ?? '');
  if (kind === 'back') return ctx.openRecipe ? { kind: 'back' } : NONE;
  if (kind === 'recipe') return recipeFor(typeof r.recipe === 'string' ? r.recipe : '', ctx) ?? NONE;
  if (kind === 'lookup' || kind === 'compare') {
    const foods: FoodAsk[] = [];
    for (const item of Array.isArray(r.foods) ? r.foods : []) {
      const name = typeof item?.name === 'string' ? item.name : '';
      const food = parseFood(name);
      if (!food) continue;
      const stated = typeof item?.quantity === 'string' ? clean(norm(item.quantity)) : '';
      foods.push({ name: food.name, quantity: food.quantity || stated });
    }
    if (!foods.length || (kind === 'lookup' && onlyTheCard(foods, ctx))) return NONE;
    return { kind, foods: foods.slice(0, 3) };
  }
  return NONE;
}
