// The card, ported from the mini-app panel unchanged but for its imports.
import { DAILY_VALUES, dailyValue, DV_REFERENCE_NOTE, provenance, servingLine } from '../engine/nutrition.ts';
import type { NutritionData } from '../engine/types.ts';

const MACRO_COLORS: Record<string, string> = {
  protein_g: '#22c55e',
  carbs_g: '#3b82f6',
  fat_g: '#f59e0b',
  fiber_g: '#8b5cf6',
  sugar_g: '#ef4444',
  sodium_mg: '#6b7280',
};

const MACRO_LABELS: Record<string, string> = {
  protein_g: 'Protein',
  carbs_g: 'Carbs',
  fat_g: 'Fat',
  fiber_g: 'Fiber',
  sugar_g: 'Sugar',
  sodium_mg: 'Sodium',
};

const MACRO_UNITS: Record<string, string> = {
  protein_g: 'g',
  carbs_g: 'g',
  fat_g: 'g',
  fiber_g: 'g',
  sugar_g: 'g',
  sodium_mg: 'mg',
};

// The daily values live in engine/nutrition.ts: the avatar's board states the
// same %DV the bars draw.

function healthScoreColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 6) return '#84cc16';
  if (score >= 4) return '#f59e0b';
  if (score >= 2) return '#f97316';
  return '#ef4444';
}

/**
 * The card.
 *
 * `data` is non-nullable: this component used to carry its own empty state,
 * unreachable behind `AppPanel`'s guard, in which the panel spoke as the
 * avatar in the first person ("I'll analyze its nutrition for you") — a second
 * voice for a product whose whole premise is one. The empty state lives in
 * `AppPanel`, where it is the only one.
 */
export function NutritionPanel({
  data,
  onRecipeClick,
}: {
  data: NutritionData;
  onRecipeClick?: (recipe: { name: string; description: string }) => void;
}) {
  const macroKeys = Object.keys(MACRO_LABELS) as (keyof typeof MACRO_LABELS)[];
  const chip = provenance(data.source);
  const serving = servingLine(data.serving_size, data.portion_assumed);

  return (
    <div className="nutrition-card">
      <div className="nutrition-header">
        <h2 className="nutrition-product-name">{data.product_name}</h2>
        <div className="nutrition-serving-row">
          {serving && <span className="nutrition-serving">{serving}</span>}
          {/* Muted, and next to the portion rather than over the numbers: it
              is the provenance of a claim, not an alarm about one. A payload
              that says nothing gets no chip — implying we can tell a label
              from a guess when we cannot is the failure the brief names. */}
          {chip && (
            <span className={`nutrition-source nutrition-source--${chip.tone}`}>{chip.label}</span>
          )}
        </div>
      </div>

      <div className="nutrition-calories">
        <span className="calories-number">{data.calories}</span>
        <span className="calories-label">cal</span>
      </div>

      <div className="nutrition-macros">
        {macroKeys.map((key) => {
          const value = data.nutrients[key as keyof typeof data.nutrients];
          const { pct, barPct, over } = dailyValue(value, DAILY_VALUES[key]);
          return (
            <div key={key} className="macro-row">
              <span className="macro-label">{MACRO_LABELS[key]}</span>
              {/* The bar is a share of the daily value; the number beside it
                  is grams. Unlabelled, the two contradict each other — 3 g of
                  fat drew a longer bar than 3 g of protein and nothing on
                  screen said why. The percentage is what the bar is. */}
              {/* No daily value means no bar. Drawing an empty track beside a
                  non-zero gram figure is the same defect this card was just
                  fixed for: the shape is read before the digits, and an empty
                  bar says "none" while the number says 14 g. The row says so
                  in words instead. */}
              {pct === null ? (
                <span className="macro-nodv">no daily value</span>
              ) : (
                <div
                  className={`macro-bar-track${over ? ' macro-bar-track--over' : ''}`}
                  role="img"
                  aria-label={
                    over
                      ? `${pct}% of the daily value — over a full day`
                      : `${pct}% of the daily value`
                  }
                >
                  <div
                    className="macro-bar-fill"
                    style={{ width: `${barPct}%`, background: MACRO_COLORS[key] }}
                  />
                  {/* A full track is the one shape the bar cannot draw past,
                      so 117% and 300% used to be pixel-identical to exactly
                      100%. The notch and the chevron say the value ran off the
                      end; the figure beside it says how far. */}
                  {over && (
                    <span className="macro-bar-over" aria-hidden="true">
                      ›
                    </span>
                  )}
                </div>
              )}
              <span className="macro-value">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                {MACRO_UNITS[key]}
                {pct !== null && (
                  <span className={`macro-share${over ? ' macro-share--over' : ''}`}>
                    {pct}% DV
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {/* Said once, under the bars it applies to. A percentage with no stated
            denominator is not a readable figure. */}
        <p className="macro-dv-note">{DV_REFERENCE_NOTE}</p>
      </div>

      <div className="health-score-section">
        <div className="health-score-ring" style={{ borderColor: healthScoreColor(data.health_score) }}>
          <span className="health-score-number">{data.health_score}</span>
          <span className="health-score-of">/10</span>
        </div>
        <p className="health-summary">{data.health_summary}</p>
      </div>

      {data.recipes.length > 0 && (
        <div className="recipe-section">
          <h3 className="recipe-heading">Recipe Ideas</h3>
          {data.recipes.map((recipe, i) => (
            <div
              key={i}
              className={`recipe-card ${onRecipeClick ? 'recipe-card--clickable' : ''}`}
              onClick={() => onRecipeClick?.(recipe)}
              role={onRecipeClick ? 'button' : undefined}
              tabIndex={onRecipeClick ? 0 : undefined}
              onKeyDown={
                onRecipeClick
                  ? (e) => { if (e.key === 'Enter' || e.key === ' ') onRecipeClick(recipe); }
                  : undefined
              }
            >
              <h4>{recipe.name}</h4>
              <p>{recipe.description}</p>
              {onRecipeClick && <span className="recipe-card-arrow">→</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
