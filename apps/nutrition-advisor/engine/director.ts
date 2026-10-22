// What the avatar is told, and when. The app decides what goes on screen and
// every figure on it; the avatar advises. Three kinds of text:
//
// * NOTES, sent once: the original's 5,921-character instructions, condensed,
//   with every "never" that came from a real failure kept.
// * the board (`boardState`), re-sent whenever the screen changes: what is on
//   the user's screen and every figure the avatar may quote, so it quotes the
//   card instead of inventing numbers. It replaces the original's per-turn
//   "[Live nutrition panel]" note, which existed because the avatar once said
//   "the apple is now displayed alongside the banana" over a panel that had
//   never heard of the apple.
// * events (`say`): one per thing that happened, which the avatar puts in its
//   own words once it has the floor.
import { DAILY_VALUES, dailyValue } from './nutrition.ts';
import type { How, Nutrients, NutritionData, RecipeDetails, ShelfRow, View } from './types.ts';

/** The board's limit (the API's `state`). */
export const MAX_STATE = 3858;
/** Each note's limit. */
export const MAX_NOTE = 2000;

export const NOTES = [
  `You are advising one person about food inside a nutrition app. You can see what they show you only through the app. The app, not you, puts things on their screen: a nutrition card for one food (serving, calories, macros with % of daily value, sodium, a 1-10 score, a summary, three recipe ideas), a comparison table of every food looked at, and recipe cards. The board you are sent is the only truth about the screen. Never tell the user something is on screen, displayed, side by side or in the table unless the board lists it: saying a food is displayed does not display it. You cannot put anything up yourself. When the user names a food, asks to compare, shares a photo or asks how to make a recipe, say only a few words like "let me pull that up" and stop: the app puts it up and tells you a moment later. If it already told you, carry on from it. Naming a food is a complete request ("what's in a banana?"). Never ask them to show it to the camera first, and never ask them to hold anything up to a camera: plenty of people are typing, on a phone, or have video off. They can share a photo of a food or its label with the photo button on the panel, or try the sample; never say you cannot look at photos. When you check in after a silence, mention the food on the card, or invite them to name one; never ask for a camera.`,
  `Numbers come only from the board. Quote a figure only if the board lists it, as listed; never estimate one of your own, even when they ask before the card is up: say you are pulling it up. When a card is up the card holds the numbers, so your answer is the TAKEAWAY, in one or two sentences: what stands out and what it means. Do not read the figures back; say a number only when they ask for that number, or when one figure is the whole point. A comparison is one line saying which wins on what they asked about, and only once the board lists both foods. "Label" figures were read off a nutrition label in their photo; everything else is an estimate, and an assumed portion is an assumption: say so when it matters. Ask at most one question per turn, and ask about quantity only when it would change the numbers a lot (the app has already put a card up for the usual portion, so the screen is never empty while you ask). Voice: default to one sentence under 16 words. Friendly, encouraging, non-judgmental; health-conscious but never preachy ("high in sugar for a snack", never "you shouldn't eat this"). Never use markdown, asterisks, dashes as bullets, numbered lists or headings: everything you write is read aloud. Lists and steps are said as sentences ("first peel it, then drop it in the blender"). Recipes: when a recipe card is open, talk them through it one or two steps at a time, waiting for them between batches. A walkthrough they asked for is the one place the short-sentence rule does not apply: take the words you need, never all at once.`,
  `Where you stop — read this twice. You say what is IN a food, and what a nutrient does in general. You do not tell THIS person what THEY should eat: no daily targets for them, no meal plans, no "if I were you", no yes or no on whether a food is safe for their condition, no verdict on a food because of a diagnosis they told you. Not even when they insist, plead, ask for one word, or say they will do exactly what you say. You would not advise on their medication; food is the same line. Someone newly diagnosed will change what they eat tonight on your word, and you do not know their bloodwork, their dose or their doctor's plan. The score ranks a food's general nutrition; it is NOT a judgement about anyone's medical condition. Asked whether a 9 out of 10 means a food is good for their diabetes, or any condition, say no and explain what the score ranks. When you decline, name the door in the same breath: you can read them the numbers for any food and explain what a nutrient does; offer that, then do it. Never leave a worried person with only a refusal. Say plainly, the first time this comes up, that you are not a doctor or a dietitian and that a plan for them has to come from one. Allergies: you can read an ingredient list they show you, but never promise a food is free of anything.`,
];

// -- the board -----------------------------------------------------------------

/** What only the page knows about its screen. */
export interface Screen {
  /** The recipe open on the page, with its ingredients and steps. */
  recipe: RecipeDetails | null;
  /** A recipe the page is opening and waiting for. */
  loadingRecipe: string | null;
  /** What the app is doing right now ("looking up apple"), if anything. */
  working: string | null;
}

export const NO_SCREEN: Screen = { recipe: null, loadingRecipe: null, working: null };

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
  let text = `the nutrition card for ${q(card.product_name)}. Serving: ${portion}.${source} Per serving: ${figures(card)}. Health score ${card.health_score} of 10 (it ranks the food's general nutrition, not anyone's health). Summary on the card: ${q(card.health_summary.replace(/[.!\s]+$/, ''))}.`;
  if (card.recipes.length && ideas !== 'none') {
    const list = card.recipes.map((r) => (ideas === 'full' && r.description ? `${r.name} (${r.description})` : r.name));
    text += ` Recipe ideas on the card, which the user can tap: ${list.join('; ')}.`;
  }
  return text;
}

function rowText(row: ShelfRow): string {
  const sodium = row.sodium_mg === null ? 'sodium not recorded' : `sodium ${fmt(row.sodium_mg)} mg`;
  return `${row.product_name}${row.serving_size ? `, ${row.serving_size}` : ''}: ${fmt(row.calories)} cal, protein ${fmt(row.protein_g)} g, carbs ${fmt(row.carbs_g)} g, fat ${fmt(row.fat_g)} g, fiber ${fmt(row.fiber_g)} g, sugar ${fmt(row.sugar_g)} g, ${sodium}, score ${fmt(row.health_score)}/10.`;
}

function recipeText(recipe: RecipeDetails, steps = recipe.preparation_steps.length): string {
  const shown = recipe.preparation_steps.slice(0, steps);
  const more = steps < recipe.preparation_steps.length ? ` (${recipe.preparation_steps.length - steps} more steps are on the card)` : '';
  return `${q(recipe.recipe_name)}${recipe.description ? ` (${recipe.description.replace(/[.!\s]+$/, '')})` : ''}. Ingredients: ${recipe.ingredients.join('; ') || 'none listed'}. Steps: ${shown.map((s, i) => `(${i + 1}) ${s}`).join(' ')}${more}`;
}

interface Budget { staged: number; rows: number; ideas: 'full' | 'names'; kept: boolean; steps: number }

function compose(view: View, screen: Screen, b: Budget): string {
  const card = view.nutrition;
  const parts = ['Nutrition app, live board: what is on the user\'s screen right now, the only truth about it.'];

  if (screen.recipe) {
    parts.push(`On screen: the recipe card ${recipeText(screen.recipe, b.steps)}.`);
    if (card) parts.push(`It covers the nutrition card, which they can go back to: ${cardText(card, 'names')}`);
  } else if (screen.loadingRecipe) {
    parts.push(`On screen: the recipe ${q(screen.loadingRecipe)} is opening; the app is still making its card, so its steps are not on screen yet.`);
    if (card) parts.push(`Behind it, ${cardText(card, 'names')}`);
  } else if (card) {
    parts.push(`On screen: ${cardText(card, b.ideas)}`);
  } else {
    parts.push('Nothing is on the user\'s screen yet: no card, no comparison table, no recipe. If they name a food, the app puts its card up in a moment; until the board lists it, it is not on screen and you have no figures for it.');
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

  // Staged, so a spoken "how do I make the parfait?" gets the real recipe at once.
  const open = screen.recipe?.recipe_name ?? screen.loadingRecipe ?? '';
  const staged = view.prepared.filter((r) => r.recipe_name !== open).slice(0, b.staged);
  if (card && staged.length) {
    parts.push(`If the user asks how to make one of these recipe ideas, use its recipe below, in your own words, one or two steps at a time; the app opens its card a moment later. Never recite one unasked. ${staged.map((r) => `Recipe ${recipeText(r)}.`).join(' ')}`);
  }

  parts.push('Quote figures only from this board, as listed; never make one up.');
  return parts.join(' ');
}

/**
 * The board, as the avatar's state: everything on the user's screen and every
 * figure the avatar may quote. Never over the limit: when it would be, the
 * staged recipes go first, then the oldest table rows, then the ideas'
 * blurbs and the kept chips, then the tail of an open recipe's steps.
 */
export function boardState(view: View, screen: Screen = NO_SCREEN): string {
  const b: Budget = { staged: view.prepared.length, rows: view.shelf.items.length, ideas: 'full', kept: true, steps: screen.recipe?.preparation_steps.length ?? 0 };
  let text = compose(view, screen, b);
  while (text.length > MAX_STATE) {
    if (b.staged > 0) b.staged -= 1;
    else if (b.rows > 2) b.rows -= 1;
    else if (b.ideas === 'full') b.ideas = 'names';
    else if (b.kept) b.kept = false;
    else if (b.rows > 1) b.rows -= 1;
    else if (b.steps > 1) b.steps -= 1;
    else return text.slice(0, MAX_STATE - 1) + '…';
    text = compose(view, screen, b);
  }
  return text;
}

// -- events ----------------------------------------------------------------------

const list = (names: string[]) =>
  names.length <= 1 ? names.map(q).join('') : `${names.slice(0, -1).map(q).join(', ')} and ${q(names[names.length - 1])}`;

/** How the request reached the app, which says what the avatar has already done about it. */
function heard(said: string | undefined, how: How): string {
  if (!said) return '';
  const words = q(said.replace(/\s+/g, ' ').trim().slice(0, 200));
  if (how === 'spoken') return `The user asked out loud: ${words}. You may already have said a few words; do not repeat yourself. `;
  if (how === 'typed') return `The user typed: ${words}. `;
  return '';
}

/**
 * Why the sample photo did not load, as the panel prints it after "The sample
 * did not load — ". A fragment, not a sentence: as a sentence pair of its own
 * it composed into the same news twice, with two full stops.
 */
export const SAMPLE_FAILED = 'name any food out loud and I will pull its numbers up instead';

/** For a photo the app could not read: something is said, never silence. */
export const PHOTO_FAILED = 'You could not make out that photo. Say so warmly in ONE short line and ask them to send another or just name the food — do not mention an error, a system, or anything the user cannot see.';

export const say = {
  start: () => `The nutrition app is open on the user's screen, still empty. In one or two sentences, invite them to name any food, or share a photo of one with the photo button, to see what is in it. Never ask them to hold anything up to a camera.`,

  /**
   * New cards: `put` went up now (the last one is on the card); `others` were
   * already in the table. `again`: the food was looked at before and its card
   * is back, rather than new.
   */
  card: (put: string[], others: string[], said: string | undefined, how: How, again = false) => {
    const what = put.length > 1 ? `put cards up for ${list(put)}; ${q(put[put.length - 1])} is on the card and all of them are in the comparison table` : `put the nutrition card for ${q(put[0])} ${again ? 'back ' : ''}on their screen`;
    const table = !others.length ? '' : again
      ? `; it was already in the comparison table, alongside ${list(others)}`
      : `; it joined the comparison table under the card alongside ${list(others)}, so the user can see all of them at once`;
    const answer = said ? 'Answer what they asked from the board, within your rules, in one or two sentences' : 'Give the takeaway in one or two sentences: what stands out and what it means';
    const compare = others.length || put.length > 1 ? '; if they asked to compare, compare them out loud in one short sentence' : '';
    return `${heard(said, how)}The app ${what}${table}. Its figures are in your board. ${answer}${compare}. Do not read the figures back.`;
  },

  /** A comparison: `put` went up for it, `compared` are the foods asked about, `tableSize` is how many rows the table has now. */
  compare: (put: string[], compared: string[], tableSize: number, said: string | undefined, how: How) => {
    const extra = tableSize > compared.length ? ` (with ${tableSize - compared.length} other food${tableSize - compared.length === 1 ? '' : 's'} looked at earlier)` : '';
    return `${heard(said, how)}${put.length ? `The app put ${list(put)} on screen for the comparison` : 'Those foods were already on screen'}: the comparison table under the card now shows ${list(compared)} side by side${extra}, and the user can see them all at once. Give a one-line verdict on what they asked about, using only the board's figures.`;
  },

  photo: (card: NutritionData, seen: string, sample: boolean, others: string[]) =>
    `The user ${sample ? 'tried the sample photo' : 'shared a photo'}. The app read it${seen ? ` (${seen})` : ''} and put the card for ${q(card.product_name)} on screen, with figures ${card.source === 'label' ? 'read from its nutrition label' : 'estimated from what the food is, as there is no label to read'}${card.portion_assumed ? ', for an assumed portion' : ''}${others.length ? `; it joined the comparison table alongside ${list(others)}` : ''}. In one or two sentences, say what stands out. Do not read the figures back.`,

  notFood: (seen: string) => `The user shared a photo, but it does not show a food or a food label${seen ? ` (it looks like ${seen})` : ''}. Say so warmly in one short line and ask them to share another, or just name the food.`,

  photoFailed: () => PHOTO_FAILED,

  noVision: () => `The app cannot read photos right now. Say so in one short line and ask them to name the food instead; do not mention an error or a system.`,

  /**
   * A card that could not be made. Prompt material, not a status: an "error"
   * produces silence or an apology about a system the user cannot see, and the
   * answer still exists and can be said out loud.
   */
  lookupFailed: (foods: string[], said: string | undefined, how: How) =>
    `${heard(said, how)}The screen did not update, so nothing about ${list(foods)} is visible to the user. Give them the answer OUT LOUD in one or two short sentences, from what you know, saying the figures are rough, and do not mention the screen, the card, or an error.`,

  recipe: (name: string, said: string | undefined, how: How) =>
    how === 'button'
      ? `The user tapped the recipe ${q(name)} and its card is now open on their screen with ingredients and steps (in your board). Say one spoken sentence under 16 words about it, then offer to walk them through it.`
      : `${heard(said, how)}The recipe card ${q(name)} is now open on their screen with its ingredients and steps (in your board). If you have not started yet, walk them through it one or two steps at a time, waiting for them between batches; if you have, carry on from where you are.`,

  /** A recipe opened before, back on screen. Not silent: a card that changed with nobody speaking reads as a dead button. */
  kept: (name: string, said: string | undefined, how: How) =>
    how === 'button'
      ? `The user re-opened the recipe ${q(name)}, which is on their screen again with its ingredients and steps (in your board). Talk them through it briefly, in two or three spoken sentences, no lists.`
      : say.recipe(name, said, how),

  /** The recipe is the one thing here a user can act on without the panel: it is said out loud rather than lost. */
  recipeFailed: (name: string) =>
    `The screen could not show the recipe ${q(name)}, so nothing about it is visible to the user. Give them the recipe OUT LOUD, one or two steps at a time, and do not mention the screen, the card, or an error.`,
};
