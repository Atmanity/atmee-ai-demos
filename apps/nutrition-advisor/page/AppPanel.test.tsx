// @vitest-environment jsdom
// The board renders what it is given, and nothing it was not: the rules the
// original panel learned (a table only from two foods, chips only under a
// card, a notice wherever the user is looking, a visible state while a lookup
// is in flight).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Advisor } from '../engine/advisor.ts';
import type { NutritionData } from '../engine/types.ts';
import { AppPanel } from './AppPanel.tsx';
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

const noop = () => {};
const handlers = { onRecipe: vi.fn(), onOpenKept: vi.fn(), onBack: vi.fn(), onDismissBanner: noop, onDismissNotice: noop, onPhoto: vi.fn(), onSample: vi.fn() };
const board = (props: Partial<Parameters<typeof AppPanel>[0]> = {}) =>
  render(<AppPanel view={null} live recipeView={initialRecipeView} superseder={null} working={[]} notice={null} {...handlers} {...props} />);

describe('the empty board', () => {
  it('leads with the sentence you can say, and its doors work only once the session is live', () => {
    board({ live: false });
    expect(screen.getByText(/what's in a banana\?/)).toBeTruthy();
    expect((screen.getByText('Upload a photo') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Try a sample') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    board();
    fireEvent.click(screen.getByText('Try a sample'));
    expect(handlers.onSample).toHaveBeenCalled();
  });

  it('never mentions a camera', () => {
    const { container } = board();
    expect(container.textContent?.toLowerCase()).not.toContain('camera');
  });
});

describe('the card and the table', () => {
  it('one food is a card, with its provenance and portion; no table yet', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    board({ view: a.view() });
    expect(screen.getByText('Medium banana')).toBeTruthy();
    expect(screen.getByText('estimated')).toBeTruthy();
    expect(screen.getByText('assumed: 1 medium (118 g)')).toBeTruthy();
    expect(screen.queryByText('Compared so far')).toBeNull();
  });

  it('two foods are a table, with the link that gets you there', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    a.show(food('Medium apple', 95));
    board({ view: a.view() });
    expect(screen.getByText('Compared so far')).toBeTruthy();
    expect(screen.getByText(/Compared so far · 2 foods/)).toBeTruthy();
  });

  it('a recipe idea is a control', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    board({ view: a.view() });
    fireEvent.click(screen.getByText('Banana oat smoothie'));
    expect(handlers.onRecipe).toHaveBeenCalledWith({ name: 'Banana oat smoothie', description: 'Blend it with oats.' });
  });
});

describe('the board answers every turn', () => {
  it('shows what the app is doing, with the photo it is reading', () => {
    board({ working: [{ id: 1, label: 'reading the photo you shared', preview: 'data:image/jpeg;base64,AAAA' }] });
    expect(screen.getByText('Reading the photo you shared…')).toBeTruthy();
    expect(screen.getByAltText('The photo being read')).toBeTruthy();
  });

  it('a notice shows over a card too, not only on the empty board', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    board({ view: a.view(), notice: 'That photo could not be read. Try another, or just name the food.' });
    expect(screen.getByText(/That photo could not be read/)).toBeTruthy();
  });

  it('a recipe being made says so, and a new card behind it is announced', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    const loading = requested(initialRecipeView, { name: 'Banana oat smoothie', description: 'Blend it with oats.' }, 'Medium banana');
    board({ view: a.view(), recipeView: loading, superseder: 'Medium apple' });
    expect(screen.getByText(/Generating ingredients and preparation steps/)).toBeTruthy();
    expect(screen.getByText('New card: Medium apple')).toBeTruthy();
    cleanup();
    const done = arrived(loading, { recipe_name: 'Banana oat smoothie', ingredients: ['1 banana'], preparation_steps: ['Blend it.'] });
    board({ view: a.view(), recipeView: done });
    expect(screen.getByText('Blend it.')).toBeTruthy();
    fireEvent.click(screen.getByText('← Back to nutrition'));
    expect(handlers.onBack).toHaveBeenCalled();
  });
});

describe('a photo, made small enough to send', () => {
  it('keeps its shape, never grows, and fits the longest side', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
