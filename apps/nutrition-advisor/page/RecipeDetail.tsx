import { recipeDescription } from './recipeView.ts';
import type { RecipeDetails } from '../engine/types.ts';

export function RecipeDetail({
  recipe,
  details,
  loading,
  onBack,
}: {
  recipe: { name: string; description: string };
  details: RecipeDetails | null;
  loading: boolean;
  onBack: () => void;
}) {
  // The published blurb wins over the tapped one — a chip is tapped with no
  // blurb at all, and that is exactly the path that printed a blank line.
  const description = recipeDescription(recipe, details);
  return (
    <div className="recipe-detail">
      <button className="recipe-detail-back" onClick={onBack}>
        ← Back to nutrition
      </button>

      <div className="recipe-detail-card">
        <div className="recipe-detail-icon">🍳</div>
        <h2 className="recipe-detail-name">{recipe.name}</h2>
        <p className="recipe-detail-description">{description}</p>

        {loading ? (
          <div className="recipe-detail-loading">Generating ingredients and preparation steps...</div>
        ) : details ? (
          <>
            <h3 className="recipe-steps-title">Ingredients</h3>
            <ul className="recipe-ingredients-list">
              {details.ingredients.map((ingredient, i) => (
                <li key={i}>{ingredient}</li>
              ))}
            </ul>

            <h3 className="recipe-steps-title">How to prepare</h3>
            <ol className="recipe-steps-list">
              {details.preparation_steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </>
        ) : (
          <div className="recipe-detail-loading">
            Recipe details are not available yet. Tap the recipe again.
          </div>
        )}
      </div>
    </div>
  );
}
