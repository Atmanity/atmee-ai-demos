// @vitest-environment jsdom
// The screens render what the view says, every action has a control, and no
// screen uses the words a product never shows its users.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ALL_BODY_ZONES } from '../engine/items.ts';
import type { Analysis, View } from '../engine/types.ts';
import { Lineup, Mirror, Rail, Verdict } from './Fitting.tsx';
import { Lobby } from './Lobby.tsx';
import { Notes, notesText, type Rating } from './Notes.tsx';

afterEach(cleanup);

/** Words that are plumbing, not product: never on screen. */
const BANNED = /\b(session|avatar|api|atmee|demo|sample|mini-?app|state|event|tool)s?\b/i;
const shown = () => document.body.textContent ?? '';

const analysis = (partial: Partial<Analysis> = {}): Analysis => ({
  target_style: 'Dinner out', style_summary: 'Clean navy base', occasion: 'Dinner', style_score: 6, color_palette: ['navy', 'white', 'denim'],
  what_works: 'The navy layer frames you.', style_tip: 'Ground it with sharper shoes.',
  suggestions: [
    { item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.', amazon_search_url: 'https://amazon.com/s?k=Slim+Navy+Silk+Tie' },
    { item: 'Camel Wool Topcoat', text: 'Adds structure.', amazon_search_url: 'https://amazon.com/s?k=Camel+Wool+Topcoat' },
  ],
  tried_items: [], ...partial,
});

const view = (partial: Partial<View> = {}): View => ({
  rev: 1, step: 'styling', name: '', nameSkipped: true, target: 'Dinner out', category: '', photo: 'present', describedOutfit: '',
  image: { url: '/img/a', item: 'Current look', kind: 'look' }, analysis: analysis(), visibleZones: [...ALL_BODY_ZONES], latestItem: '',
  jobs: { photo: false, analysing: false, tryOn: null, queued: [], more: false }, notice: null, tryOnAvailable: true,
  thumbnailsPending: 0, canLoadMore: true, nameAsks: 0, photoAsks: 0, wantsPhoto: false, ...partial,
});

test('the front door says what Notch is and has a way in by voice and by typing', () => {
  const onStart = vi.fn();
  render(<Lobby onStart={onStart} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Ask Emery');
  // Who they will talk to, before the call: her face, with her name beside it (so the image is decorative).
  const stylist = screen.getByText('Your stylist').closest('p')!;
  expect(stylist.textContent).toContain('Emery');
  expect(stylist.querySelector('img')!.getAttribute('alt')).toBe('');
  fireEvent.click(screen.getByRole('button', { name: /Talk to Emery/ }));
  expect(onStart).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Chat by typing' }));
  expect(onStart).toHaveBeenLastCalledWith(false);
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
  expect(shown()).not.toMatch(BANNED);
});

describe('the mirror', () => {
  const handlers = () => ({ onFiles: vi.fn(), onExample: vi.fn(), onRestore: vi.fn() });

  test('empty: add a photo, or use the example outfit', () => {
    const h = handlers();
    render(<Mirror view={view({ image: null, photo: 'none', analysis: null })} preview={null} ready notice="" {...h} />);
    expect(screen.getByText('Add a photo of your outfit')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    expect(h.onExample).toHaveBeenCalled();
    expect(shown()).not.toMatch(BANNED);
  });

  test('a few photos at once, picked or dropped on the mirror, all come through to choose between', () => {
    const h = handlers();
    const { container } = render(<Mirror view={view({ image: null, photo: 'none', analysis: null })} preview={null} ready notice="" {...h} />);
    expect(screen.getByText(/Torn between a few\? Drag them all onto the mirror/)).toBeTruthy();
    const files = [new File(['a'], 'navy.jpg', { type: 'image/jpeg' }), new File(['b'], 'camel.jpg', { type: 'image/jpeg' })];
    fireEvent.drop(container.querySelector('.nt-mirror-frame')!, { dataTransfer: { files } });
    expect(h.onFiles).toHaveBeenLastCalledWith(files);
    const picker = screen.getByLabelText('Choose a photo of your outfit') as HTMLInputElement;
    expect(picker.multiple).toBe(true);
    fireEvent.change(picker, { target: { files } });
    expect(h.onFiles).toHaveBeenLastCalledWith(files);
  });

  test('before the room is open, the controls wait', () => {
    render(<Mirror view={null} preview={null} ready={false} notice="" {...handlers()} />);
    expect(screen.getByText('Setting up your fitting room…')).toBeTruthy();
  });

  test('a piece going on shows over the photo, with how long it takes', () => {
    render(<Mirror view={view({ jobs: { photo: false, analysing: false, tryOn: 'Camel Wool Topcoat', queued: ['Slim Navy Silk Tie'], more: false } })} preview={null} ready notice="" {...handlers()} />);
    expect(screen.getByText(/Putting on the Camel Wool Topcoat/)).toBeTruthy();
    expect(screen.getByText(/About 20 seconds, then the Slim Navy Silk Tie/)).toBeTruthy();
  });

  test('a try-on in the mirror: the way back, and where to shop it', () => {
    const h = handlers();
    render(<Mirror view={view({ image: { url: '/img/b', item: 'Camel Wool Topcoat', kind: 'tryon', shop_links: [{ kind: 'category', label: 'Shop similar on Amazon', url: 'https://amazon.com/s?k=coat' }] } })} preview={null} ready notice="" {...h} />);
    expect(screen.getByText('With the Camel Wool Topcoat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to my photo' }));
    expect(h.onRestore).toHaveBeenCalled();
    expect((screen.getByRole('link', { name: /Shop similar/ }) as HTMLAnchorElement).href).toContain('amazon.com');
  });

  test('a problem is said where it happened', () => {
    render(<Mirror view={view()} preview={null} ready notice="The white sneakers can't go on: your feet aren't in the photo." {...handlers()} />);
    expect(screen.getByText("The white sneakers can't go on: your feet aren't in the photo.").getAttribute('role')).toBe('status');
  });
});

describe('the looks under the mirror', () => {
  const looks = [{ id: 1, preview: 'blob:navy', score: 7 }, { id: 2, preview: 'blob:camel' }, { id: 3, preview: 'blob:black', score: 5 }];

  test('each look, the one in the mirror, the score each has had; a tap puts another in', () => {
    const onPick = vi.fn();
    render(<Lineup looks={looks} inMirror={0} ready onPick={onPick} />);
    const inMirror = screen.getByRole('button', { name: /^Look 1/ });
    expect(inMirror.getAttribute('aria-pressed')).toBe('true');
    expect(inMirror.textContent).toContain('7/10');
    expect(inMirror.textContent).toContain('In the mirror');
    expect(screen.getByRole('button', { name: /^Look 2/ }).textContent).not.toMatch(/\/10/);   // not scored yet
    fireEvent.click(screen.getByRole('button', { name: /^Look 3/ }));
    expect(onPick).toHaveBeenCalledWith(2);
    fireEvent.click(inMirror);
    expect(onPick).toHaveBeenCalledTimes(1);   // the one in the mirror is already there
    expect(shown()).not.toMatch(BANNED);
  });

  test('while a photo goes up the looks wait; one photo is no choice, so nothing shows', () => {
    const { rerender, container } = render(<Lineup looks={looks} inMirror={0} ready={false} onPick={vi.fn()} />);
    expect((screen.getByRole('button', { name: /^Look 2/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Lineup looks={looks.slice(0, 1)} inMirror={0} ready onPick={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('the verdict', () => {
  const handlers = () => ({ onRerate: vi.fn(), onOccasion: vi.fn(), onChangeOccasion: vi.fn() });

  test('no occasion yet: pick one or type your own', () => {
    const h = handlers();
    render(<Verdict view={view({ target: '', analysis: null, image: null })} failed={false} delta={null} ready {...h} />);
    expect(screen.getByRole('heading', { name: 'What are you dressing for?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Job interview' }));
    expect(h.onOccasion).toHaveBeenLastCalledWith('Job interview');
    fireEvent.change(screen.getByRole('textbox', { name: 'What are you dressing for?' }), { target: { value: 'a rooftop birthday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    expect(h.onOccasion).toHaveBeenLastCalledWith('a rooftop birthday');
    expect(shown()).not.toMatch(BANNED);
  });

  test('in a call where Emery takes files, the invitation can be shown to her; otherwise it is not offered', () => {
    const onInvitation = vi.fn();
    const { rerender } = render(<Verdict view={view({ target: '', analysis: null, image: null })} failed={false} delta={null} ready {...handlers()} onInvitation={onInvitation} />);
    expect(screen.getByText(/Got an invitation or a dress code\?/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show it to Emery' })).toBeTruthy();
    const invite = new File(['%PDF'], 'invite.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Share the invitation'), { target: { files: [invite] } });
    expect(onInvitation).toHaveBeenCalledWith([invite]);
    expect(shown()).not.toMatch(BANNED);
    rerender(<Verdict view={view({ target: '', analysis: null, image: null })} failed={false} delta={null} ready {...handlers()} />);
    expect(screen.queryByRole('button', { name: 'Show it to Emery' })).toBeNull();
  });

  test('an occasion and no photo: the outfit is next', () => {
    render(<Verdict view={view({ image: null, analysis: null })} failed={false} delta={null} ready {...handlers()} />);
    expect(screen.getByRole('heading', { name: 'Now, the outfit.' })).toBeTruthy();
  });

  test('reading: Emery is on it, no score shown', () => {
    render(<Verdict view={view({ analysis: null, jobs: { photo: false, analysing: true, tryOn: null, queued: [], more: false } })} failed={false} delta={null} ready {...handlers()} />);
    expect(screen.getByRole('heading', { name: /Emery is reading your look/ })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /out of 10/ })).toBeNull();
  });

  test('a failed read says so, and can be asked again', () => {
    const h = handlers();
    render(<Verdict view={view({ analysis: null })} failed delta={null} ready {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rate it again' }));
    expect(h.onRerate).toHaveBeenCalled();
  });

  test('the verdict: the score on the tape, the change a piece made, what works, the one fix', () => {
    const h = handlers();
    render(<Verdict view={view({ analysis: analysis({ style_score: 8, tried_items: ['Slim Navy Silk Tie'] }) })} failed={false} delta={{ by: 2, item: 'Slim Navy Silk Tie' }} ready {...h} />);
    expect(screen.getByRole('img', { name: '8 out of 10' })).toBeTruthy();
    expect(screen.getByText('+2 with the Slim Navy Silk Tie')).toBeTruthy();
    expect(screen.getByText('The navy layer frames you.')).toBeTruthy();
    expect(screen.getByText('Ground it with sharper shoes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rate it for something else' }));
    expect(h.onChangeOccasion).toHaveBeenCalled();
    expect(shown()).not.toMatch(BANNED);
  });
});

describe('the rail', () => {
  test('each piece can be tried on and shopped; the one on you says so', () => {
    const onTry = vi.fn();
    const onMore = vi.fn();
    render(<Rail view={view({ image: { url: '/img/b', item: 'Slim Navy Silk Tie', kind: 'tryon' }, analysis: analysis({ tried_items: ['Slim Navy Silk Tie'] }) })} ready onTry={onTry} onMore={onMore} />);
    expect(screen.getByRole('button', { name: 'On you' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try it on' }));
    expect(onTry).toHaveBeenCalledWith('Camel Wool Topcoat', 'Adds structure.');
    expect((screen.getByRole('link', { name: 'Shop Camel Wool Topcoat' }) as HTMLAnchorElement).href).toContain('Camel+Wool+Topcoat');
    fireEvent.click(screen.getByRole('button', { name: /More pieces/ }));
    expect(onMore).toHaveBeenCalled();
  });

  test('one piece goes on at a time', () => {
    render(<Rail view={view({ jobs: { photo: false, analysing: false, tryOn: 'Slim Navy Silk Tie', queued: [], more: false } })} ready onTry={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Putting it on/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Try it on' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('without try-ons the rail is still useful: no dead buttons, every piece can be shopped', () => {
    render(<Rail view={view({ tryOnAvailable: false })} ready onTry={vi.fn()} onMore={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Try it on/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /^Shop / })).toHaveLength(2);
    expect(shown()).not.toMatch(BANNED);
  });

  test('without catalogue shots each piece is a swatch in its colour, labelled with its kind', () => {
    const { container } = render(<Rail view={view({ tryOnAvailable: false })} ready onTry={vi.fn()} onMore={vi.fn()} />);
    expect(container.querySelectorAll('.nt-piece-shot img')).toHaveLength(0);
    const swatches = [...container.querySelectorAll<HTMLElement>('.nt-swatch-card')];
    expect(swatches).toHaveLength(2);
    expect(swatches[0].textContent).toBe('Neckline');                    // a tie: no shop category, so where it goes
    expect(swatches[0].style.getPropertyValue('--sw')).toBe('#2c3550');  // navy
    expect(swatches[1].textContent).toBe('Jacket');                      // a topcoat
    expect(swatches[1].style.getPropertyValue('--sw')).toBe('#b58a59');  // camel
  });

  test('a catalogue shot, once rendered, replaces the swatch', () => {
    const { container } = render(<Rail view={view({ analysis: analysis({ suggestions: [{ item: 'Camel Wool Topcoat', text: 'x', image_url: '/thumbs/camel' }] }) })} ready onTry={vi.fn()} onMore={vi.fn()} />);
    expect(container.querySelector('.nt-piece-shot img')?.getAttribute('src')).toBe('/thumbs/camel');
    expect(container.querySelector('.nt-swatch-card')).toBeNull();
  });

  test('empty until the first verdict, and says so', () => {
    render(<Rail view={view({ analysis: null })} ready onTry={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByText(/hang here after the first verdict/)).toBeTruthy();
  });
});

describe('the fitting notes', () => {
  const ratings: Rating[] = [
    { occasion: 'Dinner out', score: 6, summary: 'Clean navy base' },
    { occasion: 'Dinner out', score: 8, summary: 'Sharper', with: 'Slim Navy Silk Tie' },
  ];

  test('as text to keep: the verdict, every rating, the pieces with where to find them', () => {
    const text = notesText(view({ image: { url: '/img/b', item: 'Slim Navy Silk Tie', kind: 'tryon' }, analysis: analysis({ style_score: 8, tried_items: ['Slim Navy Silk Tie'] }) }), ratings);
    expect(text).toContain('Dressing for: Dinner out');
    expect(text).toContain('Verdict: 8/10, "Clean navy base" (with the Slim Navy Silk Tie)');
    expect(text).toContain('6/10 for Dinner out');
    expect(text).toContain('8/10 for Dinner out, with the Slim Navy Silk Tie');
    expect(text).toContain('https://amazon.com/s?k=Camel+Wool+Topcoat');
    expect(text.indexOf('Slim Navy Silk Tie: ')).toBeLessThan(text.indexOf('Camel Wool Topcoat: '));   // the tried piece first
    expect(text).not.toMatch(/\/img\//);
  });

  test('on screen at the end of the call, with a way to keep them and to start again', () => {
    const onNewFitting = vi.fn();
    render(<Notes view={view()} ratings={ratings} ended onClose={vi.fn()} onNewFitting={onNewFitting} />);
    expect(screen.getByRole('dialog', { name: 'Your look for dinner out' })).toBeTruthy();
    expect(screen.getByText('Your fitting is done')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download notes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new fitting' }));
    expect(onNewFitting).toHaveBeenCalled();
    expect(shown()).not.toMatch(BANNED);
  });
});
