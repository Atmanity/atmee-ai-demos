// The notes a user takes home: every food looked at, side by side, and every
// recipe opened, with its ingredients and steps. Plain text, so it opens
// anywhere and prints cleanly. Built from what was on screen, never more.
import type { RecipeDetails, ShelfRow } from './types.ts';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function rowLine(row: ShelfRow): string {
  const sodium = row.sodium_mg === null ? 'sodium not recorded' : `sodium ${fmt(row.sodium_mg)} mg`;
  return `${fmt(row.calories)} cal · protein ${fmt(row.protein_g)} g · carbs ${fmt(row.carbs_g)} g · fat ${fmt(row.fat_g)} g · fiber ${fmt(row.fiber_g)} g · sugar ${fmt(row.sugar_g)} g · ${sodium} · score ${fmt(row.health_score)}/10`;
}

/** Whether there is anything worth taking home. */
export const hasNotes = (rows: ShelfRow[], recipes: RecipeDetails[]) => rows.length > 0 || recipes.length > 0;

export function notesText(rows: ShelfRow[], recipes: RecipeDetails[], host: string, on: Date): string {
  const day = on.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const out = [`Morsel: your notes from ${day}`, `Talked through with ${host}. Figures are estimates for the serving shown unless they were read from a label. Not medical advice.`];
  if (rows.length) {
    out.push('', `FOODS (${rows.length})`);
    for (const row of rows) out.push('', `${row.product_name}${row.serving_size ? `, ${row.serving_size}` : ''}`, `  ${rowLine(row)}`);
  }
  if (recipes.length) {
    out.push('', `RECIPES (${recipes.length})`);
    for (const r of recipes) {
      out.push('', r.recipe_name);
      if (r.description) out.push(`  ${r.description}`);
      if (r.ingredients.length) out.push('  Ingredients:', ...r.ingredients.map((i) => `  - ${i}`));
      if (r.preparation_steps.length) out.push('  Steps:', ...r.preparation_steps.map((s, i) => `  ${i + 1}. ${s}`));
    }
  }
  return `${out.join('\n')}\n`;
}

/** A file name for the notes: morsel-notes-2026-10-23.txt. */
export const notesFile = (on: Date) => `morsel-notes-${on.toISOString().slice(0, 10)}.txt`;
