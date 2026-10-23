import { describe, expect, it } from 'vitest';
import { hasNotes, notesFile, notesText } from './notes.ts';
import type { RecipeDetails, ShelfRow } from './types.ts';

const row = (name: string, over: Partial<ShelfRow> = {}): ShelfRow => ({
  product_name: name, serving_size: '1 medium (118 g)', calories: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4, fiber_g: 3.1, sugar_g: 14.4, sodium_mg: 1, health_score: 9, ...over,
});
const smoothie: RecipeDetails = { recipe_name: 'Banana oat smoothie', description: 'Blend it with oats.', ingredients: ['1 banana', '40 g oats'], preparation_steps: ['Peel the banana.', 'Blend everything.'] };
const day = new Date('2026-10-23T12:00:00Z');

describe('the notes a user takes home', () => {
  it('every food with every figure the table shows, and every recipe in full', () => {
    const text = notesText([row('Medium banana'), row('Medium apple', { calories: 95, sodium_mg: null })], [smoothie], 'Rachel', day);
    expect(text).toContain('Morsel: your notes from 23 October 2026');
    expect(text).toContain('Talked through with Rachel');
    expect(text).toContain('Not medical advice');
    expect(text).toContain('FOODS (2)');
    expect(text).toContain('Medium banana, 1 medium (118 g)');
    expect(text).toContain('105 cal · protein 1.3 g · carbs 27 g · fat 0.4 g · fiber 3.1 g · sugar 14.4 g · sodium 1 mg · score 9/10');
    expect(text).toContain('sodium not recorded');
    expect(text).toContain('RECIPES (1)');
    expect(text).toContain('  - 40 g oats');
    expect(text).toContain('  2. Blend everything.');
  });

  it('leaves out what there is none of, and knows when there is nothing', () => {
    expect(notesText([], [smoothie], 'Rachel', day)).not.toContain('FOODS');
    expect(notesText([row('Egg')], [], 'Rachel', day)).not.toContain('RECIPES');
    expect(hasNotes([], [])).toBe(false);
    expect(hasNotes([row('Egg')], [])).toBe(true);
  });

  it('is saved under a dated name', () => {
    expect(notesFile(day)).toBe('morsel-notes-2026-10-23.txt');
  });
});
