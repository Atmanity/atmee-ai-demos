import { describe, expect, it } from 'vitest';
import { bareFood, intentFrom, judgePrompt, parseFood, ruleIntent, type JudgeContext } from './judge.ts';
import type { Intent } from './types.ts';

const EMPTY: JudgeContext = { card: null, ideas: [], kept: [], shelf: [], openRecipe: null, lastAvatarLine: '' };
const BANANA: JudgeContext = {
  ...EMPTY,
  card: 'Medium banana',
  shelf: ['Medium banana'],
  ideas: [
    { name: 'Banana oat smoothie', description: 'Blend it with oats.' },
    { name: 'Peanut butter banana toast', description: 'On wholegrain toast.' },
    { name: 'Banana oat pancakes', description: 'Mash with oats and egg.' },
  ],
};

const foods = (intent: Intent | null) => (intent && 'foods' in intent ? intent.foods : null);
const names = (intent: Intent | null) => foods(intent)?.map((f) => f.name);

describe('naming a food is a complete request', () => {
  it.each([
    ["What's in a banana?", ['banana']],
    ['whats in an avocado', ['avocado']],
    ['How many calories are in a Big Mac?', ['big mac']],
    ['How much protein is in Greek yogurt?', ['greek yogurt']],
    ['How much sugar does a can of Coke have?', ['coke']],
    ['Nutrition facts for oat milk, please', ['oat milk']],
    ['Tell me about quinoa.', ['quinoa']],
    ['What about an orange?', ['orange']],
    ['And an apple?', ['apple']],
    ['Is a banana good for you?', ['banana']],
    ['Can you look up hummus for me', ['hummus']],
    ["What's in a banana and an apple?", ['banana', 'apple']],
    ['Show me the apple on the screen', ['apple']],
  ])('%s', (said, expected) => {
    const intent = ruleIntent(said, EMPTY);
    expect(intent?.kind, said).toBe('lookup');
    expect(names(intent), said).toEqual(expected);
  });

  it('accents and curly apostrophes are the recogniser’s spelling, not a different food', () => {
    expect(names(ruleIntent('What’s in a crème brûlée?', EMPTY))).toEqual(['creme brulee']);
    expect(names(ruleIntent('How many calories are in a jalapeño?', EMPTY))).toEqual(['jalapeno']);
  });

  it('one dish with "and" in it stays one dish', () => {
    expect(names(ruleIntent("What's in rice and beans?", EMPTY))).toEqual(['rice and beans']);
    expect(names(ruleIntent("What's in mac and cheese?", EMPTY))).toEqual(['mac and cheese']);
  });

  it('a quantity the user states is kept, and a default portion is not a statement', () => {
    expect(foods(ruleIntent('How much protein is in 200 g of chicken breast?', EMPTY))).toEqual([{ name: 'chicken breast', quantity: '200 g' }]);
    expect(foods(ruleIntent("What's in two bananas?", EMPTY))).toEqual([{ name: 'bananas', quantity: 'two' }]);
    expect(foods(ruleIntent("What's in a cup of rice?", EMPTY))).toEqual([{ name: 'rice', quantity: 'a cup' }]);
    expect(foods(ruleIntent("What's in a large banana?", EMPTY))).toEqual([{ name: 'banana', quantity: 'large' }]);
    expect(foods(ruleIntent("What's in a banana?", EMPTY))).toEqual([{ name: 'banana', quantity: '' }]);
  });
});

describe('a question about what is already on screen is the avatar’s, not the app’s', () => {
  it.each([
    'How much sugar does it have?',
    "What's in it?",
    'Which one has more protein?',
    'What about sodium?',
    'Is it healthy?',
    "What's the score?",
    'What can I make with it?',
    "What's the next step?",
    'Thanks!',
    'ok',
    'Yeah, sounds good.',
    'Hello there',
    'I have diabetes. Should I eat this every day?',
    'Compare them',
    'Show me both',
    // The banana is the card: a question about it, with the numbers already on the board.
    'Is a banana safe for me to eat every day? I have diabetes.',
    "What's in a banana?",
  ])('%s', (said) => {
    expect(ruleIntent(said, BANANA)).toEqual({ kind: 'none' });
  });
});

describe('comparing', () => {
  it.each([
    ['Compare it with an apple.', ['apple']],
    ['compare that to a pear', ['pear']],
    ['How does it compare to an orange?', ['orange']],
    ['Compare a banana and an apple', ['banana', 'apple']],
    ['Banana versus apple', ['banana', 'apple']],
    ['Which is healthier, a banana or an apple?', ['banana', 'apple']],
    ['Which has more protein, eggs or Greek yogurt?', ['eggs', 'greek yogurt']],
    ['Put an apple next to it', ['apple']],
    // The original's worst moment: "the apple is now displayed alongside the banana", with no apple anywhere.
    ['Can you show the apple on the panel too?', ['apple']],
  ])('%s', (said, expected) => {
    const intent = ruleIntent(said, BANANA);
    expect(intent?.kind, said).toBe('compare');
    expect(names(intent), said).toEqual(expected);
  });
});

describe('recipes', () => {
  it('"walk me through it" is the idea the avatar just offered', () => {
    const ctx = { ...BANANA, lastAvatarLine: 'You could whip up some peanut butter banana toast, or pancakes. Want me to walk you through it?' };
    expect(ruleIntent('Sure, walk me through it.', ctx)).toEqual({ kind: 'recipe', name: 'Banana oat pancakes', description: 'Mash with oats and egg.' });
    const toast = { ...BANANA, lastAvatarLine: 'Peanut butter banana toast is a quick one.' };
    expect(ruleIntent('How do I make it?', toast)).toMatchObject({ kind: 'recipe', name: 'Peanut butter banana toast' });
  });

  it('with nothing offered, it is the card’s first idea', () => {
    expect(ruleIntent('Walk me through it step by step', BANANA)).toMatchObject({ kind: 'recipe', name: 'Banana oat smoothie' });
  });

  it('by order, by name, or by a paraphrase of the name', () => {
    expect(ruleIntent('Walk me through the second one', BANANA)).toMatchObject({ name: 'Peanut butter banana toast' });
    expect(ruleIntent('Let’s make the last one', BANANA)).toMatchObject({ name: 'Banana oat pancakes' });
    expect(ruleIntent('How do I make the smoothie?', BANANA)).toMatchObject({ kind: 'recipe', name: 'Banana oat smoothie', description: 'Blend it with oats.' });
    expect(ruleIntent("What's the recipe for banana bread?", BANANA)).toMatchObject({ kind: 'recipe', name: 'Banana bread', description: '' });
  });

  it('a recipe already open is walked through from the board, not opened again', () => {
    const open = { ...BANANA, openRecipe: 'Banana oat smoothie' };
    expect(ruleIntent('Walk me through it', open)).toEqual({ kind: 'none' });
    expect(ruleIntent('Talk me through the smoothie', open)).toEqual({ kind: 'none' });
  });

  it('a recipe idea that is not there is nothing, and "make it healthier" is for the model', () => {
    expect(ruleIntent('Walk me through the third one', { ...BANANA, ideas: BANANA.ideas.slice(0, 1) })).toEqual({ kind: 'none' });
    expect(ruleIntent('Walk me through it', EMPTY)).toEqual({ kind: 'none' });
    expect(ruleIntent('How do I make it healthier?', BANANA)).toBeNull();
  });
});

describe('the other commands', () => {
  it('back to the card, only while a recipe is open', () => {
    const open = { ...BANANA, openRecipe: 'Banana oat smoothie' };
    for (const said of ['Go back', 'back to the card please', 'Close the recipe', 'Show me the card again'])
      expect(ruleIntent(said, open), said).toEqual({ kind: 'back' });
    expect(ruleIntent('Go back', BANANA)).not.toEqual({ kind: 'back' });
  });

  it('the sample', () => {
    expect(ruleIntent('Try the sample', EMPTY)).toEqual({ kind: 'sample' });
    expect(ruleIntent('Can you show me a sample?', EMPTY)).toEqual({ kind: 'sample' });
  });

  it('what the rules cannot tell goes to the model', () => {
    expect(ruleIntent("I'm eating a Big Mac right now", EMPTY)).toBeNull();
    expect(ruleIntent('Avocado toast', EMPTY)).toBeNull();
  });
});

describe('without a model', () => {
  it('a typed line that is only a food is a lookup', () => {
    expect(bareFood('Greek yogurt')).toEqual({ kind: 'lookup', foods: [{ name: 'greek yogurt', quantity: '' }] });
    expect(bareFood('avocado toast')).toMatchObject({ kind: 'lookup' });
  });

  it('anything else is not', () => {
    for (const said of ['thanks', 'tell me more', 'what do you think', 'I want to lose weight fast please', 'it'])
      expect(bareFood(said), said).toBeNull();
  });
});

describe('the model’s answer, checked', () => {
  it('a lookup of the food already on the card is a question for the avatar', () => {
    expect(intentFrom({ kind: 'lookup', foods: [{ name: 'banana', quantity: '' }], recipe: '' }, BANANA)).toEqual({ kind: 'none' });
    expect(intentFrom({ kind: 'lookup', foods: [{ name: 'banana', quantity: 'two' }], recipe: '' }, BANANA)).toMatchObject({ kind: 'lookup' });
  });

  it('names foods, never a pointer at the card', () => {
    expect(intentFrom({ kind: 'compare', foods: [{ name: 'it', quantity: '' }, { name: 'an apple', quantity: '' }], recipe: '' }, BANANA))
      .toEqual({ kind: 'compare', foods: [{ name: 'apple', quantity: '' }] });
    expect(intentFrom({ kind: 'lookup', foods: [{ name: 'Big Mac', quantity: 'two' }], recipe: '' }, EMPTY))
      .toEqual({ kind: 'lookup', foods: [{ name: 'big mac', quantity: 'two' }] });
    expect(intentFrom({ kind: 'lookup', foods: [], recipe: '' }, EMPTY)).toEqual({ kind: 'none' });
  });

  it('opens a listed recipe under its listed name, and nothing it cannot', () => {
    expect(intentFrom({ kind: 'recipe', foods: [], recipe: 'banana oat smoothie' }, BANANA)).toMatchObject({ kind: 'recipe', name: 'Banana oat smoothie' });
    expect(intentFrom({ kind: 'back', foods: [], recipe: '' }, BANANA)).toEqual({ kind: 'none' });
    expect(intentFrom({ kind: 'dance' }, BANANA)).toEqual({ kind: 'none' });
    expect(intentFrom('nonsense', BANANA)).toEqual({ kind: 'none' });
  });

  it('is asked with the screen and the avatar’s last line in front of it', () => {
    const prompt = judgePrompt('the second one', { ...BANANA, lastAvatarLine: 'Want the toast?' });
    expect(prompt).toContain('"Medium banana"');
    expect(prompt).toContain('"Peanut butter banana toast"');
    expect(prompt).toContain('Want the toast?');
  });
});

describe('a food, as the user named it', () => {
  it('drops the words that are not the food', () => {
    expect(parseFood('the apple too please')).toEqual({ name: 'apple', quantity: '' });
    expect(parseFood('an apple on the screen')).toEqual({ name: 'apple', quantity: '' });
    expect(parseFood('half an avocado')).toEqual({ name: 'avocado', quantity: 'half an' });
    expect(parseFood('200g chicken breast')).toEqual({ name: 'chicken breast', quantity: '200g' });
  });

  it('a pointer or a nutrient is not a food', () => {
    for (const said of ['it', 'that one', 'sodium', 'the score', 'both', 'the recipe']) expect(parseFood(said), said).toBeNull();
  });
});
