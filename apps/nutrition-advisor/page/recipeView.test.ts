import { describe, expect, it } from 'vitest';

import {
  arrived,
  closed,
  failed,
  initialRecipeView,
  recipeDescription,
  requested,
  superseded,
  timedOut,
  type RecipeView,
} from './recipeView.ts';

const details = (name: string, description = '') => ({
  recipe_name: name,
  description,
  ingredients: ['yogurt'],
  preparation_steps: ['layer'],
});

const parfait = { name: 'Berry parfait', description: 'Layer with fruit.' };
const oats = { name: 'Overnight oats', description: 'Soak overnight.' };

describe('tapping a recipe', () => {
  it('shows the tapped recipe and starts waiting', () => {
    const state = requested(initialRecipeView, parfait);
    expect(state.selected).toEqual(parfait);
    expect(state.loading).toBe(true);
    expect(state.details).toBeNull();
  });

  it('drops the previous details immediately', () => {
    // Otherwise the old recipe's ingredients sit under the new recipe's title
    // for as long as the model takes to answer.
    let state = requested(initialRecipeView, parfait);
    state = arrived(state, details('Berry parfait'));
    state = requested(state, oats);
    expect(state.details).toBeNull();
  });
});

describe('details arriving', () => {
  it('shows them and stops waiting', () => {
    let state = requested(initialRecipeView, parfait);
    state = arrived(state, details('Berry parfait'));
    expect(state.details).toEqual(details('Berry parfait'));
    expect(state.loading).toBe(false);
  });

  it('ignores details for a recipe the user is no longer looking at', () => {
    // Details are broadcast, not returned. Without this check, tapping A then
    // B renders A's ingredients under B's name.
    let state = requested(initialRecipeView, parfait);
    state = requested(state, oats);
    state = arrived(state, details('Berry parfait'));
    expect(state.details).toBeNull();
    expect(state.loading).toBe(true);
  });

  it('accepts a blank name as being for what is on screen', () => {
    // The agent falls back to the name the user tapped; blank means it could
    // not, not that these details belong to something else.
    let state = requested(initialRecipeView, parfait);
    state = arrived(state, details(''));
    expect(state.details).not.toBeNull();
    expect(state.loading).toBe(false);
  });

  it('matches names case-insensitively', () => {
    let state = requested(initialRecipeView, parfait);
    state = arrived(state, details('berry PARFAIT'));
    expect(state.details).not.toBeNull();
  });

  it('ignores a nameless recipe when nothing is open', () => {
    // Nothing to title the view with, and no tap to borrow a name from.
    expect(arrived(initialRecipeView, details(''))).toBe(initialRecipeView);
  });
});

describe('a recipe she put up without anyone tapping', () => {
  it('opens the card she just said was on screen', () => {
    // "Walk me through it" publishes a recipe with nothing tapped. The view
    // only ever opened from a tap, so the avatar talked the user through a
    // card that was never up while a chip appeared under "Recipes you opened".
    const state = arrived(
      initialRecipeView,
      details('Banana smoothie', 'Blend it with yogurt.'),
      'medium banana',
    );

    expect(state.selected).toEqual({
      name: 'Banana smoothie',
      description: 'Blend it with yogurt.',
    });
    expect(state.details).not.toBeNull();
    expect(state.forProduct).toBe('medium banana');
  });

  it('does not start a spinner for a card that arrived complete', () => {
    // The 20s deadline is keyed on `loading`. Arming it for details that are
    // already here would end with "not available yet" printed over them.
    const state = arrived(initialRecipeView, details('Banana smoothie'));
    expect(state.loading).toBe(false);
  });

  it('does not steal the ticket of a tap that is still loading', () => {
    // Tap A, then a recipe she volunteered lands first. Taking the ticket here
    // would leave A's answer arriving into a view that is no longer waiting.
    const tapped = requested(initialRecipeView, parfait);
    const after = arrived(tapped, details('Banana smoothie'));

    expect(after).toBe(tapped);
    expect(after.loading).toBe(true);
    expect(after.selected).toEqual(parfait);
  });

  it('does not re-open the view the user closed while waiting', () => {
    const shut = closed(requested(initialRecipeView, parfait));
    expect(arrived(shut, details('Berry parfait')).selected).toBeNull();
  });

  it('opens the next one, so an abandoned tap does not switch her off', () => {
    let state = closed(requested(initialRecipeView, parfait));
    state = arrived(state, details('Berry parfait')); // the abandoned answer
    state = arrived(state, details('Banana smoothie'));

    expect(state.selected?.name).toBe('Banana smoothie');
  });

  it('is superseded cleanly by a later tap', () => {
    let state = arrived(initialRecipeView, details('Banana smoothie'));
    state = requested(state, parfait, 'medium banana');

    expect(state.selected).toEqual(parfait);
    expect(state.details).toBeNull();
    expect(state.loading).toBe(true);
    // And the answer to that tap lands on it rather than being ignored.
    state = arrived(state, details('Berry parfait'));
    expect(state.details?.recipe_name).toBe('Berry parfait');
  });
});

describe('the blurb under the title', () => {
  it('a recipe re-opened from a chip is not blank under its name', () => {
    // A chip is tapped with no description at all — the card that suggested it
    // is long gone — so the published one is the only blurb there is.
    const chip = { name: 'Berry parfait', description: '' };
    expect(recipeDescription(chip, details('Berry parfait', 'Layer with fruit.'))).toBe(
      'Layer with fruit.',
    );
  });

  it('a payload with nothing to say does not blank the blurb she tapped', () => {
    expect(recipeDescription(parfait, details('Berry parfait'))).toBe(parfait.description);
    expect(recipeDescription(parfait, null)).toBe(parfait.description);
  });
});

describe('failures', () => {
  it('stops the spinner so the panel does not hang', () => {
    const state = requested(initialRecipeView, parfait);
    expect(failed(state, state.requestId).loading).toBe(false);
  });

  it('a stale failure leaves the current request alone', () => {
    // The subtle one. Tap A, tap B, then A's request fails: without the ticket
    // check the panel stops spinning while still waiting for B, and B's
    // details then appear with no indication they were ever loading.
    const first = requested(initialRecipeView, parfait);
    const second = requested(first, oats);
    const after = failed(second, first.requestId);
    expect(after).toBe(second);
    expect(after.loading).toBe(true);
  });
});

describe('a wait that never ends', () => {
  it('falls through to the tap-again copy instead of spinning forever', () => {
    // Details arrive on the data topic, not as the RPC's reply. When the model
    // echoes a recipe name that never matches, nothing rejects and nothing
    // arrives — the spinner ran for the rest of the session. The deadline
    // hands the user a door instead.
    const state = requested(initialRecipeView, parfait);
    const after = timedOut(state, state.requestId);
    expect(after.loading).toBe(false);
    expect(after.details).toBeNull();
    expect(after.selected).toEqual(parfait);
  });

  it('an expired deadline from an abandoned tap leaves the current wait alone', () => {
    const first = requested(initialRecipeView, parfait);
    const second = requested(first, oats);
    expect(timedOut(second, first.requestId)).toBe(second);
  });
});

describe('a card for another food while a recipe is open', () => {
  it('is announced rather than hidden behind the recipe view', () => {
    // The user asked about something else and Rachel answered on a card the
    // recipe view is covering. Silence here is indistinguishable from not
    // having heard them.
    const state = requested(initialRecipeView, parfait, 'medium banana');
    expect(superseded(state, 'medium apple')).toBe(true);
  });

  it('says nothing when the new card is the same food the recipe came from', () => {
    const state = requested(initialRecipeView, parfait, 'medium banana');
    expect(superseded(state, 'Medium Banana')).toBe(false);
  });

  it('a second new card is news even when it is the recipe’s own food', () => {
    // The banner said "New card: apple" and stayed there while the card behind
    // it went back to the banana: compared against the food the RECIPE came
    // from, a banana card is not a change, and the banner named the wrong food.
    const state = requested(initialRecipeView, parfait, 'medium banana');
    expect(superseded(state, 'medium apple')).toBe(true);
    expect(superseded(state, 'medium banana', 'medium apple')).toBe(true);
    expect(superseded(state, 'medium apple', 'medium apple')).toBe(false);
  });

  it('says nothing when the panel cannot tell — no guessing', () => {
    const noProduct = requested(initialRecipeView, parfait);
    expect(superseded(noProduct, 'medium apple')).toBe(false);
    const open = requested(initialRecipeView, parfait, 'medium banana');
    expect(superseded(open, '   ')).toBe(false);
    expect(superseded(closed(open), 'medium apple')).toBe(false);
  });
});

describe('going back', () => {
  it('clears the view', () => {
    let state: RecipeView = requested(initialRecipeView, parfait);
    state = arrived(state, details('Berry parfait'));
    state = closed(state);
    expect(state.selected).toBeNull();
    expect(state.details).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('an answer in flight cannot re-open the view the user just closed', () => {
    const open = requested(initialRecipeView, parfait);
    const shut = closed(open);
    expect(shut.requestId).toBeGreaterThan(open.requestId);
    expect(failed(shut, open.requestId)).toBe(shut);
    expect(arrived(shut, details('Berry parfait')).selected).toBeNull();
  });
});
