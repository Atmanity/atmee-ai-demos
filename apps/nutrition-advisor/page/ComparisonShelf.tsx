import type { Shelf, ShelfRow } from '../engine/shelf.ts';

/**
 * Everything looked at this session, in one table.
 *
 * This is the answer to a question the app could not previously answer at all:
 * "how does that compare?". There was one slot for one product, so a user who
 * asked to see a banana and an apple together got Rachel *saying* both were on
 * screen side by side over a card showing one of them.
 *
 * Deliberately a table and not a row of cards. The whole point is reading DOWN
 * a column — which of these has more sugar — and cards make that a memory
 * test.
 */

/** The id the "Compared so far" link scrolls to. */
export const SHELF_ANCHOR_ID = 'comparison-shelf';

type NumericKey = Exclude<keyof ShelfRow, 'product_name' | 'serving_size'>;

interface Column {
  key: NumericKey;
  label: string;
  unit: string;
  /**
   * Which end of the column is the good end — set ONLY where the app is
   * willing to defend the verdict.
   *
   * Calories and carbs used to carry `best: 'low'`, which painted the
   * lowest-calorie food green in a table whose whole job is comparison. Low is
   * not better: not for the gym-goer counting protein, not for anyone eating
   * to gain, not for butter versus a rice cake. The brief calls "best"
   * colouring a verdict that must be earned, and a nutrient column has not
   * earned one. The score column has: it is already a ranking, and saying
   * which of two rankings is higher adds no claim the number did not make.
   */
  best?: 'high' | 'low';
}

const COLUMNS: Column[] = [
  { key: 'calories', label: 'Calories', unit: 'cal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  // Fat was missing, and a comparison that drops a nutrient cannot compare the
  // foods that nutrient defines: 113 g of butter rendered as 0 g carbs and
  // 0 g sugar — both coloured green as the "best" in their column — with its
  // 91 g of fat nowhere in the table.
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
  // Same defect as fat, one nutrient over: the card shows sodium and the table
  // did not, so a comparison of two packaged foods silently dropped the figure
  // that decides most of them.
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'health_score', label: 'Score', unit: '/10', best: 'high' },
];

export { COLUMNS as SHELF_COLUMNS };
export type { Column as ShelfColumn };

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Which rows hold the best value in a column, as a set of indices.
 *
 * A set rather than one index because ties are common with round numbers, and
 * crowning one of two identical values is worse than crowning neither — the
 * user reads it as a difference that is not there. A column where every row
 * agrees is not a comparison at all, so it is left unmarked. A column with no
 * `best` is not marked at all: see the note on `Column.best`.
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

export function ComparisonShelf({ shelf }: { shelf: Shelf }) {
  // One food is not a comparison — the table would just restate the card
  // directly above it.
  if (shelf.items.length < 2) return null;

  return (
    <div className="shelf" id={SHELF_ANCHOR_ID}>
      <h3 className="shelf-heading">Compared so far</h3>
      {/* Its own scroller, bled out to the panel edge so rows can be dragged
          across the full width while the heading and note keep the card's
          gutter. The gradient on the scroller appears only when there is more
          table off-screen — a horizontal scrollbar is invisible on a trackpad,
          and a column the user never learns is there is a column that was not
          shown. */}
      <div className="shelf-scroll">
        <table className="shelf-table">
          <thead>
            <tr>
              <th scope="col" className="shelf-col-food">
                Food
              </th>
              {COLUMNS.map((column) => (
                <th scope="col" key={String(column.key)}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shelf.items.map((row, index) => (
              <tr
                key={row.product_name}
                className={
                  row.product_name === shelf.current ? 'shelf-row shelf-row--current' : 'shelf-row'
                }
              >
                {/* Sticky: scrolled two columns right, every row was a
                    stranded set of numbers with no food attached to it. */}
                <th scope="row" className="shelf-col-food">
                  <span className="shelf-name">{row.product_name}</span>
                  {row.serving_size && (
                    <span className="shelf-serving">{row.serving_size}</span>
                  )}
                </th>
                {COLUMNS.map((column) => {
                  const value = row[column.key];
                  return (
                    <td
                      key={String(column.key)}
                      className={
                        bestInColumn(shelf.items, column).has(index)
                          ? 'shelf-value shelf-value--best'
                          : 'shelf-value'
                      }
                    >
                      {typeof value === 'number' ? (
                        <>
                          {format(value)}
                          <span className="shelf-unit">{column.unit}</span>
                        </>
                      ) : (
                        <span className="shelf-missing" title="not recorded for this food">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="shelf-note">
        Every food you ask about stays here. Ask out loud to compare any two.
      </p>
    </div>
  );
}

/** Recipes opened this session, still reachable after the product moved on. */
export function KeptRecipes({
  shelf,
  onOpen,
}: {
  shelf: Shelf;
  onOpen: (name: string) => void;
}) {
  if (shelf.recipes.length === 0) return null;
  return (
    <div className="kept">
      <h3 className="shelf-heading">Recipes you opened</h3>
      <div className="kept-list">
        {shelf.recipes.map((recipe) => (
          <button
            key={recipe.recipe_name}
            type="button"
            className="kept-chip"
            onClick={() => onOpen(recipe.recipe_name)}
          >
            {recipe.recipe_name}
          </button>
        ))}
      </div>
    </div>
  );
}
