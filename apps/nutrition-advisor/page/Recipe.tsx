// A recipe, opened: what goes in it (ticked off as you gather it) and the
// method, with the steps Rachel is talking through lit up like a highlighter
// on the page. "Next steps" moves on; tapping a step says "I'm here".
import { useState } from 'react';
import { stepsLabel, type Cook } from '../engine/cook.ts';
import type { RecipeDetails } from '../engine/types.ts';
import { recipeDescription, type Chosen } from './recipeView.ts';

export function Recipe({ chosen, details, loading, cook, food, host, live, onBack, onNext, onPick, onRetry }: {
  chosen: Chosen;
  details: RecipeDetails | null;
  loading: boolean;
  cook: Cook;
  /** The food whose card suggested it. */
  food: string;
  host: string;
  live: boolean;
  onBack: () => void;
  onNext: () => void;
  onPick: (step: number) => void;
  onRetry: () => void;
}) {
  const description = recipeDescription(chosen, details);
  const steps = details?.preparation_steps ?? [];
  const lit = cook.shown;
  const finished = steps.length > 0 && cook.at >= steps.length;
  return (
    <article className="ms-recipe" aria-label={`Recipe: ${chosen.name}`}>
      <div className="ms-recipe-top">
        <button type="button" className="ms-back" onClick={onBack}><span aria-hidden="true">←</span> Back to the card</button>
        {food && <span className="ms-recipe-for">A recipe idea for {food}</span>}
      </div>
      <h2 className="ms-recipe-name">{chosen.name}</h2>
      {description && <p className="ms-recipe-text">{description}</p>}

      {loading ? (
        <div className="ms-recipe-loading" role="status">
          <span className="ms-spinner" aria-hidden="true" />
          {host} is writing out the ingredients and steps…
        </div>
      ) : details ? (
        <div className="ms-recipe-body">
          <Ingredients key={details.recipe_name} items={details.ingredients} />
          <section className="ms-method" aria-label="Method">
            <h3 className="ms-kicker">Method{lit ? <span className="ms-where"> · {stepsLabel(lit)} of {steps.length}</span> : null}</h3>
            {steps.length ? (
              <ol className="ms-steps">
                {steps.map((step, i) => {
                  const on = Boolean(lit && i >= lit[0] && i <= lit[1]);
                  return (
                    <li key={i}>
                      <button type="button" className={`ms-step${on ? ' is-lit' : ''}${lit && i < lit[0] ? ' is-done' : ''}`} onClick={() => onPick(i)} aria-current={on ? 'step' : undefined}>
                        <span className="ms-step-n">{i + 1}</span>
                        <span className="ms-step-text">{step}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="ms-hint">This recipe lists no steps: everything goes in together.</p>
            )}
            {steps.length > 0 && (
              <div className="ms-method-actions">
                {finished ? (
                  <p className="ms-done">That's every step. Enjoy it.</p>
                ) : (
                  <button type="button" className="ms-primary" onClick={onNext} disabled={!live}>
                    {lit ? 'Next steps' : 'Start the steps'} <span aria-hidden="true">→</span>
                  </button>
                )}
                <span className="ms-hint">{host} talks you through it two steps at a time. Say <q>next</q> when you're ready.</span>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="ms-recipe-loading" role="status">
          This recipe didn't come through.
          <button type="button" className="ms-secondary" onClick={onRetry} disabled={!live}>Try again</button>
        </div>
      )}
    </article>
  );
}

/** What goes in it, ticked off as you gather it. The ticks are yours alone: nobody else needs to know. */
function Ingredients({ items }: { items: string[] }) {
  const [got, setGot] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) => setGot((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  return (
    <section className="ms-ingredients" aria-label="Ingredients">
      <h3 className="ms-kicker">You'll need</h3>
      {items.length ? (
        <ul>
          {items.map((item, i) => (
            <li key={i}>
              <label className={got.has(i) ? 'is-got' : undefined}>
                <input type="checkbox" checked={got.has(i)} onChange={() => toggle(i)} />
                <span>{item}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ms-hint">No ingredients listed.</p>
      )}
    </section>
  );
}
