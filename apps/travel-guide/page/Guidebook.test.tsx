// @vitest-environment jsdom
// The guidebook's screens, rendered: where to, a destination's page with its
// tabs, the sights one at a time, the route, and the trip at the end. Every
// control sends the same actions the host's tools take, with a label the
// host is told (none for a tab).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Action, Snapshot } from '../engine/types.ts';
import { Guidebook } from './Guidebook.tsx';
import { emptyNotes, notesFrom } from './notes.ts';
import { TripSummary } from './Summary.tsx';

afterEach(cleanup);

const world = (over: Partial<Snapshot> = {}): Snapshot => ({
  seq: 1, stage: 'welcome', travelerName: '', continent: '', pending: false, newsAvailable: true,
  map: null, news: null, food: null, spot: null, trip: { current: '', visited: [] }, ...over,
});
const japan = (over: Partial<Snapshot> = {}) => world({
  stage: 'planning',
  map: { country: 'Japan', isoCode: 'JP', city: 'Kyoto', center: [36, 138], bbox: [31, 129, 45, 146], outline: null, attribution: '' },
  news: { country: 'Japan', headlines: [{ title: 'Cherry blossom early', source: 'nhk.or.jp', url: 'https://nhk.test/1', publishDate: '' }], shown: false, loading: false },
  food: { country: 'Japan', dishes: [{ name: 'Ramen', description: 'Broth and noodles.', imageUrl: null }], shown: false, loading: false },
  trip: {
    current: 'Japan',
    visited: [
      { country: 'Peru', city: '', dishes: ['Ceviche'], headlineCount: 0, silhouette: [[[0, 0], [1, 0], [1, 2], [0, 0]]] },
      { country: 'Japan', city: 'Kyoto', dishes: [], headlineCount: 0, silhouette: null },
    ],
  },
  ...over,
});
const sights = (over: Partial<Snapshot> = {}) => japan({
  stage: 'around',
  spot: {
    place: 'Gion', origin: [35, 135.77], index: 0, total: 2, lookupFailed: false,
    spot: { name: 'Yasaka Shrine', category: 'shrine', lat: 35.0037, lon: 135.7785, distance: 'about a 4 minute walk away', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=x', imageUrl: null, summary: 'A shrine at the end of Shijō street.' },
    pins: [],
  },
  ...over,
});

function guide(snapshot: Snapshot) {
  const sent: [Action, string][] = [];
  const view = render(<Guidebook snapshot={snapshot} busy={false} host="Lumi" onAction={(a, label) => sent.push([a, label])} />);
  return { sent, rerender: (next: Snapshot) => view.rerender(<Guidebook snapshot={next} busy={false} host="Lumi" onAction={(a, label) => sent.push([a, label])} />) };
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const submit = (label: string | RegExp, text: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
};

describe('where to', () => {
  test('the welcome: search, surprise me, ideas, and a place to look around', () => {
    const { sent } = guide(world());
    expect(screen.getByRole('heading', { name: 'The whole world is open' })).toBeTruthy();
    submit('Where to?', 'Kyoto, Japan');
    click('Surprise me');
    click('Portugal');
    submit(/Name a street/, 'Shibuya station');
    expect(sent).toEqual([
      [{ kind: 'search', query: 'Kyoto, Japan' }, 'Go, searching for "Kyoto, Japan"'],
      [{ kind: 'pick' }, 'Surprise me'],
      [{ kind: 'destination', country: 'Portugal' }, 'Portugal, one of the ideas'],
      [{ kind: 'around', place: 'Shibuya station' }, 'Look around, for "Shibuya station"'],
    ]);
  });

  test('the ideas follow the continent they are drawn to', () => {
    guide(world({ continent: 'South America' }));
    expect(screen.getByText('Ideas in South America')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Peru' })).toBeTruthy();
  });
});

describe("a destination's page", () => {
  test('its name, city and position, and the dishes and news a button away', () => {
    const { sent } = guide(japan());
    expect(screen.getByRole('heading', { level: 1, name: 'Japan' })).toBeTruthy();
    expect(screen.getByText(/Kyoto ·/)).toBeTruthy();
    expect(screen.queryByText('Ramen')).toBeNull(); // not shown until asked for
    click('What should I eat there?');
    fireEvent.click(screen.getByRole('tab', { name: 'News' }));
    expect(screen.queryByText('Cherry blossom early')).toBeNull();
    click('Show the latest headlines');
    expect(sent).toEqual([[{ kind: 'food' }, 'What should I eat there?'], [{ kind: 'news' }, 'Show the latest headlines']]);
  });

  test('the tab opens on what the host just showed', () => {
    const { rerender } = guide(japan());
    expect(screen.getByRole('tab', { name: 'Eat' }).getAttribute('aria-selected')).toBe('true');
    rerender(japan({ news: { ...japan().news!, shown: true } }));
    expect(screen.getByRole('tab', { name: 'News' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Cherry blossom early').closest('a')!.getAttribute('href')).toBe('https://nhk.test/1');
    rerender(japan({ news: { ...japan().news!, shown: true }, food: { ...japan().food!, shown: true } }));
    expect(screen.getByRole('tab', { name: 'Eat' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Ramen')).toBeTruthy();
    expect(screen.getByText('Broth and noodles.')).toBeTruthy();
    rerender(sights());
    expect(screen.getByRole('tab', { name: 'Wander' }).getAttribute('aria-selected')).toBe('true');
  });

  test('without a news source there is no news tab to offer', () => {
    guide(japan({ newsAvailable: false }));
    expect(screen.queryByRole('tab', { name: 'News' })).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Eat', 'Wander']);
  });

  test('a tab moves the board without telling the host', () => {
    const { sent } = guide(japan());
    fireEvent.click(screen.getByRole('tab', { name: 'Wander' }));
    expect(sent).toEqual([[{ kind: 'show', stage: 'around' }, '']]);
    expect(screen.getByText(/Name a street, station or neighbourhood in Japan/)).toBeTruthy();
  });

  test('the route takes them back; where they are is marked, not offered', () => {
    const { sent } = guide(japan());
    click(/Peru/);
    expect(sent).toEqual([[{ kind: 'revisit', country: 'Peru' }, 'Peru, on their route']]);
    const here = screen.getByTitle('On the map now') as HTMLButtonElement;
    expect([here.disabled, here.getAttribute('aria-current')]).toEqual([true, 'true']);
  });
});

describe('the sights', () => {
  test('one at a time, with its words, its distance, a maps link, and the way on', () => {
    const { sent } = guide(sights());
    expect(screen.getByRole('heading', { name: 'Yasaka Shrine' })).toBeTruthy();
    expect(screen.getByText('A shrine at the end of Shijō street.')).toBeTruthy();
    expect(screen.getByText('about a 4 minute walk away')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href')).toContain('google.com/maps');
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    click('Next sight');
    expect(sent).toEqual([[{ kind: 'next' }, 'Next sight']]);
  });

  test('a sight with no photo shows a designed card, not a grey box with a letter', () => {
    guide(sights());
    expect(screen.getByRole('img', { name: 'No photo of this shrine yet' })).toBeTruthy();
    expect(screen.getByText('Open it in Maps to look around')).toBeTruthy();
    expect(document.querySelector('.yd-sight-photo')!.textContent).not.toBe('Y');
  });

  test('at the last sight there is no next one', () => {
    guide(sights({ spot: { ...sights().spot!, index: 1 } }));
    expect((screen.getByRole('button', { name: 'That was the last' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('a failed lookup can be tried again; a quiet place says so', () => {
    const { sent } = guide(sights({ spot: { ...sights().spot!, spot: null, total: 0, lookupFailed: true } }));
    expect(screen.getByText(/not answering/)).toBeTruthy();
    click('Try Gion again');
    expect(sent).toEqual([[{ kind: 'around', place: 'Gion' }, 'Try again, around Gion']]);
    cleanup();
    guide(sights({ spot: { ...sights().spot!, spot: null, total: 0, lookupFailed: false } }));
    expect(screen.getByText(/Nothing stands out around Gion/)).toBeTruthy();
  });

  test('wandering with no country yet', () => {
    guide(world({ stage: 'around', spot: sights().spot }));
    expect(screen.getByRole('heading', { level: 1, name: 'Gion' })).toBeTruthy();
    expect(screen.getByText('No country on your route yet')).toBeTruthy();
  });
});

describe('the trip, at the end', () => {
  const notes = notesFrom(notesFrom(emptyNotes(), japan({ food: { ...japan().food!, shown: true } })), sights());

  test('the route with what each stop showed, the sights with links, and the way to keep it', () => {
    const done: string[] = [];
    render(<TripSummary snapshot={japan({ travelerName: 'Sam' })} notes={notes} host="Lumi" ended onBack={() => done.push('back')} onDownload={() => done.push('download')} onNewTrip={() => done.push('new')} />);
    expect(screen.getByRole('heading', { level: 1, name: "Sam's trip" })).toBeTruthy();
    expect(screen.getByText('Your call has ended')).toBeTruthy();
    expect(screen.getByText(/Dreamt up with Lumi/)).toBeTruthy();
    expect(screen.getByText('Ramen')).toBeTruthy(); // Japan's dishes, from the notes
    expect(screen.getByText('Ceviche')).toBeTruthy(); // Peru's, from the route
    expect(screen.getByRole('link', { name: 'Yasaka Shrine' })).toBeTruthy();
    click('Download trip notes');
    click('Keep exploring');
    click('Start a new trip');
    expect(done).toEqual(['download', 'back', 'new']);
  });

  test('an empty trip has nothing to download', () => {
    render(<TripSummary snapshot={world()} notes={emptyNotes()} host="Lumi" ended={false} onBack={() => {}} onDownload={() => {}} onNewTrip={() => {}} />);
    expect(screen.getByText(/Nothing on your trip yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download trip notes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
