import { describe, expect, it } from 'vitest';
import { asked, concernIn, foodsFrom, mustDo, parseFood, resolveRecipe, type NetContext, type RecipeContext } from './judge.ts';

const IDEAS: RecipeContext = {
  ideas: [
    { name: 'Banana oat smoothie', description: 'Blend it with oats.' },
    { name: 'Peanut butter banana toast', description: 'On wholegrain toast.' },
    { name: 'Banana oat pancakes', description: 'Mash with oats and egg.' },
  ],
  kept: [],
  openRecipe: null,
};

describe('a food, as the user named it', () => {
  it('drops the words that are not the food', () => {
    expect(parseFood('the apple too please')).toEqual({ name: 'apple', quantity: '' });
    expect(parseFood('an apple on the screen')).toEqual({ name: 'apple', quantity: '' });
    expect(parseFood('half an avocado')).toEqual({ name: 'avocado', quantity: 'half an' });
    expect(parseFood('200g chicken breast')).toEqual({ name: 'chicken breast', quantity: '200g' });
  });

  it('a quantity the user states is kept, and a default portion is not a statement', () => {
    expect(parseFood('200 g of chicken breast')).toEqual({ name: 'chicken breast', quantity: '200 g' });
    expect(parseFood('two bananas')).toEqual({ name: 'bananas', quantity: 'two' });
    expect(parseFood('a cup of rice')).toEqual({ name: 'rice', quantity: 'a cup' });
    expect(parseFood('a large banana')).toEqual({ name: 'banana', quantity: 'large' });
    expect(parseFood('a banana')).toEqual({ name: 'banana', quantity: '' });
    expect(parseFood('a Big Mac')).toEqual({ name: 'big mac', quantity: '' });
  });

  it('accents and curly apostrophes are the recogniser’s spelling, not a different food', () => {
    expect(parseFood('crème brûlée')).toEqual({ name: 'creme brulee', quantity: '' });
    expect(parseFood('a jalapeño')).toEqual({ name: 'jalapeno', quantity: '' });
  });

  it('a pointer or a nutrient is not a food', () => {
    for (const said of ['it', 'that one', 'sodium', 'the score', 'both', 'the recipe']) expect(parseFood(said), said).toBeNull();
  });
});

describe('the foods a tool call names', () => {
  it('one per item, with their amounts', () => {
    expect(foodsFrom(['200 g chicken breast', 'a banana'])).toEqual([{ name: 'chicken breast', quantity: '200 g' }, { name: 'banana', quantity: '' }]);
  });

  it('two foods in one item are split only where each starts like a food of its own', () => {
    expect(foodsFrom(['a banana and an apple'])).toEqual([{ name: 'banana', quantity: '' }, { name: 'apple', quantity: '' }]);
    expect(foodsFrom(['rice and beans'])).toEqual([{ name: 'rice and beans', quantity: '' }]);
    expect(foodsFrom(['mac and cheese'])).toEqual([{ name: 'mac and cheese', quantity: '' }]);
  });

  it('"it" is the card, already on screen: it is left out, not looked up', () => {
    expect(foodsFrom(['it', 'an apple'])).toEqual([{ name: 'apple', quantity: '' }]);
    expect(foodsFrom(['that'])).toEqual([]);
  });

  it('takes a lone string, drops junk and repeats, and never more than three', () => {
    expect(foodsFrom('oat milk')).toEqual([{ name: 'oat milk', quantity: '' }]);
    expect(foodsFrom([42, null, 'apple', 'apple'])).toEqual([{ name: 'apple', quantity: '' }]);
    expect(foodsFrom(['a', 'kiwi', 'pear', 'plum', 'fig'].slice(1))).toHaveLength(3);
    expect(foodsFrom(undefined)).toEqual([]);
  });

  it('says a food back the way it was asked', () => {
    expect(asked({ name: 'chicken breast', quantity: '200 g' })).toBe('200 g chicken breast');
    expect(asked({ name: 'banana', quantity: '' })).toBe('banana');
  });
});

describe('the recipe a tool call names', () => {
  it('by order, by name, or by a paraphrase of the name', () => {
    expect(resolveRecipe('the second one', IDEAS)).toEqual(IDEAS.ideas[1]);
    expect(resolveRecipe('the last one', IDEAS)).toEqual(IDEAS.ideas[2]);
    expect(resolveRecipe('first', IDEAS)).toEqual(IDEAS.ideas[0]);
    expect(resolveRecipe('the smoothie', IDEAS)).toEqual(IDEAS.ideas[0]);
    expect(resolveRecipe('Banana Oat Smoothie', IDEAS)).toEqual(IDEAS.ideas[0]);
  });

  it('"it" is the recipe that is open, else the card’s first idea', () => {
    expect(resolveRecipe('it', IDEAS)).toEqual(IDEAS.ideas[0]);
    expect(resolveRecipe('it', { ...IDEAS, openRecipe: 'Banana oat pancakes' })).toEqual(IDEAS.ideas[2]);
    expect(resolveRecipe('the recipe', { ...IDEAS, openRecipe: 'Banana oat pancakes' })).toMatchObject({ name: 'Banana oat pancakes' });
  });

  it('a dish of the user’s own keeps their name; a name that could be two ideas is theirs too', () => {
    expect(resolveRecipe('banana bread', IDEAS)).toEqual({ name: 'Banana bread', description: '' });
    expect(resolveRecipe('banana oat', IDEAS)).toEqual({ name: 'Banana oat', description: '' });
  });

  it('a recipe opened before is found by its name', () => {
    expect(resolveRecipe('the tzatziki', { ...IDEAS, kept: ['Tzatziki dip'] })).toEqual({ name: 'Tzatziki dip', description: '' });
  });

  it('nothing to name, nothing to open', () => {
    expect(resolveRecipe('the third one', { ...IDEAS, ideas: IDEAS.ideas.slice(0, 1) })).toBeNull();
    expect(resolveRecipe('it', { ideas: [], kept: [], openRecipe: null })).toBeNull();
  });
});

describe('what the safety net does when the host does not, and only what is safe to repeat', () => {
  const EMPTY: NetContext = { card: null, shelf: [], openRecipe: null };
  const BANANA: NetContext = { card: 'Medium banana', shelf: ['Medium banana', 'Medium apple'], openRecipe: null };
  const COOKING: NetContext = { ...BANANA, openRecipe: 'Banana oat smoothie' };

  it.each([
    ["What's in a banana?", EMPTY, { name: 'look_up_food', arguments: { foods: ['banana'] } }],
    ['How many calories are in a Big Mac?', EMPTY, { name: 'look_up_food', arguments: { foods: ['big mac'] } }],
    ['How much protein is in 200 g of chicken breast?', BANANA, { name: 'look_up_food', arguments: { foods: ['200 g chicken breast'] } }],
    ['Nutrition facts for oat milk, please', BANANA, { name: 'look_up_food', arguments: { foods: ['oat milk'] } }],
    ['Can you look up hummus for me', BANANA, { name: 'look_up_food', arguments: { foods: ['hummus'] } }],
    ["What's in a banana and an apple?", EMPTY, { name: 'look_up_food', arguments: { foods: ['banana', 'apple'] } }],
    ['What about an orange?', BANANA, { name: 'look_up_food', arguments: { foods: ['orange'] } }],
    ['Go back to the card', COOKING, { name: 'close_recipe', arguments: {} }],
    ['Close the recipe please', COOKING, { name: 'close_recipe', arguments: {} }],
    ["Let's start over.", BANANA, { name: 'start_over', arguments: {} }],
    ['Can you clear the table?', BANANA, { name: 'start_over', arguments: {} }],
  ] as const)('%s', (said, ctx, expected) => {
    expect(mustDo(said, ctx)).toEqual(expected);
  });

  it.each([
    // What is on screen is the host's to answer from the board: the net never puts it up again.
    ["What's in a banana?", BANANA],
    ['What about the apple?', BANANA],
    ["What's in it?", BANANA],
    ['How much sugar does it have?', BANANA],
    ['Which one has more fiber?', BANANA],
    // A comparison or a recipe is the host's call, and a step is never safe to repeat.
    ['Compare it with an apple', BANANA],
    ['Walk me through the first one', BANANA],
    ['Next step', COOKING],
    ["OK, what's next?", COOKING],
    // "Back" with no recipe open is nothing to do.
    ['Go back', BANANA],
    // Anything about the user's own health is the host's to decline, never the app's to act on.
    ["I have diabetes. What's in a banana?", EMPTY],
    ['Is a mango safe for me? I take insulin.', EMPTY],
    ['Thanks!', BANANA],
    ['ok', BANANA],
  ] as const)('nothing for: %s', (said, ctx) => {
    expect(mustDo(said, ctx)).toBeNull();
  });

  it('a food on screen asked about with a new amount is a new card', () => {
    expect(mustDo("What's in two bananas?", BANANA)).toEqual({ name: 'look_up_food', arguments: { foods: ['two bananas'] } });
  });
});

describe('the safety line the page draws itself', () => {
  it.each([
    "I think I'm having an allergic reaction",
    'My throat is closing up',
    'my tongue is swelling after the peanuts',
    "I can't breathe properly",
    'He is choking!',
    'Where is my EpiPen? I need my epi pen',
    'Call an ambulance',
    'She is having trouble breathing',
  ])('an emergency: %s', (said) => {
    expect(concernIn(said)).toBe('emergency');
  });

  it.each([
    'I have diabetes. Is a banana safe for me to eat every day?',
    "I'm diabetic, can I eat this?",
    "I'm pregnant, is tuna okay?",
    'My son is allergic to nuts, does this have any?',
    "I'm on statins, should I avoid grapefruit?",
    "I'm lactose intolerant",
    'My blood sugar runs high',
    'Is this safe for me?',
    'How many carbs should I eat a day?',
    'Make me a meal plan to lose weight',
    'My doctor told me to cut salt',
  ])('a question about their own health: %s', (said) => {
    expect(concernIn(said)).toBe('medical');
  });

  it.each([
    "What's in a banana?",
    'Is a banana good for you?',
    'Is avocado healthy?',
    'How much cholesterol is in an egg?',
    'Can peanuts cause an allergic reaction?',
    'What is anaphylactic shock?',
    'What can I make with kidney beans?',
    'Which has more sugar?',
    'Thanks, that was helpful',
  ])('nothing: %s', (said) => {
    expect(concernIn(said)).toBeNull();
  });
});
