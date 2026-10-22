// @vitest-environment jsdom
// Every action the guide could take by voice has a control on the board. The
// Leaflet map is stubbed (it needs a real layout); its two callbacks are
// exercised through the stub.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Action, MapConfig, Snapshot } from '../engine/types.ts';
import { Board } from './Board.tsx';

vi.mock('./TravelMap.tsx', () => ({
  TravelMap: ({ mode, onPick, onSpot }: { mode: string; onPick: (what: string, lat: number, lon: number) => void; onSpot: (i: number) => void }) => (
    <div data-testid="map" data-mode={mode}>
      <button onClick={() => onPick('destination', 38.7, -9.1)}>map: plan a trip here</button>
      <button onClick={() => onPick('around', 38.7, -9.1)}>map: what's around here</button>
      <button onClick={() => onSpot(1)}>map: pin 2</button>
    </div>
  ),
}));

afterEach(cleanup);

const CONFIG: MapConfig = { tileUrl: 'https://tiles.test/{z}/{x}/{y}.png', attribution: 'OSM', maxZoom: 19 };
const base = (over: Partial<Snapshot> = {}): Snapshot => ({
  seq: 1, stage: 'welcome', travelerName: '', continent: '', awaitingPick: false, pending: false, newsAvailable: true,
  map: null, news: null, food: null, spot: null, trip: { current: '', visited: [] }, ...over,
});
const planning = (over: Partial<Snapshot> = {}) => base({
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
const around = (over: Partial<Snapshot> = {}) => base({
  stage: 'around',
  spot: {
    place: 'Kyoto', origin: [35, 135.77], index: 0, total: 2, lookupFailed: false,
    spot: { name: 'Kiyomizu-dera', category: 'temple', lat: 34.995, lon: 135.785, distance: 'about a 9 minute walk away', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=x', imageUrl: null, summary: 'A temple on a hillside.' },
    pins: [{ name: 'Kiyomizu-dera', category: 'temple', lat: 34.995, lon: 135.785 }, { name: 'Nishiki Market', category: 'attraction', lat: 35.005, lon: 135.765 }],
  },
  ...over,
});

function board(snapshot: Snapshot) {
  const actions: Action[] = [];
  render(<Board snapshot={snapshot} config={CONFIG} busy={false} onAction={(a) => actions.push(a)} />);
  return actions;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string, text: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
};

describe('planning a trip', () => {
  test('a destination, typed, chosen from the ideas, picked for them, or tapped on the map', () => {
    const actions = board(base());
    type('Destination', 'Kyoto, Japan');
    click('Japan');
    click('Surprise me');
    click('map: plan a trip here');
    expect(actions).toEqual([
      { kind: 'search', query: 'Kyoto, Japan' },
      { kind: 'destination', country: 'Japan' },
      { kind: 'pick' },
      { kind: 'destinationAt', lat: 38.7, lon: -9.1 },
    ]);
  });

  test('the ideas follow the continent they are drawn to', () => {
    board(base({ continent: 'South America' }));
    expect(screen.getByText('Ideas in South America')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Peru' })).toBeTruthy();
  });

  test('their name has a field until it is known, and then a greeting', () => {
    const actions = board(base());
    type('Your name', 'Sam');
    expect(actions).toEqual([{ kind: 'name', name: 'Sam' }]);
    cleanup();
    board(base({ travelerName: 'Sam' }));
    expect(screen.getAllByText('Hello Sam').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  test('headlines and dishes are a button each until they are shown', () => {
    const actions = board(planning());
    expect(screen.queryByText('Cherry blossom early')).toBeNull(); // staged for the guide, not on the board
    click('Show the latest headlines');
    click('What should I eat there?');
    expect(actions).toEqual([{ kind: 'news' }, { kind: 'food' }]);
    cleanup();
    board(planning({ news: { ...planning().news!, shown: true }, food: { ...planning().food!, shown: true } }));
    expect(screen.getByText('Cherry blossom early').closest('a')!.getAttribute('href')).toBe('https://nhk.test/1');
    expect(screen.getByText('Ramen')).toBeTruthy();
  });

  test('without a news source the board says so instead of offering a button that can only fail', () => {
    board(planning({ newsAvailable: false }));
    expect(screen.queryByRole('button', { name: /headlines/ })).toBeNull();
    expect(screen.getByText(/No news source is set up/)).toBeTruthy();
  });

  test('the trip strip takes them back; where they are is marked, not offered', () => {
    const actions = board(planning());
    click(/Peru/);
    expect(actions).toEqual([{ kind: 'revisit', country: 'Peru' }]);
    expect((screen.getByTitle('You are here') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelectorAll('.trip__shape path')).toHaveLength(1);
  });
});

describe('what is around them', () => {
  test('a place, typed, their location, or a tap on the map', () => {
    const geolocation = { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 48.85, longitude: 2.35 } } as GeolocationPosition) };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    const actions = board(base({ stage: 'around' }));
    type('Where you are', 'Shibuya station');
    click('Use my location');
    click("map: what's around here");
    expect(actions).toEqual([
      { kind: 'around', place: 'Shibuya station' },
      { kind: 'coords', lat: 48.85, lon: 2.35 },
      { kind: 'coords', lat: 38.7, lon: -9.1 },
    ]);
  });

  test('the next spot, the one before, or a pin', () => {
    const actions = board(around());
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    click('Next spot');
    click('map: pin 2');
    expect(actions).toEqual([{ kind: 'next' }, { kind: 'goto', index: 1 }]);
    expect(screen.getByText('A temple on a hillside.')).toBeTruthy();
    expect(screen.getByTitle('Open in Google Maps').getAttribute('href')).toContain('google.com/maps');
  });

  test('at the last spot there is no next one; going back is offered', () => {
    const actions = board(around({ spot: { ...around().spot!, index: 1 } }));
    expect((screen.getByRole('button', { name: 'No more spots nearby' }) as HTMLButtonElement).disabled).toBe(true);
    click('Previous');
    expect(actions).toEqual([{ kind: 'previous' }]);
  });

  test('a failed lookup and a quiet neighbourhood are different screens', () => {
    board(around({ spot: { ...around().spot!, spot: null, total: 0, lookupFailed: true } }));
    expect(screen.getByText(/not answering/)).toBeTruthy();
    cleanup();
    board(around({ spot: { ...around().spot!, spot: null, total: 0, lookupFailed: false } }));
    expect(screen.getByText(/Nothing stands out/)).toBeTruthy();
  });
});

test('the tabs switch the board, and the map follows what is on it', () => {
  const actions = board(planning());
  expect(screen.getByTestId('map').dataset.mode).toBe('country');
  fireEvent.click(screen.getByRole('tab', { name: 'Around me' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Plan a trip' })); // already there: nothing to do
  expect(actions).toEqual([{ kind: 'show', stage: 'around' }]);
  cleanup();
  board(around());
  expect(screen.getByTestId('map').dataset.mode).toBe('around');
  cleanup();
  board(base());
  expect(screen.getByTestId('map').dataset.mode).toBe('world');
});
