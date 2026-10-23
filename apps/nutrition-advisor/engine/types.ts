// What the server and the page share. Nothing here is secret: the page sees
// everything the server holds about the session. The server holds it because
// the model calls (cards, recipes, photos) run there, and one writer keeps the
// card, the table and the kept recipes in step.
import type { Shelf } from './shelf.ts';

export type { Shelf, ShelfRow } from './shelf.ts';

/** Where a figure came from: read off a label in a photo, or estimated. */
export type Source = 'label' | 'estimate';

export interface Nutrients {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

/** One food's card: the original agent's `display_nutrition_info` payload, unchanged. */
export interface NutritionData {
  product_name: string;
  serving_size: string;
  calories: number;
  nutrients: Nutrients;
  /** 1-10: a ranking of the food's general nutrition, never of anyone's condition. */
  health_score: number;
  health_summary: string;
  recipes: RecipeIdea[];
  /** Optional on purpose: a card that makes no claim renders no chip. */
  source?: Source;
  /** The portion was inferred, not stated. The serving line says so. */
  portion_assumed?: boolean;
}

/** A recipe suggested on a card. */
export interface RecipeIdea {
  name: string;
  description: string;
}

/** A recipe opened into ingredients and steps (`display_recipe_details`). */
export interface RecipeDetails {
  recipe_name: string;
  /** The blurb the recipe was suggested or tapped with. */
  description?: string;
  ingredients: string[];
  preparation_steps: string[];
}

/** The session as the page sees it. */
export interface View {
  /** Grows with every change, so a reply that arrives after a newer one cannot put an older screen back. */
  seq: number;
  /** The card that is up, or null before the first food. */
  nutrition: NutritionData | null;
  /** Every food looked at (oldest first) and the recipes opened. */
  shelf: Shelf;
  /** Details made ahead for the current card's recipe ideas, so opening one is instant. */
  prepared: RecipeDetails[];
}

/** A food the user asked about. `quantity` is '' when they did not say how much. */
export interface FoodAsk {
  name: string;
  quantity: string;
}

export interface Image {
  mimeType: string;
  base64: string;
}

export type OutcomeKind = 'card' | 'compare' | 'recipe' | 'kept' | 'photo' | 'prepared' | 'cleared' | 'failed';

/** What an action did: the screen after it, and the words the host speaks from. */
export interface Outcome {
  view: View;
  kind: OutcomeKind;
  /** A new card went up (a recipe open on the page now covers it). */
  card?: boolean;
  /** The recipe this action put on screen. */
  recipe?: RecipeDetails;
  /** A tool's result, or for a button the event the host is told. */
  text: string;
  /** A line for the board itself (a photo it could not read, a food it could not find). */
  notice?: string;
}
