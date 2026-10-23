// Ported from the original agent's tests: test_two_foods_at_once.py (the
// shelf), test_parity.py (what a new card clears) and
// test_the_tapped_recipe_spins_forever.py (recipe names and blurbs).
import { describe, expect, it } from 'vitest';
import { Advisor, matchRecipe, MAX_SHELF, namesTheSameRecipe, recipeKey, sameFood } from './advisor.ts';
import type { NutritionData, RecipeDetails } from './types.ts';

function food(name: string, over: Omit<Partial<NutritionData>, 'nutrients'> & { nutrients?: Partial<NutritionData['nutrients']> } = {}): NutritionData {
  return {
    product_name: name,
    serving_size: '1 medium',
    calories: 100,
    health_score: 8,
    health_summary: `${name} is fine`,
    recipes: [],
    source: 'estimate',
    portion_assumed: true,
    ...over,
    nutrients: { protein_g: 1, carbs_g: 25, fat_g: 0.3, fiber_g: 3, sugar_g: 14, sodium_mg: 1, ...over.nutrients },
  };
}

const recipe = (name: string, over: Partial<RecipeDetails> = {}): RecipeDetails => ({ recipe_name: name, description: '', ingredients: ['x'], preparation_steps: ['y'], ...over });

describe('the two foods that could not both be on screen', () => {
  it('a second food joins the first instead of replacing it', () => {
    const a = new Advisor();
    a.show(food('medium banana', { calories: 105 }));
    a.show(food('medium apple', { calories: 95 }));
    const shelf = a.shelfPayload();
    expect(shelf.items.map((r) => r.product_name)).toEqual(['medium banana', 'medium apple']);
    expect(shelf.current).toBe('medium apple');
  });

  it('the comparison carries the numbers a comparison needs', () => {
    const a = new Advisor();
    a.show(food('medium banana', { calories: 105, health_score: 9, nutrients: { sugar_g: 14 } }));
    const [row] = a.shelfPayload().items;
    expect(row.calories).toBe(105);
    expect(row.sugar_g).toBe(14);
    expect(row.health_score).toBe(9);
  });

  it('the shelf drops none of the columns the card shows', () => {
    // A comparison missing a column cannot compare the foods that column
    // decides: butter and a stock cube side by side with nothing to tell them apart.
    const a = new Advisor();
    a.show(food('stock cube', { nutrients: { sodium_mg: 880 } }));
    const [row] = a.shelfPayload().items;
    for (const column of ['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg']) expect(row, column).toHaveProperty(column);
    expect(row.sodium_mg).toBe(880);
  });

  it('a shelf row is a row, not a whole card', () => {
    const a = new Advisor();
    a.show(food('medium banana', { recipes: [{ name: 'Smoothie', description: 'blend' }] }));
    const [row] = a.shelfPayload().items;
    expect(row).not.toHaveProperty('recipes');
    expect(row).not.toHaveProperty('health_summary');
  });

  it('the advisor is told which other foods are visible, and the first food of a session has none', () => {
    // What the avatar is told is its whole account of the screen: it used to
    // say nothing about the shelf, which is how "side by side" got claimed
    // for a screen showing one thing.
    const a = new Advisor();
    expect(a.show(food('medium banana'))).toEqual([]);
    expect(a.show(food('medium apple'))).toEqual(['medium banana']);
  });
});

describe('looking at the same thing twice', () => {
  it('updates the row rather than printing it twice', () => {
    const a = new Advisor();
    a.rememberFood(food('Greek yogurt', { calories: 100 }));
    a.rememberFood(food('greek YOGURT', { calories: 120 }));
    expect(a.shelf).toHaveLength(1);
    expect(a.shelf[0].calories).toBe(120);
  });

  it('keeps its place in the order', () => {
    const a = new Advisor();
    for (const name of ['banana', 'apple', 'yogurt']) a.rememberFood(food(name));
    a.rememberFood(food('apple', { calories: 95 }));
    expect(a.shelf.map((r) => r.product_name)).toEqual(['banana', 'apple', 'yogurt']);
  });

  it('a food with no name never reaches the shelf', () => {
    const a = new Advisor();
    a.rememberFood(food('  '));
    expect(a.shelf).toEqual([]);
  });

  it('the shelf stops growing and keeps the recent end', () => {
    const a = new Advisor();
    for (let i = 0; i < MAX_SHELF + 4; i++) a.rememberFood(food(`food ${i}`));
    expect(a.shelf).toHaveLength(MAX_SHELF);
    expect(a.shelf.at(-1)?.product_name).toBe(`food ${MAX_SHELF + 3}`);
  });

  it('a food already looked at comes back whole, by the name the user says', () => {
    // Same figures, no second model call: "show me the banana again".
    const a = new Advisor();
    const banana = food('Medium banana', { calories: 105 });
    a.show(banana);
    a.show(food('Medium apple'));
    expect(a.cardFor('banana')).toEqual(banana);
    expect(a.cardFor('bananas')).toEqual(banana);
    expect(a.cardFor('banana bread')).toBeNull();
    expect(a.onShelf('apple')).toBe(true);
    expect(a.onShelf('pineapple')).toBe(false);
  });

  it('forgets the whole card of a food that fell off the shelf', () => {
    const a = new Advisor();
    const names = ['kale', 'leek', 'okra', 'pear', 'plum', 'rice', 'sago', 'taro', 'yam'].slice(0, MAX_SHELF + 1);
    for (const name of names) a.show(food(name));
    expect(a.cardFor('kale')).toBeNull();
    expect(a.cardFor(names.at(-1)!)).not.toBeNull();
  });
});

describe('the recipe that used to evaporate', () => {
  it('a recipe survives the next food', () => {
    const a = new Advisor();
    a.show(food('medium banana'));
    a.open(recipe('Banana smoothie', { ingredients: ['banana', 'yogurt'], preparation_steps: ['blend'] }));
    a.show(food('medium apple'));
    // The CARD is correctly cleared: a banana recipe under an apple's name is
    // the bug that clearing exists to prevent...
    expect(a.recipe).toBeNull();
    // ...but the recipe itself is still there to go back to.
    expect(a.recipeNamed('Banana smoothie')?.ingredients).toEqual(['banana', 'yogurt']);
  });

  it('opening the same recipe twice keeps one copy of it', () => {
    const a = new Advisor();
    a.rememberRecipe(recipe('Smoothie', { ingredients: ['banana'] }));
    a.rememberRecipe(recipe('smoothie', { ingredients: ['banana', 'milk'] }));
    expect(a.recipes).toHaveLength(1);
    expect(a.recipes[0].ingredients).toEqual(['banana', 'milk']);
  });

  it('a recipe with no name is not kept', () => {
    const a = new Advisor();
    a.rememberRecipe(recipe(''));
    expect(a.recipes).toEqual([]);
  });

  it('the shelf lists the recipes by name only', () => {
    // The page needs to know one is there; the steps come when it is opened.
    const a = new Advisor();
    a.rememberRecipe(recipe('Smoothie', { ingredients: ['banana'], preparation_steps: ['blend'] }));
    expect(a.shelfPayload().recipes).toEqual([{ recipe_name: 'Smoothie' }]);
  });

  it('the kept recipes are capped like the shelf', () => {
    const a = new Advisor();
    for (let i = 0; i < MAX_SHELF + 3; i++) a.rememberRecipe(recipe(`dish ${i}`));
    expect(a.recipes).toHaveLength(MAX_SHELF);
  });
});

describe('the card is not blank under its title', () => {
  it('a recipe asked for out loud borrows the blurb from the card that suggested it', () => {
    const a = new Advisor();
    a.show(food('Greek yogurt', { recipes: [{ name: 'Berry parfait', description: 'Layer with fruit and granola.' }] }));
    expect(a.open(recipe('Berry parfait'))!.description).toBe('Layer with fruit and granola.');
  });

  it('a kept recipe replays with its description rather than blank', () => {
    const a = new Advisor();
    a.rememberRecipe(recipe('Berry parfait', { description: 'Layer with fruit and granola.' }));
    expect(a.reopen('Berry parfait')?.description).toBe('Layer with fruit and granola.');
  });

  it('a tap with a blurb fills in a kept copy that had none', () => {
    const a = new Advisor();
    a.rememberRecipe(recipe('Berry parfait'));
    expect(a.reopen('berry parfait', 'Layered.')?.description).toBe('Layered.');
  });

  it('a different dish asked for later is not titled after an earlier tap', () => {
    // The original's tapped name once outlived its tap: a spoken "how do I make
    // banana bread?" minutes later published banana bread under the tapped
    // title and overwrote the kept parfait. Here the name is the request's own.
    const a = new Advisor();
    a.show(food('Greek yogurt', { recipes: [{ name: 'Berry parfait', description: 'Layered.' }] }));
    a.open(recipe('Berry parfait', { ingredients: ['yogurt'] }));
    const bread = a.open(recipe('Banana bread', { ingredients: ['flour', 'banana'] }))!;
    expect(bread.recipe_name).toBe('Banana bread');
    expect(bread.description).toBe('');
    expect(a.recipeNamed('Berry parfait')?.ingredients).toEqual(['yogurt']);
  });
});

describe('recipes made ahead', () => {
  it('are ready for the card that suggested them, and only that card', () => {
    const a = new Advisor();
    a.show(food('Greek yogurt', { recipes: [{ name: 'Berry parfait', description: '' }, { name: 'Tzatziki', description: '' }] }));
    expect(a.ideasToPrepare().map((i) => i.name)).toEqual(['Berry parfait', 'Tzatziki']);
    a.prepare('Greek yogurt', recipe('Berry parfait'));
    expect(a.ideasToPrepare().map((i) => i.name)).toEqual(['Tzatziki']);
    expect(a.preparedFor('berry parfait')?.recipe_name).toBe('Berry parfait');
    expect(a.view().prepared.map((r) => r.recipe_name)).toEqual(['Berry parfait']);
    a.show(food('Medium apple'));
    expect(a.preparedFor('Berry parfait')).toBeNull();
    expect(a.view().prepared).toEqual([]);
  });

  it('a recipe already opened is not made again, nor staged', () => {
    const a = new Advisor();
    a.show(food('Greek yogurt', { recipes: [{ name: 'Berry parfait', description: '' }] }));
    a.prepare('Greek yogurt', recipe('Berry parfait'));
    a.open(recipe('Berry parfait'));
    expect(a.ideasToPrepare()).toEqual([]);
    expect(a.view().prepared).toEqual([]);
  });
});

describe('the order of things', () => {
  it('every change the page can see moves the view on, so an overtaken reply cannot put an older screen back', () => {
    const a = new Advisor();
    const seqs = [a.view().seq];
    a.show(food('Medium banana', { recipes: [{ name: 'Smoothie', description: '' }] }));
    seqs.push(a.view().seq);
    a.prepare('Medium banana', recipe('Smoothie'));
    seqs.push(a.view().seq);
    a.open(recipe('Smoothie'));
    seqs.push(a.view().seq);
    a.reopen('Smoothie');
    seqs.push(a.view().seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('starting over empties everything and still moves the view on', () => {
    const a = new Advisor();
    a.show(food('Medium banana', { recipes: [{ name: 'Smoothie', description: '' }] }));
    a.prepare('Medium banana', recipe('Smoothie'));
    a.open(recipe('Smoothie'));
    const before = a.view().seq;
    a.reset();
    const after = a.view();
    expect(after.seq).toBeGreaterThan(before);
    expect(after.nutrition).toBeNull();
    expect(after.shelf).toEqual({ current: '', items: [], recipes: [] });
    expect(after.prepared).toEqual([]);
    expect(a.cardFor('banana')).toBeNull();
    expect(a.recipeNamed('Smoothie')).toBeNull();
  });
});

describe('two spellings of one recipe', () => {
  it('a paraphrase of the name is the same dish, and another dish is not', () => {
    expect(namesTheSameRecipe('Berry parfait', 'Berry Parfait Bowl')).toBe(true);
    expect(namesTheSameRecipe('Berry parfait', 'berry-parfait')).toBe(true);
    expect(namesTheSameRecipe('Berry parfait', 'Banana bread')).toBe(false);
    expect(namesTheSameRecipe('', 'Banana bread')).toBe(true);
  });

  it('a title in any script keeps its letters', () => {
    // An ASCII-only key strips a Japanese title to nothing, and then every
    // recipe matches every other.
    expect(recipeKey('バナナスムージー')).toBe('バナナスムージー');
    expect(namesTheSameRecipe('バナナスムージー', '抹茶ラテ')).toBe(false);
  });

  it('a spoken name opens the idea the card offered, unless it could be two of them', () => {
    const ideas = ['Banana oat smoothie', 'Banana bread', 'Berry parfait'];
    expect(matchRecipe('the berry parfait bowl'.replace('the ', ''), ideas)).toBe('Berry parfait');
    expect(matchRecipe('smoothie', ideas)).toBe('Banana oat smoothie');
    expect(matchRecipe('banana bread', ideas)).toBe('Banana bread');
    expect(matchRecipe('banana', ideas)).toBeNull();
    expect(matchRecipe('lasagne', ideas)).toBeNull();
  });
});

describe('one food, said several ways', () => {
  it('portion words and plurals aside', () => {
    expect(sameFood('apple', 'Medium apple')).toBe(true);
    expect(sameFood('apples', 'apple')).toBe(true);
    expect(sameFood('greek yogurt', 'Plain Greek yogurt')).toBe(true);
    expect(sameFood('tomatoes', 'Medium tomato')).toBe(true);
    expect(sameFood('blueberries', 'Blueberry')).toBe(true);
    expect(sameFood('Medium banana (118 g)', 'banana')).toBe(true);
  });

  it('but never a different food', () => {
    expect(sameFood('apple', 'pineapple')).toBe(false);
    expect(sameFood('banana', 'banana bread')).toBe(false);
    expect(sameFood('chicken breast', 'chicken thigh')).toBe(false);
    expect(sameFood('', 'apple')).toBe(false);
    expect(sameFood('big mac', 'mac')).toBe(false);
  });
});

describe('work that started before something newer', () => {
  it('a card from older work joins the table without taking the card from newer work', () => {
    const a = new Advisor();
    const older = a.begin();
    const newer = a.begin();
    a.show(food('Medium pear'), newer);
    expect(a.mayFront(older)).toBe(false);
    a.show(food('Medium kiwi'), older);
    expect(a.nutrition?.product_name).toBe('Medium pear');
    expect(a.shelf.map((r) => r.product_name)).toEqual(['Medium pear', 'Medium kiwi']);
    expect(a.cardFor('kiwi')?.product_name).toBe('Medium kiwi');
  });

  it('cards from one piece of work all go up in turn, the last on the card', () => {
    const a = new Advisor();
    const t = a.begin();
    a.show(food('Medium banana'), t);
    a.show(food('Medium apple'), t);
    expect(a.nutrition?.product_name).toBe('Medium apple');
  });

  it('a recipe from older work is not opened over newer work, nor kept', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    const older = a.begin();
    a.show(food('Medium apple'));
    expect(a.open(recipe('Banana bread'), older)).toBeNull();
    expect(a.recipes).toEqual([]);
    expect(a.open(recipe('Apple crumble'))).not.toBeNull();
  });

  it('nothing started before "start over" may write after it', () => {
    const a = new Advisor();
    const older = a.begin();
    a.reset();
    expect(a.current(older)).toBe(false);
    expect(a.current(a.begin())).toBe(true);
  });
});
