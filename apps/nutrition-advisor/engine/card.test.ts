// Ported from test_parity.py: the rules the original's tool body applied to
// what its model sent, now applied to the app's own model calls.
import { describe, expect, it } from 'vitest';
import { CARD_SCHEMA, cardFrom, cardPrompt, clampScore, lines, PHOTO_PROMPT, PHOTO_SCHEMA, recipeFrom, recipePrompt, sourceOf } from './card.ts';
import { builtInCard, SAMPLE_CARD } from './fallback.ts';

const yogurt = {
  product_name: 'Greek Yogurt',
  serving_size: '170g',
  calories: 100,
  protein_g: 17,
  carbs_g: 6,
  fat_g: 0.7,
  fiber_g: 0,
  sugar_g: 4,
  sodium_mg: 61,
  health_score: 9,
  health_summary: 'High protein, low sugar.',
  recipes: [{ name: 'Berry parfait', description: 'Layer with fruit and granola.' }],
};

describe('the card keeps the original shape', () => {
  it('as the ported panel reads it', () => {
    // The panel was ported verbatim, so it reads exactly these keys. A renamed
    // field renders an empty card with no error anywhere.
    const card = cardFrom(yogurt, { source: 'estimate', portionAssumed: true })!;
    expect(card.product_name).toBe('Greek Yogurt');
    expect(Object.keys(card.nutrients).sort()).toEqual(['carbs_g', 'fat_g', 'fiber_g', 'protein_g', 'sodium_mg', 'sugar_g']);
    expect(card.recipes).toEqual([{ name: 'Berry parfait', description: 'Layer with fruit and granola.' }]);
  });

  it('asks the model for every field the card shows', () => {
    for (const field of ['product_name', 'serving_size', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'health_score', 'health_summary', 'recipes'])
      expect(CARD_SCHEMA.required, field).toContain(field);
    expect(PHOTO_SCHEMA.required).toEqual(expect.arrayContaining(['is_food', 'source', 'portion_assumed', ...CARD_SCHEMA.required]));
  });

  it('a payload with no food in it is no card', () => {
    expect(cardFrom(null, { source: 'label', portionAssumed: false })).toBeNull();
    expect(cardFrom({ ...yogurt, product_name: '  ' }, { source: 'label', portionAssumed: false })).toBeNull();
  });
});

describe('a number says where it came from and whether the portion is a guess', () => {
  it('carries the claims it was given', () => {
    const card = cardFrom(yogurt, { source: 'label', portionAssumed: false })!;
    expect(card.source).toBe('label');
    expect(card.portion_assumed).toBe(false);
  });

  it.each([['', 'estimate'], ['guess', 'estimate'], ['Label ', 'label'], ['photo', 'estimate'], [null, 'estimate'], [undefined, 'estimate']])(
    'anything that is not a label reading is an estimate (%j)',
    (given, expected) => {
      // The default has to be the humbler claim: an app that renders a guess
      // as a label reading is worse than one that never marked them at all.
      expect(sourceOf(given)).toBe(expected);
    },
  );

  it('an assumed portion is only ever claimed when it is true', () => {
    expect(cardFrom(yogurt, { source: 'estimate', portionAssumed: 'yes' })!.portion_assumed).toBe(false);
    expect(cardFrom(yogurt, { source: 'estimate', portionAssumed: true })!.portion_assumed).toBe(true);
  });

  it('a food the user only named asks for one typical serving, and a stated quantity for exactly that', () => {
    expect(cardPrompt({ name: 'banana', quantity: '' })).toMatch(/did not say how much/);
    expect(cardPrompt({ name: 'chicken breast', quantity: '200 g' })).toMatch(/exactly that quantity/);
  });

  it('a photo is read as a label only when one is legible', () => {
    expect(PHOTO_PROMPT).toMatch(/source "label"/);
    expect(PHOTO_PROMPT).toMatch(/legible/);
    expect(PHOTO_PROMPT).toMatch(/source "estimate", portion_assumed true/);
  });
});

describe('what the model sends, made safe to show', () => {
  it.each([[0, 1], [-3, 1], [5, 5], [11, 10], [99, 10], [7.6, 8], ['nine', 5], [undefined, 5]])('the score is clamped (%j)', (given, expected) => {
    // It drives a gauge; an out-of-range score renders off the end of it.
    expect(clampScore(given)).toBe(expected);
  });

  it('empty recipe slots are dropped, not sent blank, and there are never more than three', () => {
    const card = cardFrom({ ...yogurt, recipes: [{ name: 'Only one', description: 'd' }, { name: '', description: 'x' }, { name: 'a' }, { name: 'b' }, { name: 'c' }] }, { source: 'estimate', portionAssumed: true })!;
    expect(card.recipes.map((r) => r.name)).toEqual(['Only one', 'a', 'b']);
  });

  it('a figure that is not a number is zero, never NaN or negative', () => {
    const card = cardFrom({ ...yogurt, calories: 'lots', protein_g: -4, fat_g: 0.6666 }, { source: 'estimate', portionAssumed: true })!;
    expect(card.calories).toBe(0);
    expect(card.nutrients.protein_g).toBe(0);
    expect(card.nutrients.fat_g).toBe(0.7);
  });
});

describe('steps and ingredients', () => {
  it('a plain string is split, not spelled out one letter per step', () => {
    expect(lines('banana, yogurt')).toEqual(['banana', 'yogurt']);
    expect(lines('blend')).toEqual(['blend']);
    expect(lines(42)).toEqual([]);
  });

  it('markdown never reaches the card or the voice', () => {
    // "1. **Peel the banana**" was printed with its asterisks and read aloud.
    expect(lines(['1. **Peel the banana**', '- Slice it', 'Step 3: Blend', '2-3 tbsp honey', '1.5 cups milk'])).toEqual([
      'Peel the banana', 'Slice it', 'Blend', '2-3 tbsp honey', '1.5 cups milk',
    ]);
  });

  it('a recipe is titled with the name the user chose, never the model’s paraphrase', () => {
    // The spinner bug: a tap on "Berry parfait" came back as "Berry Parfait
    // Bowl", a title the panel did not match, and the card spun forever.
    const made = recipeFrom({ recipe_name: 'Berry Parfait Bowl', ingredients: ['yogurt'], preparation_steps: ['layer'] }, 'Berry parfait', 'Layered.')!;
    expect(made.recipe_name).toBe('Berry parfait');
    expect(made.description).toBe('Layered.');
  });

  it('a recipe with nothing in it is no recipe', () => {
    expect(recipeFrom({ ingredients: [], preparation_steps: '' }, 'Berry parfait')).toBeNull();
    expect(recipeFrom(null, 'Berry parfait')).toBeNull();
  });

  it('asks for amounts, steps that can be said aloud, and no markdown', () => {
    const prompt = recipePrompt({ name: 'Berry parfait', description: 'Layered.' }, 'Greek yogurt');
    expect(prompt).toContain('"Berry parfait"');
    expect(prompt).toMatch(/said aloud/);
    expect(prompt).toMatch(/No numbering, bullets, asterisks or markdown/);
  });
});

describe('the cards the app knows without a model', () => {
  it('answer the common first questions, as estimates for an assumed portion', () => {
    const banana = builtInCard('banana')!;
    expect(banana.product_name).toBe('Medium banana');
    expect(banana.source).toBe('estimate');
    expect(banana.portion_assumed).toBe(true);
    expect(builtInCard('eggs')?.product_name).toBe('Large egg');
    expect(builtInCard('banana bread')).toBeNull();
  });

  it('are copies, so a card shown and changed never changes the next one', () => {
    builtInCard('apple')!.nutrients.sugar_g = 0;
    expect(builtInCard('apple')!.nutrients.sugar_g).toBe(19);
  });

  it('include the sample photo’s plate, which has no label to read', () => {
    expect(SAMPLE_CARD.source).toBe('estimate');
    expect(SAMPLE_CARD.recipes).toHaveLength(3);
  });
});
