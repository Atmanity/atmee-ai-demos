import { describe, expect, it } from 'vitest';

import { bestInColumn, SHELF_COLUMNS } from './ComparisonShelf.tsx';
import { EMPTY_SHELF, parseShelf, type ShelfRow } from '../engine/shelf.ts';

/**
 * The symptom: Rachel said "I've displayed the nutrition info for both a
 * medium apple and a medium banana side by side" and the panel showed only the
 * banana, because there was one slot for one product.
 *
 * The shelf is the only payload in this panel that is coerced rather than cast
 * — it drives a table, and a row whose calories arrived as a string renders as
 * NaN in a column the user is reading for an answer.
 */

function row(over: Partial<ShelfRow> = {}): ShelfRow {
  return {
    product_name: 'banana',
    serving_size: '1 medium',
    calories: 105,
    protein_g: 1.3,
    carbs_g: 27,
    fat_g: 0.3,
    fiber_g: 3.1,
    sugar_g: 14,
    sodium_mg: 1,
    health_score: 9,
    ...over,
  };
}

describe('parseShelf', () => {
  it('reads the table', () => {
    const shelf = parseShelf({
      current: 'medium apple',
      items: [row(), row({ product_name: 'medium apple', calories: 95 })],
      recipes: [{ recipe_name: 'Banana smoothie' }],
    });
    expect(shelf.items).toHaveLength(2);
    expect(shelf.current).toBe('medium apple');
    expect(shelf.recipes).toEqual([{ recipe_name: 'Banana smoothie' }]);
  });

  it('gives an empty shelf rather than throwing on nonsense', () => {
    expect(parseShelf(null)).toEqual(EMPTY_SHELF);
    expect(parseShelf('nope')).toEqual(EMPTY_SHELF);
    expect(parseShelf({})).toEqual(EMPTY_SHELF);
  });

  it('drops a row with no name instead of rendering a blank line', () => {
    expect(parseShelf({ items: [{ product_name: '   ', calories: 10 }] }).items).toEqual([]);
  });

  it('turns a number that is not a number into zero, not NaN', () => {
    // A NaN reaches the table as "NaNcal" in a column the user is reading to
    // decide something.
    const [parsed] = parseShelf({
      items: [{ product_name: 'apple', calories: 'ninety', sugar_g: null }],
    }).items;
    expect(parsed.calories).toBe(0);
    expect(parsed.sugar_g).toBe(0);
  });

  it('does not claim a salted cracker has no salt when the row predates the column', () => {
    // Sodium is new to the shelf, so a row minted before it existed carries no
    // sodium at all. Coercing that to 0 like every other field would print
    // "0mg" — a figure the agent never sent, in the column that decides most
    // packaged foods. It stays absent and the table draws a dash.
    const [old] = parseShelf({ items: [{ product_name: 'crackers', calories: 120 }] }).items;
    expect(old.sodium_mg).toBeNull();

    const [fresh] = parseShelf({
      items: [{ product_name: 'crackers', calories: 120, sodium_mg: 230 }],
    }).items;
    expect(fresh.sodium_mg).toBe(230);
  });

  it('ignores a nameless recipe chip', () => {
    expect(parseShelf({ recipes: [{ recipe_name: '' }, 'nope'] }).recipes).toEqual([]);
  });
});

const column = (key: string) => {
  const found = SHELF_COLUMNS.find((c) => c.key === key);
  if (!found) throw new Error(`no ${key} column in the shelf`);
  return found;
};

describe('the columns the table shows', () => {
  it('shows sodium, which the card showed and the table dropped', () => {
    // Same defect as the missing fat column, one nutrient over: a comparison
    // that drops a nutrient cannot compare the foods that nutrient defines.
    expect(SHELF_COLUMNS.map((c) => c.key)).toContain('sodium_mg');
  });
});

describe('bestInColumn', () => {
  const SCORE = column('health_score');

  it('does not call the lowest-calorie food the best one', () => {
    // Low is not better — not for the gym-goer counting protein, not for
    // anyone eating to gain, not for butter versus a rice cake. The brief
    // calls "best" colouring a verdict that has to be earned, and a raw
    // nutrient column has not earned one. It used to paint calories, carbs,
    // fat and sugar green.
    const rows = [row({ calories: 105 }), row({ product_name: 'apple', calories: 95 })];
    expect(bestInColumn(rows, column('calories')).size).toBe(0);
    expect(bestInColumn(rows, column('carbs_g')).size).toBe(0);
    expect(bestInColumn(rows, column('protein_g')).size).toBe(0);
    expect(bestInColumn(rows, column('sodium_mg')).size).toBe(0);
  });

  it('still marks the higher score, which is already a ranking', () => {
    const rows = [row({ health_score: 9 }), row({ product_name: 'cake', health_score: 3 })];
    expect([...bestInColumn(rows, SCORE)]).toEqual([0]);
  });

  it('marks every row in a tie rather than crowning one of them', () => {
    // Crowning one of two identical values reads as a difference that is not
    // there — worse than crowning neither.
    const rows = [
      row({ health_score: 9 }),
      row({ product_name: 'apple', health_score: 9 }),
      row({ product_name: 'cake', health_score: 3 }),
    ];
    expect([...bestInColumn(rows, SCORE)].sort()).toEqual([0, 1]);
  });

  it('marks nothing when every row agrees', () => {
    const rows = [row({ health_score: 8 }), row({ product_name: 'apple', health_score: 8 })];
    expect(bestInColumn(rows, SCORE).size).toBe(0);
  });

  it('marks nothing with one food, because one food is not a comparison', () => {
    expect(bestInColumn([row()], SCORE).size).toBe(0);
  });
});
