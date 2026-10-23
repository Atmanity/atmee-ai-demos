// The card, drawn as a nutrition facts label: the food, its serving (marked
// when assumed), where the figures came from, calories, each nutrient against
// a 2,000-calorie day, and the score with what it does and does not mean.
// Beside it, the card's recipe ideas, each a button.
import { DAILY_VALUES, dailyValue, DV_REFERENCE_NOTE, provenance, servingLine } from '../engine/nutrition.ts';
import type { Nutrients, NutritionData, RecipeIdea } from '../engine/types.ts';

const ROWS: [keyof Nutrients, string, string][] = [
  ['protein_g', 'Protein', 'g'],
  ['carbs_g', 'Carbs', 'g'],
  ['fat_g', 'Fat', 'g'],
  ['fiber_g', 'Fiber', 'g'],
  ['sugar_g', 'Sugar', 'g'],
  ['sodium_mg', 'Sodium', 'mg'],
];

const figure = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The score's band, for its colour: a ranking of the food, never of anyone's health. */
export const scoreBand = (score: number) => (score >= 7 ? 'high' : score >= 4 ? 'mid' : 'low');

export function Label({ data, compact = false }: { data: NutritionData; compact?: boolean }) {
  const chip = provenance(data.source);
  const serving = servingLine(data.serving_size, data.portion_assumed);
  return (
    <article className={`ms-label${compact ? ' is-compact' : ''}`} aria-label={`Nutrition facts: ${data.product_name}`}>
      <header className="ms-label-head">
        <p className="ms-label-kicker">
          <span>Nutrition facts</span>
          {/* Where the figures came from, beside the portion: a fact, not an alarm. No claim, no chip. */}
          {chip && <span className={`ms-source is-${chip.tone}`}>{chip.label}</span>}
        </p>
        <h2 className="ms-label-name">{data.product_name}</h2>
        {serving && <p className={`ms-label-serving${data.portion_assumed ? ' is-assumed' : ''}`}>{serving}</p>}
      </header>

      <p className="ms-label-cal"><span>Calories</span><b>{data.calories}</b></p>
      <p className="ms-label-dvhead"><span>Per serving</span><span>% Daily Value*</span></p>

      <ul className="ms-label-rows">
        {ROWS.map(([key, name, unit]) => {
          const value = data.nutrients[key] ?? 0;
          const { pct, barPct, over } = dailyValue(value, DAILY_VALUES[key]);
          return (
            <li key={key} className="ms-row">
              <span className="ms-row-name">{name}</span>
              <span className="ms-row-amt">{figure(value)} {unit}</span>
              {/* No daily value, no bar: an empty track beside 14 g would say "none". */}
              {pct === null ? (
                <span className="ms-row-nodv">no daily value</span>
              ) : (
                // The bar cannot draw past its end, so a figure over a full day says so in its shape too.
                <span className={`ms-bar${over ? ' is-over' : ''}`} role="img" aria-label={over ? `${pct}% of the daily value, over a full day` : `${pct}% of the daily value`}>
                  <i style={{ width: `${barPct}%` }} />
                </span>
              )}
              <span className={`ms-row-pct${over ? ' is-over' : ''}`}>{pct === null ? '–' : `${pct}%`}</span>
            </li>
          );
        })}
      </ul>
      <p className="ms-label-foot">* {DV_REFERENCE_NOTE}</p>

      {!compact && (
        <div className={`ms-score is-${scoreBand(data.health_score)}`}>
          <div className="ms-score-figure">
            <b>{data.health_score}</b><small>/10</small>
            <span className="ms-meter" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < data.health_score ? 'is-on' : ''} />)}
            </span>
          </div>
          <div className="ms-score-text">
            <p className="ms-score-summary">{data.health_summary}</p>
            <p className="ms-score-note">The score ranks how nourishing a food is in general. It is not a judgement about anyone's health.</p>
          </div>
        </div>
      )}
    </article>
  );
}

/** The card's recipe ideas: a tap opens one. */
export function Ideas({ food, ideas, onOpen, disabled }: { food: string; ideas: RecipeIdea[]; onOpen: (idea: RecipeIdea) => void; disabled: boolean }) {
  if (!ideas.length) return null;
  return (
    <section className="ms-ideas" aria-label={`Recipe ideas for ${food}`}>
      <h3 className="ms-kicker">Cook with it</h3>
      <ol>
        {ideas.map((idea) => (
          <li key={idea.name}>
            <button type="button" className="ms-idea" onClick={() => onOpen(idea)} disabled={disabled}>
              <span className="ms-idea-name">{idea.name}</span>
              {idea.description && <span className="ms-idea-text">{idea.description}</span>}
              <span className="ms-idea-go" aria-hidden="true">Open recipe →</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="ms-hint">Or ask: <q>Walk me through the first one.</q></p>
    </section>
  );
}
