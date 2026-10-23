// Every food looked at, in one table, and the recipes opened along the way.
//
// A table, not a row of cards: the point is reading DOWN a column (which of
// these has more sugar?), and cards make that a memory test. Ported from the
// mini-app panel's ComparisonShelf, whose column rules were learned the hard
// way: every nutrient the card shows is a column (a table without fat cannot
// compare butter), the food's name stays put while the numbers scroll, and
// only the score column is ever marked "best".
import { useState } from 'react';
import { isCurrent, rowKey, type Shelf, type ShelfRow } from '../engine/shelf.ts';

/** The id "See them side by side" scrolls to. */
export const TABLE_ANCHOR_ID = 'side-by-side';

type NumericKey = Exclude<keyof ShelfRow, 'product_name' | 'serving_size'>;

interface Column {
  key: NumericKey;
  label: string;
  unit: string;
  /**
   * Which end of the column is the good end, set ONLY where the app will
   * defend the verdict. Low calories are not better (not for the gym-goer
   * counting protein, not for butter versus a rice cake), so nutrient columns
   * carry none. The score is already a ranking; marking the higher one adds
   * no claim the number did not make.
   */
  best?: 'high' | 'low';
}

const COLUMNS: Column[] = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'health_score', label: 'Score', unit: '/10', best: 'high' },
];

export { COLUMNS as SHELF_COLUMNS };
export type { Column as ShelfColumn };

const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * Which rows hold the best value in a column. A set, because ties are common
 * with round numbers and crowning one of two equal values reads as a
 * difference that is not there; a column where every row agrees is no
 * comparison and stays unmarked, and a column with no `best` is never marked.
 */
export function bestInColumn(rows: ShelfRow[], column: Column): Set<number> {
  if (!column.best) return new Set();
  if (rows.length < 2) return new Set();
  const values = rows.map((row) => row[column.key]);
  if (values.some((v) => typeof v !== 'number')) return new Set();
  const numbers = values as number[];
  const target = column.best === 'high' ? Math.max(...numbers) : Math.min(...numbers);
  if (numbers.every((v) => v === target)) return new Set();
  const winners = new Set<number>();
  numbers.forEach((v, i) => {
    if (v === target) winners.add(i);
  });
  return winners;
}

export function FoodTable({ shelf, caption }: { shelf: Shelf; caption: string }) {
  return (
    <div className="ms-table-scroll" tabIndex={0} aria-label={caption}>
      <table className="ms-table">
        <caption className="ms-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="ms-col-food">Food</th>
            {COLUMNS.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shelf.items.map((row, index) => (
            <tr key={rowKey(row)} className={isCurrent(shelf, row) ? 'is-current' : undefined}>
              <th scope="row" className="ms-col-food">
                <span className="ms-table-name">{row.product_name}</span>
                {row.serving_size && <span className="ms-table-serving">{row.serving_size}</span>}
              </th>
              {COLUMNS.map((column) => {
                const value = row[column.key];
                return (
                  <td key={column.key} className={bestInColumn(shelf.items, column).has(index) ? 'is-best' : undefined}>
                    {typeof value === 'number'
                      ? <>{format(value)}<span className="ms-unit">{column.unit}</span></>
                      : <span className="ms-missing" title="not recorded for this food">–</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The comparison under the card: from two foods, since one is just the card again. */
export function SideBySide({ shelf, onClear, disabled }: { shelf: Shelf; onClear: () => void; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  if (shelf.items.length < 2) return null;
  return (
    <section className="ms-compare" id={TABLE_ANCHOR_ID} aria-label="Side by side">
      <header className="ms-section-head">
        <h3 className="ms-kicker">Side by side · {shelf.items.length} foods</h3>
        {confirming ? (
          <span className="ms-confirm">
            Clear every food and recipe?
            <button type="button" className="ms-link is-danger" onClick={() => { setConfirming(false); onClear(); }} disabled={disabled}>Clear</button>
            <button type="button" className="ms-link" onClick={() => setConfirming(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className="ms-link" onClick={() => setConfirming(true)} disabled={disabled}>Start over</button>
        )}
      </header>
      <FoodTable shelf={shelf} caption="Every food you asked about, side by side, per serving" />
      <p className="ms-hint">Every food you ask about stays here. Ask: <q>Which of these has the most fiber?</q></p>
    </section>
  );
}

/** Recipes opened this visit, still a tap away after the card has moved on. */
export function OpenedRecipes({ shelf, onOpen, disabled }: { shelf: Shelf; onOpen: (name: string) => void; disabled: boolean }) {
  if (shelf.recipes.length === 0) return null;
  return (
    <section className="ms-opened" aria-label="Recipes you opened">
      <h3 className="ms-kicker">Recipes you opened</h3>
      <div className="ms-opened-list">
        {shelf.recipes.map((recipe) => (
          <button key={recipe.recipe_name} type="button" className="ms-tag" onClick={() => onOpen(recipe.recipe_name)} disabled={disabled}>
            {recipe.recipe_name}
          </button>
        ))}
      </div>
    </section>
  );
}
