// @vitest-environment jsdom
// The screens, rendered: the front door, the empty table, a lookup in flight,
// the label and its recipe ideas, the foods side by side, a recipe being
// cooked, the notices the page puts up itself, and the notes at the end. The
// rules the original panel learned still hold (a table only from two foods, a
// visible state while a lookup is in flight), and no screen speaks the
// plumbing's words.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Advisor } from '../engine/advisor.ts';
import { started, unstarted } from '../engine/cook.ts';
import type { NutritionData, RecipeDetails } from '../engine/types.ts';
import { App, workLabel } from './App.tsx';
import { Board, type BoardProps } from './Board.tsx';
import { Lobby } from './Lobby.tsx';
import { Notes } from './Notes.tsx';
import { fitWithin } from './photo.ts';
import { arrived, initialRecipeView, requested } from './recipeView.ts';

afterEach(cleanup);

const food = (name: string, calories = 105): NutritionData => ({
  product_name: name,
  serving_size: '1 medium (118 g)',
  calories,
  nutrients: { protein_g: 1.3, carbs_g: 27, fat_g: 0.4, fiber_g: 3.1, sugar_g: 14.4, sodium_mg: 1 },
  health_score: 9,
  health_summary: 'Sweet, with fiber.',
  recipes: [{ name: 'Banana oat smoothie', description: 'Blend it with oats.' }],
  source: 'estimate',
  portion_assumed: true,
});
const smoothie: RecipeDetails = { recipe_name: 'Banana oat smoothie', description: 'Blend it with oats.', ingredients: ['1 banana', '40 g oats'], preparation_steps: ['Peel the banana.', 'Add the oats.', 'Blend until smooth.'] };

/** The plumbing's words, which no screen may say. */
const BANNED = /\b(?:session|avatar|api|atmee|demo|sample|mini-app|state|event|tool)s?\b/i;

const handlers = () => ({
  onQuickPick: vi.fn(), onIdea: vi.fn(), onOpenKept: vi.fn(), onBack: vi.fn(), onNext: vi.fn(), onPickStep: vi.fn(), onRetryRecipe: vi.fn(),
  onChoosePhoto: vi.fn(), onPhoto: vi.fn(), onSample: vi.fn(), onClear: vi.fn(), onDismissNotice: vi.fn(), onDismissConcern: vi.fn(),
});
function board(props: Partial<BoardProps> = {}) {
  const h = handlers();
  const utils = render(
    <Board host="Rachel" ready connecting={false} view={new Advisor().view()} recipeView={initialRecipeView} cook={unstarted()} working={[]} notice={null} concern={null} {...h} {...props} />,
  );
  return { ...utils, h };
}
const withFoods = (...names: string[]) => {
  const a = new Advisor();
  names.forEach((name, i) => a.show(food(name, 105 - i * 10)));
  return a.view();
};

describe('the front door', () => {
  it('says what it is and starts by voice or by typing', () => {
    const onStart = vi.fn();
    const { container } = render(<Lobby host="Rachel" onStart={onStart} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Ask about any food/);
    fireEvent.click(screen.getByText('Talk to Rachel'));
    fireEvent.click(screen.getByText('Type instead'));
    expect(onStart.mock.calls).toEqual([[true], [false]]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(expect.arrayContaining(['Name any food', "See what's in it", 'Compare, then cook']));
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('is what the app opens on', () => {
    render(<App />);
    expect(screen.getByText('Talk to Rachel')).toBeTruthy();
    expect(document.title === '' || !BANNED.test(document.title)).toBe(true);
  });
});

describe('the empty table', () => {
  it('leads with what to say, and its doors work only once Rachel is here', () => {
    const { h } = board({ ready: false, connecting: true });
    expect(screen.getByText('Rachel is on the way')).toBeTruthy();
    expect((screen.getByText('Banana') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const ready = board();
    fireEvent.click(screen.getByText('Banana'));
    expect(ready.h.onQuickPick).toHaveBeenCalledWith('Banana');
    fireEvent.click(screen.getByText(/Add a photo of a food or its label/));
    expect(ready.h.onChoosePhoto).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/salmon plate photo/));
    expect(ready.h.onSample).toHaveBeenCalled();
    expect(h.onQuickPick).not.toHaveBeenCalled();
  });

  it('never asks for a camera, nor speaks the plumbing', () => {
    const { container } = board();
    expect(container.textContent?.toLowerCase()).not.toContain('camera');
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('a first lookup in flight is a label being filled in, with the photo being read', () => {
    board({ working: [{ id: 1, label: 'reading your photo', preview: 'data:image/jpeg;base64,AAAA' }] });
    expect(screen.getByText(/Reading your photo…/)).toBeTruthy();
    expect(screen.getByAltText('The photo being read')).toBeTruthy();
  });
});

describe('the label', () => {
  it('one food is a label, with its provenance, portion and score; no table yet', () => {
    const { container } = board({ view: withFoods('Medium banana') });
    const label = screen.getByRole('article', { name: 'Nutrition facts: Medium banana' });
    expect(within(label).getByText('estimated')).toBeTruthy();
    expect(within(label).getByText('assumed: 1 medium (118 g)')).toBeTruthy();
    expect(within(label).getByText('105')).toBeTruthy();
    expect(within(label).getByText('no daily value')).toBeTruthy();   // sugar: total, not added
    expect(within(label).getByText(/not a judgement about anyone's health/)).toBeTruthy();
    expect(screen.queryByText(/Side by side/)).toBeNull();
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('a recipe idea is a button', () => {
    const { h } = board({ view: withFoods('Medium banana') });
    fireEvent.click(screen.getByText('Banana oat smoothie'));
    expect(h.onIdea).toHaveBeenCalledWith({ name: 'Banana oat smoothie', description: 'Blend it with oats.' });
  });

  it('a lookup over a card shows what is happening, and a notice shows wherever you are', () => {
    board({ view: withFoods('Medium banana'), working: [{ id: 1, label: 'looking up apple' }], notice: "Couldn't find dragon fruit just now." });
    expect(screen.getByText('Looking up apple…')).toBeTruthy();
    expect(screen.getByText(/Couldn't find dragon fruit/)).toBeTruthy();
  });
});

describe('side by side', () => {
  it('two foods are a table, with the link that gets you there', () => {
    board({ view: withFoods('Medium banana', 'Medium apple') });
    expect(screen.getByText('Side by side · 2 foods')).toBeTruthy();
    expect(screen.getByText(/See all 2 foods side by side/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('starting over asks first', () => {
    const { h } = board({ view: withFoods('Medium banana', 'Medium apple') });
    fireEvent.click(screen.getByText('Start over'));
    expect(h.onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Clear'));
    expect(h.onClear).toHaveBeenCalled();
  });
});

describe('a recipe', () => {
  const view = withFoods('Medium banana');
  const loading = requested(initialRecipeView, { name: 'Banana oat smoothie', description: 'Blend it with oats.' }, 'Medium banana');

  it('being made says so', () => {
    board({ view, recipeView: loading });
    expect(screen.getByText(/Rachel is writing out the ingredients and steps/)).toBeTruthy();
  });

  it('open: ingredients to tick, the steps Rachel is on lit up, and the way on and back', () => {
    const { h, container } = board({ view, recipeView: arrived(loading, smoothie, 'Medium banana'), cook: started(3) });
    expect(screen.getByText('A recipe idea for Medium banana')).toBeTruthy();
    const lit = [...container.querySelectorAll('[aria-current="step"]')].map((el) => el.textContent);
    expect(lit).toEqual(['1Peel the banana.', '2Add the oats.']);
    expect(screen.getByText(/Steps 1 and 2 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('40 g oats'));
    expect((screen.getByLabelText('40 g oats') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText('Next steps'));
    expect(h.onNext).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Blend until smooth.'));
    expect(h.onPickStep).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByText('Back to the card'));
    expect(h.onBack).toHaveBeenCalled();
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('opened by a tap, it waits for "Start the steps"; finished, it says so', () => {
    board({ view, recipeView: arrived(loading, smoothie, 'Medium banana'), cook: unstarted() });
    expect(screen.getByText('Start the steps')).toBeTruthy();
    cleanup();
    board({ view, recipeView: arrived(loading, smoothie, 'Medium banana'), cook: { at: 3, shown: [2, 2] } });
    expect(screen.getByText(/That's every step/)).toBeTruthy();
  });
});

describe('the notices the page puts up itself', () => {
  it('an emergency, at the top, whatever is on screen', () => {
    const { h } = board({ view: withFoods('Medium banana'), concern: 'emergency' });
    expect(screen.getByRole('alert').textContent).toMatch(/call your local emergency number now/);
    fireEvent.click(screen.getByLabelText('Dismiss the emergency notice'));
    expect(h.onDismissConcern).toHaveBeenCalled();
  });

  it('a question about their own health', () => {
    board({ concern: 'medical' });
    expect(screen.getByText(/ask your doctor or a registered dietitian/)).toBeTruthy();
  });
});

describe('the end of a call', () => {
  it('your notes: every food and recipe, to download, and the way back', () => {
    const onAgain = vi.fn();
    const { container } = render(<Notes shelf={withFoods('Medium banana').shelf} recipes={[smoothie]} host="Rachel" failed={false} onAgain={onAgain} />);
    expect(screen.getByText('Your notes from today')).toBeTruthy();
    expect(screen.getByText(/1 food and 1 recipe, ready to keep/)).toBeTruthy();
    expect(screen.getByText('Download your notes')).toBeTruthy();
    fireEvent.click(screen.getByText('Call Rachel again'));
    expect(onAgain).toHaveBeenCalled();
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('with nothing to keep, a goodbye; when Rachel never joined, a second try', () => {
    render(<Notes shelf={new Advisor().view().shelf} recipes={[]} host="Rachel" failed={false} onAgain={() => {}} />);
    expect(screen.getByText('Thanks for stopping by.')).toBeTruthy();
    cleanup();
    render(<Notes shelf={new Advisor().view().shelf} recipes={[]} host="Rachel" failed onAgain={() => {}} />);
    expect(screen.getByText("Rachel couldn't join this time.")).toBeTruthy();
  });
});

describe('small things', () => {
  it('what the table says while a tool runs', () => {
    expect(workLabel('look_up_food', { foods: ['oat milk', 'a banana'] })).toBe('looking up oat milk and a banana');
    expect(workLabel('compare_foods', { foods: ['an apple'] })).toBe('putting an apple side by side');
    expect(workLabel('open_recipe', { recipe: 'x' })).toBe('opening the recipe');
    expect(workLabel('start_over', {})).toBeNull();
  });

  it('a photo is made small enough to send, keeping its shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
