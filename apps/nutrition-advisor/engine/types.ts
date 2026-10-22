// What the server and the page share. Nothing here is secret: the page sees
// everything the server holds about the session. The server holds it because
// the model calls (cards, recipes, photos, judging what the user said) run
// there, and one writer keeps the card, the shelf and the kept recipes in step.
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
  /** Details made ahead for the current card's recipe ideas: staged for the avatar, not shown. */
  prepared: RecipeDetails[];
}

/** A food the user asked about. `quantity` is '' when they did not say how much. */
export interface FoodAsk {
  name: string;
  quantity: string;
}

/** What an utterance asks the app to do (judge.ts). */
export type Intent =
  | { kind: 'lookup'; foods: FoodAsk[] }               // put a card up for each food
  | { kind: 'compare'; foods: FoodAsk[] }              // put up what the table lacks, then a verdict
  | { kind: 'recipe'; name: string; description: string } // open (or make) a recipe
  | { kind: 'back' }                                   // close the recipe view
  | { kind: 'sample' }                                 // read the sample photo
  | { kind: 'none' };                                  // nothing for the app: the avatar answers it

export interface Image {
  mimeType: string;
  base64: string;
}

/** What the page asks the server to do. */
export type Action =
  | Exclude<Intent, { kind: 'none' } | { kind: 'back' }>
  | { kind: 'photo'; image: Image }
  | { kind: 'prepare' };                               // make the current card's recipes ahead

/** How an action arrived: the avatar heard a spoken one, but never sees a button or a typed line the app kept. */
export type How = 'button' | 'spoken' | 'typed';

export interface ActRequest {
  action: Action;
  how: How;
  /** The user's words, when the action came from them. */
  said?: string;
}

export type OutcomeKind = 'card' | 'compare' | 'recipe' | 'kept' | 'photo' | 'prepared' | 'failed';

export interface Outcome {
  view: View;
  kind?: OutcomeKind;
  /** A new card went up (a recipe open on the page now covers it). */
  card?: boolean;
  /** The recipe this outcome put on screen. */
  recipe?: RecipeDetails;
  /** What the avatar should be told, in its own words. */
  event?: string;
  ttl?: number;
  /** A line for the panel itself (a photo it could not read, a sample that did not load). */
  notice?: string;
}

/** What the page tells the server about its own screen when it asks for a judgement. */
export interface Screen {
  /** The recipe open on the page, if any. */
  recipe: string | null;
}
