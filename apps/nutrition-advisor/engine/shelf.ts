/**
 * The comparison shelf: its shape, and the only coercion in this panel.
 *
 * Ported unchanged from the mini-app panel. It lives in engine/ because both
 * halves read it: the server builds the shelf (advisor.ts) and the page
 * coerces what arrives (`parseShelf`) before the table renders it.
 */

/**
 * One food on the comparison shelf. A row, not a card: the server keeps eight
 * of these at most (in the original they shared one 32 KiB envelope with the
 * card itself; here they share the avatar's 3,858-character board).
 */
export interface ShelfRow {
  product_name: string;
  serving_size: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  /**
   * `null` when the payload did not carry it.
   *
   * Every other figure coerces a missing value to 0, which is right for them:
   * the agent has always sent them, so a missing one is a broken row, and 0 is
   * a truthful "nothing" in a column the user is scanning. Sodium is new to
   * the shelf, so a row minted before it existed has no sodium at all — and
   * rendering that as "0mg" would tell the user a salted cracker has no salt.
   * A dash says the column has nothing for this row, which is what is true.
   */
  sodium_mg: number | null;
  health_score: number;
  /**
   * The row's identity, the food at a portion (engine/advisor.ts `cardKey`):
   * two portions of one food can share a name and even a serving ("200 g" as
   * the usual card and as an amount stated), so the page keys and marks rows
   * by this, never by their words.
   */
  key?: string;
}

export interface Shelf {
  current: string;
  /** The identity of the card on screen (see `ShelfRow.key`): the one row marked as on the card. */
  current_key?: string;
  items: ShelfRow[];
  recipes: { recipe_name: string }[];
}

export const EMPTY_SHELF: Shelf = { current: '', items: [], recipes: [] };

/**
 * The shelf, coerced.
 *
 * Everything else in this panel trusts its payload — these shapes are the
 * agent's own and the demo they came from cast them straight through. The
 * shelf does not, because it drives a TABLE: a row whose calories arrived as a
 * string renders as `NaN%` in a bar, and a row with no name renders as a blank
 * line the user cannot explain. Bad rows are dropped, not repaired.
 */
export function parseShelf(value: unknown): Shelf {
  if (typeof value !== 'object' || value === null) return EMPTY_SHELF;
  const raw = value as Record<string, unknown>;
  const items: ShelfRow[] = [];
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.product_name === 'string' ? row.product_name.trim() : '';
      if (!name) continue;
      items.push({
        product_name: name,
        serving_size: typeof row.serving_size === 'string' ? row.serving_size : '',
        calories: num(row.calories),
        protein_g: num(row.protein_g),
        carbs_g: num(row.carbs_g),
        fat_g: num(row.fat_g),
        fiber_g: num(row.fiber_g),
        sugar_g: num(row.sugar_g),
        sodium_mg: numOrNull(row.sodium_mg),
        health_score: num(row.health_score),
        ...(typeof row.key === 'string' && row.key ? { key: row.key } : {}),
      });
    }
  }
  const recipes: { recipe_name: string }[] = [];
  if (Array.isArray(raw.recipes)) {
    for (const item of raw.recipes) {
      const name =
        typeof item === 'object' && item !== null
          ? (item as Record<string, unknown>).recipe_name
          : null;
      if (typeof name === 'string' && name.trim()) recipes.push({ recipe_name: name.trim() });
    }
  }
  return {
    current: typeof raw.current === 'string' ? raw.current : '',
    ...(typeof raw.current_key === 'string' && raw.current_key ? { current_key: raw.current_key } : {}),
    items,
    recipes,
  };
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `num`, but an absent or unreadable value stays absent instead of becoming 0. */
function numOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Whether a row is the card on screen: by identity when both carry one, else by name. */
export function isCurrent(shelf: Shelf, row: ShelfRow): boolean {
  if (shelf.current_key !== undefined && row.key !== undefined) return row.key === shelf.current_key;
  return row.product_name === shelf.current;
}

/** A row's React key: its identity, or its words for a row that carries none. */
export const rowKey = (row: ShelfRow) => row.key ?? `${row.product_name}\u0000${row.serving_size}`;
