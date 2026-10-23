// Reading what people say about food. Three jobs, none of them deciding what
// the host does (the host calls the tools):
//
// * the tools' arguments, checked: a food as the host heard it ("200 g of
//   chicken breast"), split into what and how much; a recipe as the host named
//   it ("the first one"), matched to the card's ideas;
// * the safety net (`mustDo`): what the user's words clearly ask for among the
//   actions that are safe to do twice, for when the host narrates instead of
//   calling the tool;
// * the safety line (`concernIn`): a possible emergency, or a question about
//   the user's own health, which the page shows at once whatever the host says.
import { matchRecipe, sameFood } from './advisor.ts';
import type { FoodAsk, RecipeIdea } from './types.ts';

/** Lower case, no accents, plain apostrophes, no punctuation but decimal points. */
export const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9'. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words that point at what is already on screen rather than naming a food. */
const POINTERS = /^(?:it|its|it's|that|this|them|these|those|they|both|either|one|that one|this one|the one|the same|the card|the food|the table|the other one|everything|all of them|all three|the two|the first one|the second one|the last one)$/;
/** A nutrient or a part of the card: "what about sodium?" is a question about the card, not a food. */
const CARD_WORDS = /^(?:the )?(?:sodium|salt|sugars?|protein|fats?|saturated fat|fib(?:er|re)|carbs?|carbohydrates|calories|cals|energy|score|health score|vitamins?|minerals?|potassium|iron|calcium|macros|nutrients|serving|serving size|portion|recipes?|ideas?|steps?|ingredients?|next step|summary|label|numbers|figures)$/;

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
const splitFoods = (t: string) => t.split(/\s+(?:and|&|plus)\s+(?=(?:a|an|some|one|two|three|\d+)\b)/);

/**
 * The foods a tool call names, checked: at most three, no pointers ("it" is
 * the card, already on screen), no repeats. Accepts what the host sends, an
 * array of strings or one string.
 */
export function foodsFrom(value: unknown): FoodAsk[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const foods: FoodAsk[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    for (const part of splitFoods(clean(norm(item.slice(0, 120))))) {
      const food = parseFood(part);
      if (food && !foods.some((f) => f.name === food.name && f.quantity === food.quantity)) foods.push(food);
    }
  }
  return foods.slice(0, 3);
}

/** A food as the tools say it back: "200 g chicken breast". */
export const asked = (food: FoodAsk) => [food.quantity, food.name].filter(Boolean).join(' ');

// -- recipes ------------------------------------------------------------------------

const ORDINAL = /^(?:the )?(first|second|third|last|1st|2nd|3rd)(?: one| recipe| idea| option| dish)?$/;
const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2 };
const titled = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export interface RecipeContext {
  /** The card's recipe ideas, in order. */
  ideas: RecipeIdea[];
  /** Recipes opened before. */
  kept: string[];
  /** The recipe open on the page, if any. */
  openRecipe: string | null;
}

/**
 * The recipe a tool call names: "the first one" is the card's first idea, "it"
 * the recipe that is open (else the first idea), a listed name or a paraphrase
 * of one is that idea under its listed name, and anything else is a dish of
 * the user's own, titled as they said it. Null when nothing fits.
 */
export function resolveRecipe(spoken: string, ctx: RecipeContext): RecipeIdea | null {
  const t = clean(norm(spoken))
    .replace(/^(?:the )?(?:full )?(?:recipe|steps|instructions|method)(?: for| of)?\b/, '')
    .replace(/\b(?:step by step|for it|with it|recipe|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const idea = (name: string) => ({ name, description: ctx.ideas.find((i) => i.name === name)?.description ?? '' });
  const ordinal = ORDINAL.exec(t);
  if (ordinal) {
    const index = ordinal[1] === 'last' ? ctx.ideas.length - 1 : ORDINALS[ordinal[1]];
    return ctx.ideas[index] ?? null;
  }
  if (!t || POINTERS.test(t)) {
    if (ctx.openRecipe) return idea(ctx.openRecipe);
    return ctx.ideas[0] ?? null;
  }
  const bare = t.replace(ARTICLE, '');
  if (!bare) return null;
  return idea(matchRecipe(bare, [...ctx.ideas.map((i) => i.name), ...ctx.kept]) ?? titled(bare).slice(0, 60));
}

// -- the safety net -------------------------------------------------------------------

/** What is on screen, for the net: it never acts on what the host can answer from the board. */
export interface NetContext {
  /** The food on the card, if one is up. */
  card: string | null;
  /** Foods in the comparison table. */
  shelf: string[];
  /** The recipe open on the page, if any. */
  openRecipe: string | null;
}

/** The phrasings that clearly ask for a food's facts. */
const LOOKUP: RegExp[] = [
  /\bwhat(?:'s| is| are|s)(?: actually| really| exactly)? in (.+)$/,
  /\bhow many (?:calories|cals|carbs|grams of [a-z]+) (?:are |is )?(?:there )?in (.+)$/,
  /\bhow many (?:calories|cals|carbs) (?:does|do|has|have) (.+?)(?: have| got)?$/,
  /\bhow much (?:protein|sugar|fat|fib(?:er|re)|carbs?|sodium|salt|energy) (?:is |are )?(?:there )?in (.+)$/,
  /\bhow much (?:protein|sugar|fat|fib(?:er|re)|carbs?|sodium|salt|energy) (?:does|do) (.+?) (?:have|contain|got)$/,
  /\b(?:nutrition(?:al)?(?: facts| info(?:rmation)?| values?| label)?|macros|nutrients|calories) (?:for|of|on|in) (.+)$/,
  /\b(?:tell me about|look up|lookup|pull up|bring up|what about|how about|and what about|now do|do the same for|same for|let'?s (?:look at|try|check|do)|can you (?:check|look up|do)|show me) (.+)$/,
];

const BACK = /^(?:ok(?:ay)? )?(?:go )?back(?: to (?:the )?(?:card|nutrition|food|numbers|label|table))?(?: please)?$|\b(?:go back|close (?:the |this )?recipe|back to the (?:card|nutrition|numbers|food)|show me the card again)\b/;
const START_OVER = /\b(?:start (?:over|again|fresh|from scratch)|clear (?:the |my |this )?(?:table|screen|board|everything|it all|all)|wipe (?:it|the table|everything)|reset (?:the |my )?(?:table|screen|board|everything))\b/;

export type NetCall = { name: 'look_up_food'; arguments: { foods: string[] } } | { name: 'close_recipe' | 'start_over'; arguments: Record<string, never> };

/**
 * The tool the user's words clearly ask for, among those safe to do twice: a
 * food already looked at comes back as it was (same figures, same row, no
 * second model call), closing a closed recipe and clearing a clear table do
 * nothing. Never for a recipe step (a second "next" would skip two steps),
 * never for a line that touches the user's health (the host decides those),
 * and never for a food already on screen (the host answers from the board).
 */
export function mustDo(text: string, ctx: NetContext): NetCall | null {
  if (concernIn(text)) return null;
  const t = norm(text);
  if (!t) return null;
  if (ctx.openRecipe && BACK.test(t)) return { name: 'close_recipe', arguments: {} };
  if (START_OVER.test(t)) return { name: 'start_over', arguments: {} };
  for (const pattern of LOOKUP) {
    const m = t.match(pattern);
    if (!m) continue;
    const foods = foodsFrom(m[1]).filter((f) => f.quantity || ![ctx.card ?? '', ...ctx.shelf].some((name) => name && sameFood(f.name, name)));
    return foods.length ? { name: 'look_up_food', arguments: { foods: foods.map(asked) } } : null;
  }
  return null;
}

// -- the safety line --------------------------------------------------------------------

const EMERGENCY: RegExp[] = [
  /\b(?:can'?t|cannot|can not|could not|couldn'?t) (?:breathe|breath)\b/,
  /\b(?:trouble|difficulty|struggling|hard) (?:to )?(?:breathe|breathing|breath)\b/,
  /\b(?:throat|tongue|lips?|mouth|face)(?: is| are|'s)? (?:swelling|swollen|closing(?: up)?|tight(?:ening)?)\b/,
  /\b(?:having|going into|in) (?:an? )?(?:allergic reaction|anaphyla\w*(?: shock)?)\b/,
  /\b(?:need|get|where'?s|use) (?:my |an |the |his |her |their )?(?:epi ?pen|adrenaline|epinephrine)\b/,
  /\b(?:i'?m|i am|he'?s|she'?s|they'?re|is|are) choking\b/,
  /\b(?:call|calling|need) (?:an? )?(?:ambulance|911|999|112)\b/,
];

const CONDITIONS = "(?:diabet\\w*|prediabet\\w*|pregnan\\w*|breastfeeding|celiac|coeliac|(?:kidney|liver) (?:disease|stones?|problems?|condition|failure)|renal|heart (?:disease|condition|failure|problems?)|blood pressure|hypertension|cholesterol|gout|ibs|crohn'?s|colitis|cancer|chemo\\w*|eating disorder|anorexi\\w*|bulimi\\w*|allerg\\w*|(?:lactose |gluten )?intoleran\\w*|pcos|thyroid|medication|meds|insulin|metformin|statins?|warfarin|blood sugar|a1c)";
/** A condition, a medicine or a pregnancy, said as the user's own: "I have diabetes", "my son is allergic to nuts", "I'm on statins". */
const MY_CONDITION = new RegExp(`\\b(?:i have|i've got|ive got|i got|i'm|i am|im|i take|i'm on|i am on|diagnosed with|i suffer from|i live with|i've been|we have|my|our)\\s+(?:[a-z']+\\s+){0,3}?${CONDITIONS}`);
const ADVICE: RegExp[] = [
  /\b(?:safe|okay|ok|alright|allowed) for (?:me|my|someone like me|us)\b/,
  /\bshould (?:i|we) (?:eat|have|drink|avoid|cut|stop|start|be eating)\b/,
  /\bhow (?:much|many) [a-z ]{0,30}should (?:i|we) (?:eat|have|drink)\b/,
  /\b(?:meal plan|diet plan|lose weight|losing weight|gain weight|my (?:daily )?(?:target|limit|intake|goal))\b/,
  /\bmy doctor\b|\bmy dietitian\b/,
];

/**
 * What the page must show at once, whatever the host says: a possible
 * emergency (an allergic reaction, choking: call for help now) or a question
 * about the user's own health (Rachel says what is in a food, never what is
 * right for them). Null for everything else, including general questions
 * ("is a banana healthy?").
 */
export function concernIn(text: string): 'emergency' | 'medical' | null {
  const t = norm(text);
  if (!t) return null;
  if (EMERGENCY.some((p) => p.test(t))) return 'emergency';
  if (MY_CONDITION.test(t)) return 'medical';
  if (ADVICE.some((p) => p.test(t))) return 'medical';
  return null;
}
