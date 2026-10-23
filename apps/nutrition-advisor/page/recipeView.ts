import type { RecipeDetails } from '../engine/types.ts';

/**
 * Tapping a recipe and waiting for its details.
 *
 * Ported unchanged from the mini-app panel. Here the details come back as the
 * reply to the page's own request instead of on a data topic, but every race
 * below survives the move: a slow reply to a tap the user abandoned, a recipe
 * opened by voice while a tap is loading, a reply that outlives its deadline.
 *
 * This is a state machine rather than a few `useState` calls because the three
 * things that make it correct are all races, and races written as effects are
 * invisible. Named transitions put them somewhere they can be tested and
 * somewhere a reader can see they were considered:
 *
 *   * details arrive on the data topic, not as the RPC's reply — the agent has
 *     to ask the model for them, which outlasts any sane RPC timeout. So a
 *     reply is matched to a request rather than awaited;
 *   * every tap takes a ticket (`requestId`), so an answer to an abandoned tap
 *     cannot clear the spinner belonging to the tap that replaced it;
 *   * the details are broadcast, so the one that lands may belong to a recipe
 *     the user is no longer looking at — hence the name check.
 */
export interface Chosen {
  name: string;
  description: string;
}

export interface RecipeView {
  selected: Chosen | null;
  details: RecipeDetails | null;
  loading: boolean;
  /** Ticket number of the tap currently on screen. Monotonic. */
  requestId: number;
  /**
   * The product the card was showing when this recipe was tapped.
   *
   * Kept so the panel can tell "a new card arrived for the food this recipe
   * belongs to" from "a new card arrived for something else entirely" — the
   * second one means the user asked about another food while reading a
   * recipe, and the recipe view is now hiding the answer they asked for.
   */
  forProduct: string;
  /**
   * Ticket of a tap whose answer has not landed yet. Zero when nothing is
   * outstanding.
   *
   * Only `unsolicited` reads it, and only to tell two closed views apart: one
   * the user closed while its details were still in flight, and one that is
   * simply closed. Without it, walking away from a slow tap re-opens the view
   * the moment the answer lands. The first arrival after a close consumes it,
   * so at most one agent-opened card is swallowed by a tap the user abandoned.
   */
  awaiting: number;
}

export const initialRecipeView: RecipeView = {
  selected: null,
  details: null,
  loading: false,
  requestId: 0,
  forProduct: '',
  awaiting: 0,
};

/** The user tapped a recipe. Takes the next ticket. */
export function requested(state: RecipeView, chosen: Chosen, forProduct = ''): RecipeView {
  const requestId = state.requestId + 1;
  return {
    selected: chosen,
    details: null,
    loading: true,
    requestId,
    forProduct,
    awaiting: requestId,
  };
}

/**
 * The RPC failed. Ends the spinner only if this ticket is still the current
 * one — otherwise a failure from an abandoned tap would stop the spinner of
 * the tap that replaced it, and the panel would look finished while still
 * waiting.
 */
export function failed(state: RecipeView, requestId: number): RecipeView {
  if (requestId !== state.requestId) return state;
  return { ...state, loading: false, awaiting: 0 };
}

/**
 * Details arrived. Either an answer to a tap, or a card the agent put up on
 * its own — see `unsolicited`.
 *
 * A blank incoming name is accepted for a tap: the agent falls back to the
 * name the user tapped, and an empty one means it could not, not that it
 * belongs elsewhere.
 */
export function arrived(
  state: RecipeView,
  recipe: RecipeDetails,
  forProduct = '',
): RecipeView {
  if (!state.selected) return unsolicited(state, recipe, forProduct);
  const incoming = (recipe.recipe_name || '').trim();
  if (incoming && incoming.toLowerCase() !== state.selected.name.toLowerCase()) {
    return state;
  }
  return { ...state, details: recipe, loading: false, awaiting: 0 };
}

/**
 * A recipe the agent published without anyone tapping anything. Opens it.
 *
 * "Walk me through it" is answered by `display_recipe_details`, which tells
 * the model — and the panel note — that the card is now on screen. It was not:
 * the recipe view only ever opened from a tap, so a spoken walkthrough changed
 * nothing but a chip under "Recipes you opened" while the avatar talked the
 * user through a card that was never up. Claiming a state change that never
 * happened is the worst thing this platform does, and the honest fix is to
 * make the claim true rather than to soften the words.
 *
 * Three things it must NOT do:
 *
 *   * steal a tap's ticket — an arrival while a tapped view is loading goes
 *     through `arrived`'s name check, not here;
 *   * re-open a view the user closed while its answer was still in flight —
 *     that is what `awaiting` is for;
 *   * arm the spinner's deadline — these details are already complete, so the
 *     view opens with `loading: false` and no clock starts.
 */
export function unsolicited(
  state: RecipeView,
  recipe: RecipeDetails,
  forProduct = '',
): RecipeView {
  if (state.selected) return state;
  // Nothing to title the view with. The agent falls back to the tapped name,
  // and there is no tap here for it to fall back to.
  const name = (recipe.recipe_name || '').trim();
  if (!name) return state;
  // The answer to a tap the user walked away from. Consumed rather than shown.
  if (state.awaiting) return { ...state, awaiting: 0 };
  return {
    selected: { name, description: recipe.description ?? '' },
    details: recipe,
    loading: false,
    requestId: state.requestId + 1,
    forProduct,
    awaiting: 0,
  };
}

/**
 * The blurb under the recipe's title.
 *
 * The published recipe carries its own description — the blurb the card
 * suggested it with, or the one it was tapped with — and that is the one to
 * print: a recipe re-opened from a chip is tapped with no description at all,
 * so the kept card replayed under its title with nothing beneath it, which
 * reads as a card that failed to load.
 *
 * Non-empty rather than nullish: a payload that carries `description: ""` has
 * nothing to say, and letting it win would blank the blurb the user tapped.
 */
export function recipeDescription(
  selected: Chosen,
  details: RecipeDetails | null,
): string {
  const published = (details?.description ?? '').trim();
  return published || selected.description;
}

/**
 * The user went back. Burns a ticket so an answer still in flight cannot
 * re-open the view they just closed.
 */
export function closed(state: RecipeView): RecipeView {
  return {
    selected: null,
    details: null,
    loading: false,
    requestId: state.requestId + 1,
    forProduct: '',
    // Carried, not cleared: an answer to the tap being closed may still be on
    // its way, and it must not re-open the view as an agent-opened card.
    awaiting: state.awaiting,
  };
}

/**
 * The wait ran out.
 *
 * Same rule as `failed` — a stale ticket must not stop the spinner belonging
 * to the tap that replaced it — but it exists under its own name because the
 * symptom is different: nothing failed, nothing arrived, and the panel spun
 * forever. A recipe whose name the model never echoed back never matches in
 * `arrived`, and there is no error anywhere to end the wait. Falling through
 * to "not available yet — tap the recipe again" is a door; a spinner is not.
 */
export function timedOut(state: RecipeView, requestId: number): RecipeView {
  return failed(state, requestId);
}

/**
 * A card for a DIFFERENT food landed while a recipe was open.
 *
 * True only when the panel can actually tell: a recipe tapped before the panel
 * knew which product it was looking at (`forProduct: ''`) gets no banner,
 * because "different" would be a guess. Announcing it rather than silently
 * swapping the view underneath the user is the point — she asked about
 * another food and the answer is behind this screen.
 *
 * `announced` is the food the banner is already naming, and it wins over
 * `forProduct` once there is one: after "New card: apple", a card for the
 * banana this recipe came from is still news, and comparing it against
 * `forProduct` left the banner reading "New card: apple" over a screen whose
 * card had since changed again.
 */
export function superseded(
  state: RecipeView,
  productName: string,
  announced = '',
): boolean {
  if (!state.selected) return false;
  const baseline = (announced || state.forProduct).trim();
  if (!baseline) return false;
  const incoming = (productName || '').trim();
  if (!incoming) return false;
  return incoming.toLowerCase() !== baseline.toLowerCase();
}
