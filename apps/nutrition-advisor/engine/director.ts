// What the host is told, and how it acts. The app decides what goes on screen
// and every figure on it; the host advises. It acts only through the app's
// tools, and each tool's result carries the real outcome (the card's figures,
// the side-by-side rows, the recipe's steps), so its first reply is grounded.
//
// * INSTRUCTIONS: the host's role and rules (the session's tool instructions).
// * NOTES: the advice line in full, sent once (too long for the instructions,
//   and the rule that matters most).
// * TOOLS: what the host can do.
// * the board (`boardState`): what is on the user's screen, every figure the
//   host may quote, re-sent whenever the screen changes.
// * `said`: what each action did, in words the host speaks from.
import type { AppTool } from '../../../server/app-server.ts';
import { stepsLabel, type Cook } from './cook.ts';
import { DAILY_VALUES, dailyValue } from './nutrition.ts';
import type { Nutrients, NutritionData, RecipeDetails, ShelfRow, View } from './types.ts';

/** The board's limit (the API's `state`). */
export const MAX_STATE = 3858;
/** Each note's limit. */
export const MAX_NOTE = 2000;
/** The instructions' limit. */
export const MAX_INSTRUCTIONS = 4000;

export const INSTRUCTIONS = `You are the nutritionist in Morsel, a food app, talking with one person. Their screen shows what the app puts there: a nutrition card for one food (serving, calories, macros with % daily value, a 1-10 score, a summary, three recipe ideas), a comparison table of every food looked at, and recipe cards. You cannot see it. The screen changes only when you call a tool, and every figure comes from a tool's result or the live board in your context.
- When they name a food, drink or product they want to know about ("what's in a banana?", "protein in 200 g of chicken"), call look_up_food before saying anything about it, and answer from its result. Never give a figure of your own, even when you think you know it.
- "Compare it with an apple", "which has more sugar, a banana or an apple?": call compare_foods, then give a one-line verdict from its figures.
- "How do I make the smoothie?", "walk me through the first one": call open_recipe with the name as the card lists it. Talk a recipe through one or two steps at a time; when they are ready for more ("done", "what's next?"), call next_steps. "Back to the card": call close_recipe. "Start over", "clear everything": call start_over, and only then.
- Questions about what is already on screen (a figure on the card, the score, which food in the table has more fiber, the step they are on): answer from the live board, no tool needed.
- Every request that changes the screen is a tool call, even a one-word answer to your own question ("yes", "the second one", a food's name). Saying "let me pull that up" or "here it is" without the call changes nothing and misleads them. Never say an action happened, or that something is on screen, unless a tool's result or the board says so.
- Speak only of what is on the card: its figures (calories, protein, carbs, fat, fiber, sugar, sodium), its score and its summary. Never add a nutrient, vitamin, mineral or claim from memory (no potassium, vitamins or glycemic index); asked about one, say that isn't on this card.
- Photos: they add a photo of a food or its label with the photo button; the app reads it and tells you what it found. Naming a food is enough: never ask them to hold anything up to a camera, and never say you cannot look at photos.
- If they press a button, the app tells you what happened; carry on from that.
Voice: one or two short spoken sentences, friendly and never preachy ("high in sugar for a snack", never "you shouldn't eat this"). Give the takeaway, not the figures read back; say a number when they ask for it. No markdown, lists, asterisks or headings: everything is read aloud, and steps are said as sentences. A walkthrough they asked for may take the words it needs, never all at once. At most one question per turn; ask about quantity only when it would change the numbers a lot. "Label" figures were read from a nutrition label in their photo; everything else is an estimate, and an assumed portion is an assumption: say so when it matters.
The advice line, in your standing note: you say what is in a food and what a nutrient does in general, never what this person should eat for their health. If they mention a condition, a medicine, a pregnancy or an allergy of their own, or ask whether a food is safe or right for them, decline kindly, say you are not their doctor or dietitian, and offer to read the numbers instead. If they describe an emergency (trouble breathing, a swelling throat or tongue, a severe allergic reaction, choking), tell them to call their local emergency number right now, and nothing else.`;

export const NOTES = [
  `Where you stop: read this twice. You say what is IN a food, and what a nutrient does in general. You do not tell THIS person what THEY should eat: no daily targets for them, no meal plans, no "if I were you", no yes or no on whether a food is safe for their condition, no verdict on a food because of a diagnosis they told you. Not even when they insist, plead, ask for one word, or say they will do exactly what you say. You would not advise on their medication; food is the same line. Someone newly diagnosed will change what they eat tonight on your word, and you do not know their bloodwork, their dose or their doctor's plan. The score ranks a food's general nutrition; it is NOT a judgement about anyone's medical condition. Asked whether a 9 out of 10 means a food is good for their diabetes, or any condition, say no and explain what the score ranks. When you decline, name the door in the same breath: you can read them the numbers for any food and explain what a nutrient does; offer that, then do it if they want it. Never leave a worried person with only a refusal. Say plainly, the first time this comes up, that you are not their doctor or a dietitian and that a plan for them has to come from one. Allergies: you can read an ingredient list they show you, but never promise a food is free of anything.`,
];

// -- the tools ------------------------------------------------------------------

// Lenient on purpose: the platform checks a call against its schema before the
// page sees it, and answers a call that does not fit "invalid arguments" to the
// host, who then often says the action happened. So no enums, no tight lengths,
// nothing required, extra fields allowed: the app reads what it can (a string
// or a list, "food" or "foods", any case) and asks the host to ask when it
// cannot.
const foodList = {
  anyOf: [{ type: 'array', items: { type: 'string', maxLength: 500 } }, { type: 'string', maxLength: 500 }],
  description: 'Each food as the user said it, one per item, with the amount if they gave one ("200 g chicken breast", "a large banana"). Up to three.',
};
const noArgs = { type: 'object', properties: {} };
const awaits = (timeoutSeconds: number) => ({ mode: 'await' as const, timeoutSeconds });

export const TOOLS: AppTool[] = [
  { type: 'function', name: 'look_up_food', description: "Puts a food's nutrition card on the user's screen and returns its real figures. Call it whenever the user names a food, drink or product they want to know about, before saying anything about it, even if you think you know the numbers.",
    parameters: { type: 'object', properties: { foods: foodList } },
    'x-atmee': awaits(20) },
  { type: 'function', name: 'compare_foods', description: "Puts foods side by side in the comparison table, looking up any that are not on screen yet, and returns their figures. Call it when the user asks to compare foods, or which of two is better, higher or lower in something. 'It' or 'that' means the food on the card: leave it out.",
    parameters: { type: 'object', properties: { foods: foodList } },
    'x-atmee': awaits(20) },
  { type: 'function', name: 'open_recipe', description: "Opens a recipe's ingredients and steps on the user's screen and returns them, with the first two steps lit up. Call it when the user wants to make a dish or hear a recipe. Use the name exactly as the card lists it when they mean one of its ideas.",
    parameters: { type: 'object', properties: { recipe: { type: 'string', maxLength: 500, description: 'The recipe: its name as listed on the card ("Banana oat smoothie"), "the first one", or the dish the user named.' } } },
    'x-atmee': awaits(20) },
  { type: 'function', name: 'next_steps', description: 'Lights up the next one or two steps of the open recipe and returns them. Call it when the user is ready for more of the recipe.', parameters: noArgs, 'x-atmee': awaits(8) },
  { type: 'function', name: 'close_recipe', description: 'Closes the open recipe and shows the nutrition card again. Call it when the user asks to go back to the card.', parameters: noArgs, 'x-atmee': awaits(8) },
  { type: 'function', name: 'start_over', description: 'Clears the card, the comparison table and the opened recipes. Only when the user asks to start over or clear everything; never on your own.', parameters: noArgs, 'x-atmee': awaits(8) },
];

/** The tools the server answers; the page answers the rest itself. */
export const SERVER_TOOLS = new Set(['look_up_food', 'compare_foods', 'open_recipe', 'start_over']);

// -- the board ------------------------------------------------------------------

/** What only the page knows about its screen. */
export interface Screen {
  /** The recipe open on the page, with its ingredients and steps. */
  recipe: RecipeDetails | null;
  /** Which of its steps are lit up. */
  cook: Cook | null;
  /** A recipe the page is opening and waiting for. */
  loadingRecipe: string | null;
  /** What the app is doing right now ("looking up apple"), if anything. */
  working: string | null;
  /** A notice the page put up on its own: an emergency, or a question about the user's health. */
  concern: 'emergency' | 'medical' | null;
}

export const NO_SCREEN: Screen = { recipe: null, cook: null, loadingRecipe: null, working: null, concern: null };

const NUTRIENTS: [keyof Nutrients, string, string][] = [
  ['protein_g', 'protein', 'g'],
  ['carbs_g', 'carbs', 'g'],
  ['fat_g', 'fat', 'g'],
  ['fiber_g', 'fiber', 'g'],
  ['sugar_g', 'sugar', 'g'],
  ['sodium_mg', 'sodium', 'mg'],
];

/** A figure as the card prints it: whole numbers plain, otherwise one decimal. */
export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const q = (text: string) => `"${text}"`;
const list = (names: string[]) =>
  names.length <= 1 ? names.map(q).join('') : `${names.slice(0, -1).map(q).join(', ')} and ${q(names[names.length - 1])}`;
const trimEnd = (text: string) => text.replace(/[.!\s]+$/, '');

/** Every figure on the card, with the %DV the bars draw. */
function figures(card: NutritionData): string {
  const parts = NUTRIENTS.map(([key, label, unit]) => {
    const value = card.nutrients[key] ?? 0;
    const { pct } = dailyValue(value, DAILY_VALUES[key]);
    const share = pct === null ? (key === 'sugar_g' ? ' (total sugar; no daily value)' : '') : ` (${pct}% DV)`;
    return `${label} ${fmt(value)} ${unit}${share}`;
  });
  return `${card.calories} calories; ${parts.join('; ')}`;
}

function cardText(card: NutritionData, ideas: 'full' | 'names' | 'none'): string {
  const portion = card.serving_size
    ? `${card.serving_size}${card.portion_assumed ? ', an assumed portion (they did not say how much)' : ''}`
    : card.portion_assumed ? 'an assumed portion' : 'not given';
  const source = card.source === 'label' ? ' Figures read from the nutrition label in their photo.' : card.source === 'estimate' ? ' Figures estimated, not read from a label.' : '';
  let text = `the nutrition card for ${q(card.product_name)}. Serving: ${portion}.${source} Per serving: ${figures(card)}. Health score ${card.health_score} of 10 (it ranks the food's general nutrition, not anyone's health). Summary on the card: ${q(trimEnd(card.health_summary))}.`;
  if (card.recipes.length && ideas !== 'none') {
    const ideasText = card.recipes.map((r) => (ideas === 'full' && r.description ? `${r.name} (${trimEnd(r.description)})` : r.name));
    text += ` Recipe ideas on the card, which the user can tap: ${ideasText.join('; ')}.`;
  }
  return text;
}

function rowText(row: ShelfRow): string {
  const sodium = row.sodium_mg === null ? 'sodium not recorded' : `sodium ${fmt(row.sodium_mg)} mg`;
  return `${row.product_name}${row.serving_size ? `, ${row.serving_size}` : ''}: ${fmt(row.calories)} cal, protein ${fmt(row.protein_g)} g, carbs ${fmt(row.carbs_g)} g, fat ${fmt(row.fat_g)} g, fiber ${fmt(row.fiber_g)} g, sugar ${fmt(row.sugar_g)} g, ${sodium}, score ${fmt(row.health_score)}/10.`;
}

const stepList = (steps: string[], from = 0) => steps.map((s, i) => `(${from + i + 1}) ${trimEnd(s)}.`).join(' ');

function recipeText(recipe: RecipeDetails, steps = recipe.preparation_steps.length): string {
  const more = steps < recipe.preparation_steps.length ? ` (${recipe.preparation_steps.length - steps} more steps are on the card)` : '';
  return `${q(recipe.recipe_name)}${recipe.description ? ` (${trimEnd(recipe.description)})` : ''}. Ingredients: ${recipe.ingredients.join('; ') || 'none listed'}. Steps: ${stepList(recipe.preparation_steps.slice(0, steps))}${more}`;
}

interface Budget { rows: number; ideas: 'full' | 'names'; kept: boolean; steps: number }

function compose(view: View, screen: Screen, b: Budget): string {
  const card = view.nutrition;
  const parts = ['Morsel, live board: what is on the user\'s screen right now, the only truth about it.'];

  if (screen.concern === 'emergency') parts.push('At the top of their screen: an emergency notice telling them to call their local emergency number now.');
  if (screen.concern === 'medical') parts.push('On their screen: a note that questions about their own health belong with their doctor or a registered dietitian.');

  if (screen.recipe) {
    const lit = screen.cook?.shown;
    parts.push(`On screen: the recipe card ${recipeText(screen.recipe, b.steps)}.`);
    parts.push(lit ? `${stepsLabel(lit)} ${lit[0] === lit[1] ? 'is' : 'are'} lit up: where they are in the walkthrough.` : 'No step is lit up yet: the walkthrough has not started.');
    if (card) parts.push(`It covers the nutrition card, which they can go back to: ${cardText(card, 'names')}`);
  } else if (screen.loadingRecipe) {
    parts.push(`On screen: the recipe ${q(screen.loadingRecipe)} is opening; its steps are not on screen yet.`);
    if (card) parts.push(`Behind it, ${cardText(card, 'names')}`);
  } else if (card) {
    parts.push(`On screen: ${cardText(card, b.ideas)}`);
  } else {
    parts.push('Nothing is on the user\'s screen yet: no card, no comparison table, no recipe. If they name a food, call look_up_food; until a result or this board lists it, you have no figures for it.');
  }

  if (screen.working) parts.push(`The app is working on this right now: ${screen.working}. It is not on screen yet.`);

  const rows = view.shelf.items;
  if (rows.length >= 2) {
    // The oldest go first when the board is full; the food on the card never does.
    const current = rows.findIndex((r) => r.product_name === view.shelf.current);
    const keep = new Set<number>();
    if (current >= 0) keep.add(current);
    for (let i = rows.length - 1; i >= 0 && keep.size < b.rows; i--) keep.add(i);
    const shown = rows.filter((_, i) => keep.has(i));
    const left = rows.length - shown.length;
    parts.push(`Comparison table under the card, ${rows.length} foods side by side${left ? ` (${left} older ones not listed here)` : ''}: ${shown.map(rowText).join(' ')}`);
  } else if (card) {
    parts.push('No comparison table yet: it appears under the card once two foods have been looked at.');
  }

  // The chips render under the card only, so they do not exist before a card is up.
  if (card && b.kept && view.shelf.recipes.length) {
    parts.push(`Recipes the user opened before (chips under the table; tapping one reopens it): ${view.shelf.recipes.map((r) => r.recipe_name).join('; ')}.`);
  }

  parts.push('Quote figures only from this board or a tool result, as listed; never make one up.');
  return parts.join(' ');
}

/**
 * The board, as the host's state: everything on the user's screen and every
 * figure the host may quote. Never over the limit: when it would be, the
 * oldest table rows go first, then the ideas' blurbs and the kept chips, then
 * the tail of an open recipe's steps.
 */
export function boardState(view: View, screen: Screen = NO_SCREEN): string {
  const b: Budget = { rows: view.shelf.items.length, ideas: 'full', kept: true, steps: screen.recipe?.preparation_steps.length ?? 0 };
  let text = compose(view, screen, b);
  while (text.length > MAX_STATE) {
    if (b.rows > 2) b.rows -= 1;
    else if (b.ideas === 'full') b.ideas = 'names';
    else if (b.kept) b.kept = false;
    else if (b.rows > 1) b.rows -= 1;
    else if (b.steps > 1) b.steps -= 1;
    else return text.slice(0, MAX_STATE - 1) + '…';
    text = compose(view, screen, b);
  }
  return text;
}

// -- what an action did ------------------------------------------------------------

/**
 * Why the sample photo did not load, as the board prints it after "The sample
 * did not load: ". A fragment, not a sentence: as a sentence of its own it
 * composed into the same news twice, with two full stops.
 */
export const SAMPLE_FAILED = 'name any food out loud and its card comes up instead';

/** For a photo the app could not read: something is said, never silence. */
export const PHOTO_FAILED = 'The app could not make out that photo, and nothing new is on screen. Say so warmly in ONE short line and ask them to add another or just name the food; do not mention an error, a system, or anything the user cannot see.';

const TAKEAWAY = "Answer what they asked from these figures in one or two short sentences; if they only named the food, give the takeaway: what stands out and what it means. Do not read the figures back. Speak only of what this card shows; for anything else (a vitamin, a mineral such as potassium) say that isn't on this card.";

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const said = {
  start: () => `You have just greeted them; do not greet or introduce yourself again. Morsel's table on their screen is empty: no food yet. In one sentence, invite them to name any food, or to add a photo of one or of its label with the photo button. Never ask them to hold anything up to a camera.`,

  /**
   * Cards that went up: `put` (the last is on the card), `others` already in
   * the table, `again` when every one was looked at before and came back as
   * it was. `missing`: foods that could not be found.
   */
  cards: (put: NutritionData[], others: string[], again: boolean, missing: string[] = []) => {
    const names = put.map((c) => c.product_name);
    let text: string;
    if (put.length === 1) {
      const table = !others.length ? '' : again
        ? ` It was already in the comparison table, with ${list(others)}.`
        : ` It joined the comparison table under the card, alongside ${list(others)}.`;
      text = `Done: ${again ? 'back on screen' : 'on screen now'}, ${cardText(put[0], 'full')}${table}`;
    } else {
      text = `Done: on screen now, cards for ${list(names)}; ${q(names[names.length - 1])} is on the card and all of them are in the comparison table${others.length ? ` with ${list(others)}` : ''}. ${put.map((c) => capital(cardText(c, 'names'))).join(' ')}`;
    }
    const compare = put.length > 1 || others.length ? ' If they asked to compare, give a one-line verdict from the figures.' : '';
    const lost = missing.length ? ` The app could not find ${list(missing)} just now; say so in a few words.` : '';
    return `${text} ${TAKEAWAY}${compare}${lost}`;
  },

  lookupFailed: (missing: string[]) =>
    `Not found: the app could not pull up ${list(missing)} just now, and nothing about it is on the user's screen. Say so in one short line, without mentioning an error or a system, and ask whether they would like you to try again; do it only if they say so. If they want a rough idea meanwhile, you may give typical figures from general knowledge, saying clearly that they are rough.`,

  /** Cards from work overtaken by newer work: in the table, behind the card asked for after them. */
  filed: (put: NutritionData[], front: string) =>
    `Done: ${list(put.map((c) => c.product_name))} joined the comparison table; the card on screen stays ${q(front)}, which was asked for after it. ${put.map((c) => capital(cardText(c, 'names'))).join(' ')} Answer what they asked from these figures in one or two short sentences; do not read the figures back.`,

  /** Work that finished after the user cleared the table: it wrote nothing. */
  clearedMeanwhile: (what: string) =>
    `Not done: the table was cleared while ${what} was being prepared, so nothing about it is on screen. Ask whether they still want it; do it only if they say so.`,

  recipeOvertaken: (name: string, front: string) =>
    `Not done: the recipe ${q(name)} was not opened, because ${q(front)} was put on screen after it was asked for. Ask whether they still want the recipe; open it only if they say so.`,

  noFood: () => 'Not done: no food was named, so nothing changed on screen. Ask which food they mean.',

  /** A comparison: `rows` side by side (the foods asked about), `put` looked up for it, `tableSize` rows in the table now. */
  compare: (rows: ShelfRow[], put: string[], tableSize: number, missing: string[] = []) => {
    const extra = tableSize > rows.length ? ` The table also holds ${tableSize - rows.length} other food${tableSize - rows.length === 1 ? '' : 's'} looked at earlier.` : '';
    const lost = missing.length ? ` The app could not find ${list(missing)} just now; say so in a few words.` : '';
    return `Done: side by side in the comparison table on the user's screen now: ${rows.map(rowText).join(' ')}${extra}${put.length ? ` Looked up for this: ${list(put)}.` : ''}${lost} Give a one-line verdict on what they asked about, from these figures only; if they asked nothing specific, name the one difference that matters most.`;
  },

  /** A recipe opened to be talked through, its first steps lit up. */
  recipe: (recipe: RecipeDetails, food: string, cook: Cook | null) => {
    const steps = recipe.preparation_steps;
    const head = `Done: on screen now, the recipe ${q(recipe.recipe_name)}${recipe.description ? ` (${trimEnd(recipe.description)})` : ''}${food ? `, a recipe idea for ${q(food)}` : ''}. Ingredients: ${recipe.ingredients.join('; ') || 'none listed'}.`;
    if (!steps.length || !cook?.shown) return `${head} It lists no steps. Tell them what goes in it in a sentence or two.`;
    const [a, b] = cook.shown;
    const lit = stepsLabel(cook.shown);
    const these = a === b ? 'that step' : 'those steps';
    const end = b + 1 >= steps.length ? ' That is the whole recipe.' : ' Ask them to say when they are ready; when they are, call next_steps.';
    return `${head} It has ${steps.length} steps; ${lit.toLowerCase()} ${a === b ? 'is' : 'are'} lit up: ${stepList(steps.slice(a, b + 1), a)} In a sentence say what it is, then talk them through ${these} only, as spoken sentences.${end}`;
  },

  /** A recipe the user opened with a tap: on screen, not yet talked through. */
  recipeTapped: (recipe: RecipeDetails) =>
    `The recipe ${q(recipe.recipe_name)} is open on their screen with its ingredients and ${recipe.preparation_steps.length} steps (in your board). Say one sentence about it and ask whether they would like you to talk them through it; if they do, call next_steps.`,

  recipeFailed: (name: string) =>
    `Not done: the recipe ${q(name)} could not be made just now, so nothing about it is on the user's screen. Say so in one short line without mentioning an error or a system; if they still want it, give a simple version out loud from what you know, one or two steps at a time.`,

  /** The next batch, lit up. */
  steps: (recipe: RecipeDetails, cook: Cook) => {
    const steps = recipe.preparation_steps;
    const [a, b] = cook.shown!;
    const last = b + 1 >= steps.length;
    return `Done: ${stepsLabel(cook.shown!).toLowerCase()} of ${steps.length} of ${q(recipe.recipe_name)} ${a === b ? 'is' : 'are'} lit up on screen now: ${stepList(steps.slice(a, b + 1), a)} Talk them through ${a === b ? 'that step' : 'those steps'} only, as spoken sentences${last ? '. That is the last step: when they are done, wish them a good meal.' : ', then ask them to say when they are ready for more.'}`;
  },

  stepsDone: (recipe: RecipeDetails) =>
    `Finished: every step of ${q(recipe.recipe_name)} has been given; nothing more is lit up. Ask how it is going, or whether they would like anything else.`,

  noRecipe: () => 'Not done: no recipe is open, so there are no steps to give. Ask which recipe they would like; open one only if they name it.',

  whichRecipe: () => 'Not done: nothing on screen matches that recipe, so nothing opened. Ask which dish they would like; open one only if they name it.',

  closed: (food: string | null) => `Done: the recipe is closed; ${food ? `the card for ${q(food)} is on screen again` : 'the screen is back to the start'}. Carry on in one short sentence.`,

  notOpen: (food: string | null) => `Nothing to close: no recipe was open; ${food ? `the card for ${q(food)} is on screen` : 'nothing is on screen yet'}.`,

  cleared: () => 'Done: cleared. The card, the comparison table and the opened recipes are gone, and the screen is empty. Say so in one line and invite them to name a food.',

  photo: (card: NutritionData, seen: string, sample: boolean, others: string[]) =>
    `The user ${sample ? 'tried the sample plate' : 'added a photo'}. The app read it${seen ? ` (${seen})` : ''} and put its card on screen, with figures ${card.source === 'label' ? 'read from its nutrition label' : 'estimated from what the food is, as there is no label to read'}${card.portion_assumed ? ', for an assumed portion' : ''}${others.length ? `; it joined the comparison table alongside ${list(others)}` : ''}. ${capital(cardText(card, 'names'))} In one or two sentences, say what stands out. Do not read the figures back.`,

  notFood: (seen: string) => `The user added a photo, but it does not show a food or a food label${seen ? ` (it looks like ${seen})` : ''}, and nothing new is on screen. Say so warmly in one short line and ask them to add another, or just name the food.`,

  photoFailed: () => PHOTO_FAILED,

  noVision: () => 'The app cannot read photos right now, and nothing new is on screen. Say so in one short line and ask them to name the food instead; do not mention an error or a system.',

  emergency: () => 'Tell them to call their local emergency number right now (911 in the US, 112 in Europe, 999 in the UK). The user may be describing a medical emergency, and an emergency notice is now at the top of their screen. Say it in one or two calm sentences, and nothing about food.',
};

/** A button press, told to the host: it cannot see the screen. */
export const pressed = (button: string, outcome: string) => `The user pressed "${button}" on screen. ${outcome}`;
