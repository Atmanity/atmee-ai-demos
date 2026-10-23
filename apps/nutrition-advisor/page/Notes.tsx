// The end of a call: what you looked at, to keep. Every food side by side and
// every recipe opened, with a download, and the way back to Rachel.
import { hasNotes, notesFile, notesText } from '../engine/notes.ts';
import type { RecipeDetails, Shelf } from '../engine/types.ts';
import { FoodTable } from './SideBySide.tsx';

/** Hands the notes to the browser as a text file. */
export function downloadNotes(shelf: Shelf, recipes: RecipeDetails[], host: string) {
  const now = new Date();
  const url = URL.createObjectURL(new Blob([notesText(shelf.items, recipes, host, now)], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: notesFile(now) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Notes({ shelf, recipes, host, failed, onAgain }: {
  shelf: Shelf;
  recipes: RecipeDetails[];
  host: string;
  /** The call never got going. */
  failed: boolean;
  onAgain: () => void;
}) {
  if (!hasNotes(shelf.items, recipes)) {
    return (
      <section className="ms-notes is-empty" aria-label="Call ended">
        <p className="ms-eyebrow">{failed ? 'Not connected' : 'Call ended'}</p>
        <h2>{failed ? `${host} couldn't join this time.` : `Thanks for stopping by.`}</h2>
        <p className="ms-lede">{failed ? 'It usually works on a second try.' : `${host} is here whenever you're wondering what's in something.`}</p>
        <button type="button" className="ms-primary is-big" onClick={onAgain}>Call {host} again</button>
      </section>
    );
  }
  const foods = shelf.items.length;
  return (
    <section className="ms-notes" aria-label="Your notes">
      <p className="ms-eyebrow">Call ended</p>
      <h2>Your notes from today</h2>
      <p className="ms-lede">
        {foods ? `${foods} food${foods === 1 ? '' : 's'}` : ''}{foods && recipes.length ? ' and ' : ''}
        {recipes.length ? `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}` : ''}, ready to keep.
      </p>
      <div className="ms-cta">
        <button type="button" className="ms-primary is-big" onClick={() => downloadNotes(shelf, recipes, host)}>Download your notes</button>
        <button type="button" className="ms-secondary is-big" onClick={onAgain}>Call {host} again</button>
      </div>
      {foods > 0 && (
        <div className="ms-notes-part">
          <h3 className="ms-kicker">Foods, per serving</h3>
          <FoodTable shelf={shelf} caption="Every food you asked about, per serving" />
        </div>
      )}
      {recipes.length > 0 && (
        <div className="ms-notes-part">
          <h3 className="ms-kicker">Recipes</h3>
          {recipes.map((r) => (
            <details key={r.recipe_name} className="ms-notes-recipe">
              <summary>{r.recipe_name}{r.description ? <span>{r.description}</span> : null}</summary>
              {r.ingredients.length > 0 && <ul>{r.ingredients.map((item, i) => <li key={i}>{item}</li>)}</ul>}
              {r.preparation_steps.length > 0 && <ol>{r.preparation_steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
            </details>
          ))}
        </div>
      )}
      <p className="ms-hint">Figures are estimates for the serving shown unless read from a label. Not medical advice.</p>
    </section>
  );
}
