// What the advisor has put on screen, and what she put there before that: the
// original agent's `State` and the bodies of its two tools
// (`display_nutrition_info`, `display_recipe_details`) and of its
// `explain_recipe` RPC, ported from persona.py and rpc.py. One writer, on the
// server: the model calls that fill it run there.
//
// `shelf` is the part that used to not exist. There was one slot (the LAST
// product), so "compare that with an apple" produced the avatar saying "I've
// displayed the nutrition info for both a medium apple and a medium banana side
// by side" over a screen showing only the banana. A user cannot compare two
// things they cannot see at once.
import type { NutritionData, RecipeDetails, RecipeIdea, Shelf, ShelfRow, View } from './types.ts';

/**
 * How many foods the shelf holds (and how many opened recipes are kept). In the
 * original the whole shelf rode in one 32 KiB envelope; here every row is in
 * the avatar's board, which has a 3,858-character limit. Eight is more than
 * anyone compares in one sitting.
 */
export const MAX_SHELF = 8;

/**
 * One food, reduced to what a comparison needs: not the whole card. A table has
 * no use for a paragraph of prose, and eight full cards with their recipes and
 * summaries would crowd the avatar's board.
 */
export function shelfRow(data: NutritionData): ShelfRow {
  const n = data.nutrients ?? ({} as NutritionData['nutrients']);
  return {
    product_name: String(data.product_name ?? '').trim(),
    serving_size: String(data.serving_size ?? ''),
    calories: data.calories || 0,
    protein_g: n.protein_g || 0,
    carbs_g: n.carbs_g || 0,
    fat_g: n.fat_g || 0,
    fiber_g: n.fiber_g || 0,
    sugar_g: n.sugar_g || 0,
    sodium_mg: n.sodium_mg || 0,
    health_score: data.health_score || 0,
    key: identity(data),
  };
}

/** The food's usual serving (the portion was not stated) or a label's own: not an amount the user named. */
const usualPortion = (card: NutritionData) => Boolean(card.portion_assumed || card.source === 'label');

const fold = (name: string) => (name ?? '').trim().toLowerCase();

/**
 * A recipe title reduced to what two spellings of it have in common: case and
 * punctuation only. "Berry parfait" and "Berry Parfait Bowl" are one dish said
 * twice, and "Banana bread" is not either of them.
 *
 * Letters and digits in any script: a Japanese or accented title is a title,
 * and stripping it to nothing (JavaScript's `\W` is ASCII-only) would make
 * every recipe match every other.
 */
export const recipeKey = (name: string) => (name ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Whether two names are plausibly the same recipe, one said longer than the
 * other. Nothing on one side means nothing to disagree with.
 */
export function namesTheSameRecipe(a: string, b: string): boolean {
  const left = recipeKey(a);
  const right = recipeKey(b);
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

/**
 * Which of `candidates` a spoken recipe name means: the same title first, then
 * the one title that contains it or is contained by it. A name that could be
 * two of them, or none, matches nothing (the app then makes the recipe the user
 * named rather than stamping another one's title on it).
 */
export function matchRecipe(spoken: string, candidates: string[]): string | null {
  const key = recipeKey(spoken);
  if (!key) return null;
  const exact = candidates.find((c) => recipeKey(c) === key);
  if (exact) return exact;
  const near = candidates.filter((c) => {
    const k = recipeKey(c);
    return Boolean(k) && (k.includes(key) || key.includes(k));
  });
  return near.length === 1 ? near[0] : null;
}

// Words that say how much, not what. "medium apple" and "apple" are one food.
const PORTION_WORDS = new Set([
  'a', 'an', 'the', 'one', 'some', 'small', 'medium', 'large', 'whole', 'fresh', 'raw', 'plain', 'regular',
  'of', 'serving', 'piece', 'cup', 'g', 'gram', 'grams', 'kg', 'mg', 'ml', 'oz', 'ounce', 'ounces',
]);

/** One spelling for singular and plural, applied the same way to both sides. */
const singular = (w: string) => {
  if (w.length <= 3 || w.endsWith('ss')) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(oes|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
};

const foodTokens = (name: string) =>
  (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !PORTION_WORDS.has(w) && !/^\d+([.,]\d+)?(g|ml|oz|mg|kg)?$/.test(w))
    .map(singular);

/**
 * Whether the user's name for a food is a food already looked at: the same
 * words once portion words are set aside. "apple" is the "Medium apple" on the
 * table; "banana bread" is not the banana, and "pineapple" is not the apple.
 */
export function sameFood(a: string, b: string): boolean {
  const left = foodTokens(a);
  const right = foodTokens(b);
  if (!left.length || !right.length || left.length !== right.length) return false;
  const set = new Set(right);
  return left.every((w) => set.has(w));
}

/** Measures: a number before one of these is a weight or a portion, not part of a food's name. */
const UNITS = new Set([
  'g', 'gram', 'grams', 'kg', 'mg', 'ml', 'l', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'cal', 'kcal',
  'cup', 'cups', 'tbsp', 'tsp', 'slice', 'slices', 'piece', 'pieces', 'serving', 'servings', 'pot', 'pots', 'can', 'cans',
  'bowl', 'bowls', 'bar', 'bars', 'small', 'medium', 'large', 'whole', 'handful', 'handfuls', 'scoop', 'scoops',
]);

/**
 * The food a card is about: its name without portion words and weights, in
 * any order or case. "Medium banana (118 g)" and "banana" are one food,
 * "Chicken breast, 200 g" and "breast, chicken" another; a number that is
 * part of a name ("Food 11", "7 Up") stays, one that measures ("118 g",
 * "1 medium") goes.
 */
export const foodKey = (name: string): string => {
  const words = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
  const kept: string[] = [];
  words.forEach((w, i) => {
    if (PORTION_WORDS.has(w) || UNITS.has(w) && /^\d/.test(words[i - 1] ?? '')) return;
    if (/^\d+([.,]\d+)?[a-z]+$/.test(w)) return;                     // "118g", "2cups"
    if (/^\d+([.,]\d+)?$/.test(w) && UNITS.has(words[i + 1] ?? '')) return; // "118 g", "1 medium"
    kept.push(singular(w));
  });
  return kept.sort().join(' ');
};

/** A portion as part of an identity: "usual", or the amount stated, as written. */
const portionKey = (portion: string) => (portion ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A card's identity: the food at a portion, the portion being "usual" (the
 * food's usual serving, or a label's) or the amount the user stated. The one
 * key the table, the cache and every lookup, comparison and photo use, so two
 * portions of one food are two rows and the same portion again is the same row.
 */
export const cardKey = (name: string, portion: string) => `${foodKey(name)}\u0000${portionKey(portion)}`;

/** The identity of a card or of its row in the table. */
export function identity(item: NutritionData | ShelfRow): string {
  if (!('nutrients' in item)) return item.key ?? cardKey(item.product_name, 'usual');
  return cardKey(item.product_name, usualPortion(item) ? 'usual' : item.serving_size);
}
const keyOf = identity;

export class Advisor {
  /** The card that is up. */
  nutrition: NutritionData | null = null;
  /** The recipe the advisor last put up, until a new card replaces it. */
  recipe: RecipeDetails | null = null;
  /** Every food looked at this session, oldest first, one row each. */
  shelf: ShelfRow[] = [];
  /** Recipes opened this session, so one is still there after the next food replaces the card it came from. */
  recipes: RecipeDetails[] = [];
  /** Whole cards by name, so a food already looked at can come back without a second model call. */
  private cards = new Map<string, NutritionData>();
  /** Recipes made ahead for cards' ideas, by food and recipe. */
  private prepared = new Map<string, RecipeDetails>();
  /** Bumped by every change the page can see. */
  private seq = 0;
  /**
   * Tickets for work that may change the screen, taken when it starts (a
   * lookup, a recipe, a photo: each waits on a model). Work that finishes
   * after newer work never undoes it: nothing started before a "start over"
   * writes after it, and nothing started before the card or recipe now in
   * front takes the front from it.
   */
  private tickets = 0;
  private clearedAt = 0;
  private frontAt = 0;
  /** The ticket of the work that last wrote each food (row and whole card), by its folded name. */
  private writtenAt = new Map<string, number>();

  // -- the order of work -----------------------------------------------------

  /** A ticket for work about to start. */
  begin(): number {
    return ++this.tickets;
  }

  /** Whether work that began with `ticket` may still write: not if the table was cleared since. */
  current(ticket: number): boolean {
    return ticket > this.clearedAt;
  }

  /** Whether it may still put something in front: not if work that began later already did. */
  mayFront(ticket: number): boolean {
    return this.current(ticket) && ticket >= this.frontAt;
  }

  // -- the shelf ------------------------------------------------------------

  /**
   * File a food on the shelf, replacing an earlier look at the same one.
   *
   * Replaced rather than appended: showing a label its own second reading
   * would print the same food twice and make the comparison useless. The
   * newer numbers win and the row keeps its place in the order things were
   * looked at.
   */
  rememberFood(data: NutritionData) {
    const row = shelfRow(data);
    if (!row.product_name) return;
    const key = keyOf(row);
    const index = this.shelf.findIndex((r) => keyOf(r) === key);
    if (index >= 0) {
      this.shelf[index] = row;
      return;
    }
    this.shelf.push(row);
    this.shelf.splice(0, Math.max(0, this.shelf.length - MAX_SHELF));
  }

  rememberRecipe(data: RecipeDetails) {
    const name = String(data.recipe_name ?? '').trim();
    if (!name) return;
    const key = fold(name);
    this.recipes = this.recipes.filter((r) => fold(r.recipe_name) !== key);
    this.recipes.push(data);
    this.recipes.splice(0, Math.max(0, this.recipes.length - MAX_SHELF));
  }

  shelfPayload(): Shelf {
    return {
      current: this.nutrition?.product_name ?? '',
      ...(this.nutrition ? { current_key: identity(this.nutrition) } : {}),
      items: this.shelf.map((row) => ({ ...row })),
      // The page needs to know one is there; the steps come with the recipe when it is opened.
      recipes: this.recipes.map((r) => ({ recipe_name: r.recipe_name })),
    };
  }

  recipeNamed(name: string): RecipeDetails | null {
    const key = fold(name);
    return this.recipes.find((r) => fold(r.recipe_name) === key) ?? null;
  }

  /** The whole card of a food already looked at (by its name as the user says it), if it is still on the shelf. */
  cardFor(name: string): NutritionData | null {
    // A plain ask is for the usual portion (or the label read from a photo):
    // the newest such card of that food, never a card for an amount someone stated.
    return this.newestOf(name, (card) => Boolean(card.portion_assumed || card.source === 'label'));
  }

  /** The newest card of a food at any portion (or the newest that `fits`), if one is on the table. */
  newestOf(name: string, fits: (card: NutritionData) => boolean = () => true): NutritionData | null {
    const food = foodKey(name);
    if (!food) return null;
    for (const row of [...this.shelf].reverse()) {
      if (foodKey(row.product_name) !== food) continue;
      const card = this.cards.get(keyOf(row));
      if (card && fits(card)) return card;
    }
    return null;
  }

  /** Whether a food the user names is already in the comparison table. */
  onShelf(name: string): boolean {
    return this.newestOf(name) !== null;
  }

  /**
   * A card's name as Rachel says it: with its serving when another card of the
   * same food is on the table ("Chicken breast (200 g)"), so two portions are
   * never "Chicken breast and Chicken breast".
   */
  label(item: NutritionData | ShelfRow): string {
    const food = foodKey(item.product_name);
    const key = keyOf(item);
    const shared = this.shelf.some((r) => foodKey(r.product_name) === food && keyOf(r) !== key);
    return shared && item.serving_size.trim() ? `${item.product_name} (${item.serving_size.trim()})` : item.product_name;
  }

  // -- display_nutrition_info -----------------------------------------------

  /**
   * Put a card up. Returns the other foods on the table, which the avatar is
   * told about so it stops claiming a side-by-side it did not produce and
   * starts describing the one that is actually on screen.
   */
  show(card: NutritionData, ticket = this.begin()): string[] {
    return this.place(card, ticket).others;
  }

  /**
   * `show`, saying what happened: the card as it now stands in the table
   * (the newer figures, when newer work already wrote this food at this
   * portion), whether it was written at all, and whether it took the front.
   */
  place(given: NutritionData, ticket = this.begin()): { card: NutritionData; others: string[]; written: boolean; front: boolean } {
    const card = given;
    const key = keyOf(card);
    const others = () => this.shelf.filter((r) => keyOf(r) !== key).map((r) => this.label(r));
    // Newer work already wrote this food: an older card of it writes nowhere,
    // or the table and the cache would hold older figures than the label.
    if ((this.writtenAt.get(key) ?? 0) > ticket) return { card: this.cards.get(key) ?? card, others: others(), written: false, front: false };
    this.writtenAt.set(key, ticket);
    this.seq += 1;
    // Work overtaken by newer work files its food in the table, behind what is in front.
    const front = this.mayFront(ticket);
    if (front) {
      this.frontAt = ticket;
      this.nutrition = card;
      // A new food invalidates the recipe CARD: leaving it up would pair one
      // food's name with another's ingredients. The recipe itself is kept on
      // `recipes`, so it is still reachable.
      this.recipe = null;
    }
    this.rememberFood(card);
    this.cards.set(key, card);
    for (const held of this.cards.keys()) if (!this.shelf.some((r) => keyOf(r) === held)) this.cards.delete(held);
    return { card, others: others(), written: true, front };
  }

  // -- display_recipe_details -----------------------------------------------

  /**
   * Put a recipe up under the name it was asked for, and keep it.
   *
   * Without a description the kept copy replays under its title with nothing
   * beneath it, which reads as a card that failed to load. A recipe asked for
   * out loud never went through a tap, so the blurb comes from the card's own
   * suggestion when there is one.
   */
  open(recipe: RecipeDetails, ticket = this.begin()): RecipeDetails | null {
    // A recipe asked for before the card now in front would cover the newer answer.
    if (!this.mayFront(ticket)) return null;
    this.frontAt = ticket;
    const name = recipe.recipe_name.trim();
    this.seq += 1;
    const data: RecipeDetails = {
      recipe_name: name,
      description: recipe.description || this.suggestedDescription(name),
      ingredients: [...recipe.ingredients],
      preparation_steps: [...recipe.preparation_steps],
    };
    this.recipe = data;
    this.rememberRecipe(data);
    return data;
  }

  /** The blurb the card offered for this recipe, if it offered one. */
  suggestedDescription(name: string): string {
    const key = fold(name);
    if (!key) return '';
    return this.nutrition?.recipes.find((r) => fold(r.name) === key)?.description ?? '';
  }

  // -- explain_recipe ---------------------------------------------------------

  /**
   * A recipe opened before, handed straight back rather than paying for the
   * model again: what makes a recipe something to return to instead of
   * something watched going past. The blurb it was tapped with fills in one the
   * kept copy lacks.
   */
  reopen(name: string, description = '', ticket = this.begin()): RecipeDetails | null {
    const kept = this.recipeNamed(name);
    if (!kept || !this.mayFront(ticket)) return null;
    this.frontAt = ticket;
    this.seq += 1;
    if (description && !kept.description) kept.description = description;
    this.recipe = kept;
    return kept;
  }

  // -- recipes made ahead ------------------------------------------------------

  /** The current card's recipe ideas that are neither kept nor made ahead yet. */
  ideasToPrepare(): RecipeIdea[] {
    const food = this.nutrition?.product_name ?? '';
    return (this.nutrition?.recipes ?? []).filter((idea) => !this.recipeNamed(idea.name) && !this.prepared.has(prepKey(food, idea.name)));
  }

  prepare(food: string, recipe: RecipeDetails, ticket = this.begin()) {
    if (!this.current(ticket)) return;
    this.seq += 1;
    this.prepared.set(prepKey(food, recipe.recipe_name), recipe);
  }

  /** A recipe made ahead for the current card, by its name. */
  preparedFor(name: string): RecipeDetails | null {
    return this.prepared.get(prepKey(this.nutrition?.product_name ?? '', name)) ?? null;
  }

  // -- start over -------------------------------------------------------------

  /**
   * Clear the card, the table and the kept recipes. The sequence keeps
   * counting: a fresh advisor would restart at 0, and the page would take
   * the empty screen for a stale reply and keep the old one.
   */
  reset() {
    this.seq += 1;
    this.clearedAt = this.frontAt = this.begin();
    this.nutrition = null;
    this.recipe = null;
    this.shelf = [];
    this.recipes = [];
    this.cards.clear();
    this.prepared.clear();
    this.writtenAt.clear();
  }

  view(): View {
    const food = this.nutrition?.product_name ?? '';
    const prepared = (this.nutrition?.recipes ?? [])
      .filter((idea) => !this.recipeNamed(idea.name))
      .map((idea) => this.prepared.get(prepKey(food, idea.name)))
      .filter((r): r is RecipeDetails => Boolean(r));
    return { seq: this.seq, nutrition: this.nutrition, shelf: this.shelfPayload(), prepared };
  }
}

const prepKey = (food: string, recipe: string) => `${fold(food)}\u0000${recipeKey(recipe)}`;
