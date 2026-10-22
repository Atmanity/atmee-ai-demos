// @vitest-environment jsdom
// The board renders what the view says, and every action has a control.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Analysis, View } from '../engine/types.ts';
import { FashionPanel } from './FashionPanel.tsx';
import { Onboarding } from './Onboarding.tsx';

afterEach(cleanup);

const analysis: Analysis = {
  target_style: 'smart casual', style_summary: 'Clean navy base', occasion: 'Dinner', style_score: 6, color_palette: ['navy', 'white', 'denim'],
  what_works: 'The navy layer frames you.', style_tip: 'Ground it with sharper shoes.',
  suggestions: [{ item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.', amazon_search_url: 'https://amazon.com/s?k=Slim+Navy+Silk+Tie' }, { item: 'Camel Wool Topcoat', text: 'Adds structure.' }],
  tried_items: ['Slim Navy Silk Tie'],
};

function board(overrides: Partial<Parameters<typeof FashionPanel>[0]> = {}) {
  const props: Parameters<typeof FashionPanel>[0] = {
    analysis, analysisLoading: false, fashionImage: { status: 'result', item: 'Current look', image_url: '/img/a' },
    onTrySuggestion: vi.fn(), onLoadMoreSuggestions: vi.fn(), tryOnStatusText: '', tryOnBusy: false, tryOnActiveItem: '', tryOnAvailable: true,
    canLoadMore: true, loadingMore: false, onResetBaseImage: vi.fn(), empty: <p>empty</p>, waiting: <p>waiting</p>, ...overrides,
  };
  render(<FashionPanel {...props} />);
  return props;
}

test('the read, the pieces, and a try-on button per piece not yet tried', () => {
  const props = board();
  expect(screen.getByText('Clean navy base')).toBeTruthy();
  expect(screen.getByText('6')).toBeTruthy();
  expect(screen.getByText('Wearing now')).toBeTruthy();
  const tried = screen.getByRole('button', { name: 'Tried on' }) as HTMLButtonElement;
  expect(tried.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Try on' }));
  expect(props.onTrySuggestion).toHaveBeenCalledWith('Camel Wool Topcoat', 'Adds structure.');
  fireEvent.click(screen.getByRole('button', { name: 'More ideas' }));
  expect(props.onLoadMoreSuggestions).toHaveBeenCalledWith(false);
  expect((screen.getAllByRole('link', { name: 'Buy' })[0] as HTMLAnchorElement).href).toContain('Slim+Navy+Silk+Tie');
});

test('with no image model, try-on buttons are off and say why', () => {
  board({ tryOnAvailable: false, analysis: { ...analysis, tried_items: [] } });
  for (const button of screen.getAllByRole('button', { name: 'Try on' }) as HTMLButtonElement[]) {
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('XAI_API_KEY');
  }
  expect(screen.getByText(/Try-ons are off in this demo/)).toBeTruthy();
});

test('a try-on being rendered shows over the previous image; the way back appears only on a try-on', () => {
  board({ fashionImage: { status: 'loading', item: 'Camel Wool Topcoat', previous_image_url: '/img/a' }, tryOnBusy: true, tryOnActiveItem: 'Camel Wool Topcoat', tryOnStatusText: 'Generating Camel Wool Topcoat...' });
  expect(screen.getByText('Adding Camel Wool Topcoat...')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Applying/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Back to my own photo' })).toBeNull();
  cleanup();
  const props = board({ fashionImage: { status: 'result', item: 'Camel Wool Topcoat', image_url: '/img/b', shop_links: [{ kind: 'category', label: 'Shop similar on Amazon', url: 'https://amazon.com/s?k=coat' }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to my own photo' }));
  expect(props.onResetBaseImage).toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Shop similar on Amazon' })).toBeTruthy();
});

test('an empty board shows the onboarding', () => {
  board({ analysis: null, fashionImage: null });
  expect(screen.getByText('empty')).toBeTruthy();
});

const view = (partial: Partial<View>): View => ({
  rev: 1, step: 'name', name: '', nameSkipped: false, target: '', category: '', photo: 'none', describedOutfit: '', image: null, analysis: null,
  visibleZones: [], latestItem: '', jobs: { photo: false, analysing: false, tryOn: null, queued: [], more: false }, notice: null, tryOnAvailable: true,
  thumbnailsPending: 0, canLoadMore: false, nameAsks: 0, photoAsks: 0, wantsPhoto: false, ...partial,
});

test('each onboarding step has its controls, and the answers are commands', () => {
  const onCommand = vi.fn();
  const onSample = vi.fn();
  const { rerender } = render(<Onboarding view={view({ step: 'name' })} live busy={false} onCommand={onCommand} onFile={vi.fn()} onSample={onSample} />);
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Sam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(onCommand).toHaveBeenLastCalledWith({ type: 'name', name: 'Sam' });
  fireEvent.click(screen.getByRole('button', { name: "I'd rather not say" }));
  expect(onCommand).toHaveBeenLastCalledWith({ type: 'skipName' });

  rerender(<Onboarding view={view({ step: 'style', name: 'Sam' })} live busy={false} onCommand={onCommand} onFile={vi.fn()} onSample={onSample} />);
  fireEvent.click(screen.getByRole('button', { name: 'old money' }));
  expect(onCommand).toHaveBeenLastCalledWith({ type: 'style', style: 'old money' });

  rerender(<Onboarding view={view({ step: 'photo', name: 'Sam', target: 'old money' })} live busy={false} onCommand={onCommand} onFile={vi.fn()} onSample={onSample} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try a sample' }));
  expect(onSample).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: "Skip it, I'll describe my outfit" }));
  expect(onCommand).toHaveBeenLastCalledWith({ type: 'declinePhoto' });
});

test('with the photo declined, the described outfit shows and a photo can still be dropped', () => {
  render(<Onboarding view={view({ step: 'styling', name: 'Sam', target: 'formal', photo: 'declined', describedOutfit: 'black jeans and a grey crewneck' })} live busy={false} onCommand={vi.fn()} onFile={vi.fn()} onSample={vi.fn()} />);
  expect(screen.getByText('black jeans and a grey crewneck')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeTruthy();
});
