// @vitest-environment jsdom
/**
 * The chart's screen as a projection: a view in, intents out, nothing decided
 * here. Ported from the original panel's SkyGuide.test.tsx (taps, the
 * keyboard list, the held clock, the place picker, the figure buttons), to
 * the rebuilt components.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Notice } from '../engine/actions.ts';
import type { NightEntry } from '../engine/night.ts';
import type { FigureStatus, Intent, SkySnapshot, SkyView } from '../engine/types.ts';
import { Dome, NightStrip, NoticeBar, Side, SkyHeader } from './Chart.tsx';
import { NIGHT } from './SkyDome.tsx';

const SIRIUS = { id: 'sirius', name: 'Sirius', alt: 34.2, az: 128.5, mag: -1.46, con: 'CMa' };
const VEGA = { id: 'vega', name: 'Vega', alt: 71.4, az: 12.0, mag: 0.03, con: 'Lyr' };

function snapshot(over: Partial<SkySnapshot> = {}): SkySnapshot {
  return {
    where: { label: 'Taipei', lat: 25.03, lon: 121.56 },
    when: { epoch: 1785931200, label: '9:00 pm, Wed 5 Aug' },
    visible: [SIRIUS, VEGA],
    figure: null,
    selected: null,
    fact: null,
    catalog_size: 135,
    ...over,
  };
}

const FIGURES: FigureStatus[] = [
  { con: 'Lyr', name: 'Lyra', up: true, anchor: VEGA, rise: '' },
  { con: 'Ori', name: 'Orion', up: false, anchor: null, rise: 'it rises about half past 2 in the morning' },
];

function view(over: Partial<SkySnapshot> = {}, night = { date: '2026-08-05', hours: 21 }): SkyView {
  return { snapshot: snapshot(over), figures: FIGURES, spokenWhen: 'about 9 in the evening', solarTime: false, night };
}

/** The chart's screen as the app lays it out. */
function Screen({ v, notice = null, night = [], tab = 'star', onIntent, onLater = () => undefined, working = false }: {
  v: SkyView; notice?: Notice | null; night?: NightEntry[]; tab?: 'star' | 'night'; onIntent: (i: Intent) => void; onLater?: (n: Notice) => void; working?: boolean;
}) {
  return (
    <>
      <SkyHeader view={v} working={working} host="Mira" onIntent={onIntent} />
      <Dome view={v} palette={NIGHT} onIntent={onIntent} />
      <NoticeBar notice={notice} tz={8} onLater={onLater} onDismiss={() => undefined} />
      <NightStrip view={v} onIntent={onIntent} />
      <Side view={v} night={night} tab={tab} host="Mira" onTab={() => undefined} onIntent={onIntent} />
    </>
  );
}

function setup(v: SkyView = view(), extra: Partial<Parameters<typeof Screen>[0]> = {}) {
  const intents: Intent[] = [];
  const utils = render(<Screen v={v} onIntent={(intent) => intents.push(intent)} {...extra} />);
  return { intents, ...utils };
}

/** jsdom has no PointerEvent, so fireEvent.pointerDown drops the coordinates. */
function tapAt(element: Element, x: number, y: number) {
  fireEvent(element, new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
}

/** jsdom measures every element as zero; this is the box the canvas pretends to be. */
function sizeTheCanvas(width = 300, height = 300) {
  const box = () => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', { configurable: true, value: box });
  Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', { configurable: true, value: box });
}

beforeAll(() => {
  // jsdom has no 2D context; the dome must still render its text and stay tappable.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(cleanup);

describe('where and when', () => {
  it('shows the place, the clock and how much of the sky is up, at once', () => {
    setup();
    expect((screen.getByLabelText('The sky from') as HTMLSelectElement).value).toBe('taipei');
    expect(screen.getByText('9:00 pm')).toBeTruthy();
    expect(screen.getByText('Wed 5 Aug')).toBeTruthy();
    expect(screen.getByText(/of 135 stars up/).textContent).toBe('2 of 135 stars up');
  });

  it('says Mira is checking the catalogue while a model reads a name', () => {
    setup(view(), { working: true });
    expect(screen.getByText('Mira is checking the catalogue…')).toBeTruthy();
  });

  it('moves the observer to a listed place', () => {
    const { intents } = setup();
    const picker = screen.getByLabelText('The sky from') as HTMLSelectElement;
    expect(picker.options).toHaveLength(42);   // 41 places and "Somewhere else"
    fireEvent.change(picker, { target: { value: 'lisbon' } });
    expect(intents).toEqual([{ kind: 'set_place', label: 'Lisbon' }]);
  });

  it('takes a latitude and longitude, and leaves judging them to the chart', () => {
    const { intents } = setup();
    fireEvent.change(screen.getByLabelText('The sky from'), { target: { value: 'coords' } });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '-33.9' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '18.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(intents).toEqual([{ kind: 'set_place', lat: '-33.9', lon: '18.4' }]);
  });

  it('shows coordinates as the current place when the chart is at them, with solar time', () => {
    setup({ ...view({ where: { label: '33.9°S 18.4°E', lat: -33.9, lon: 18.4 } }), solarTime: true });
    expect((screen.getByLabelText('The sky from') as HTMLSelectElement).selectedOptions[0].textContent).toBe('33.9°S 18.4°E');
    expect(screen.getByText(/solar time/)).toBeTruthy();
  });
});

describe('the dome', () => {
  it('turns a tap on a star into one select intent and nothing else', async () => {
    sizeTheCanvas();
    const { intents, container } = setup();
    const canvas = container.querySelector('canvas')!;
    // Vega at altitude 71.4, azimuth 12: just above and a little left of centre.
    const r = ((90 - 71.4) / 90) * 132;   // domeFor(300, 300) pads by 18
    const x = 150 - r * Math.sin((12 * Math.PI) / 180);
    const y = 150 - r * Math.cos((12 * Math.PI) / 180);
    await act(async () => tapAt(canvas, x, y));
    expect(intents).toEqual([{ kind: 'select', star: 'vega' }]);
  });

  it('sends nothing for a tap on empty sky', async () => {
    sizeTheCanvas();
    const { intents, container } = setup();
    await act(async () => tapAt(container.querySelector('canvas')!, 2, 2));
    expect(intents).toEqual([]);
  });

  it('reaches every star from the keyboard too (the canvas is invisible to a screen reader)', () => {
    const { intents } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sirius' }));
    expect(intents).toEqual([{ kind: 'select', star: 'sirius' }]);
  });

  it('says when the chart shows the daytime, with a way to tonight', () => {
    setup();
    expect(screen.queryByText(/daytime in/)).toBeNull();
    cleanup();
    const { intents } = setup(view({ where: { label: 'Lisbon', lat: 38.72, lon: -9.14 } }, { date: '2026-08-05', hours: 13 }));
    expect(screen.getByText(/It's daytime in Lisbon/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See tonight' }));
    expect(intents).toEqual([{ kind: 'set_time', preset: 'tonight' }]);
  });
});

describe('a clock that never moves on its own, and every way to move it', () => {
  it('steps an hour either way, back to tonight, midnight and before dawn', () => {
    const { intents } = setup();
    fireEvent.click(screen.getByLabelText('An hour later'));
    fireEvent.click(screen.getByLabelText('An hour earlier'));
    fireEvent.click(screen.getByLabelText('Back to this evening'));
    fireEvent.click(screen.getByRole('button', { name: 'Midnight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Before dawn' }));
    expect(intents).toEqual([
      { kind: 'set_time', shiftHours: 1 },
      { kind: 'set_time', shiftHours: -1 },
      { kind: 'set_time', preset: 'tonight' },
      { kind: 'set_time', preset: 'midnight' },
      { kind: 'set_time', preset: 'dawn' },
    ]);
  });

  it('scrubs the hour across the night and picks the night itself', () => {
    const { intents } = setup();
    const strip = screen.getByLabelText('Hour of the night') as HTMLInputElement;
    expect(strip.value).toBe('21');
    expect(strip.getAttribute('aria-valuetext')).toBe('about 9 in the evening');
    fireEvent.change(strip, { target: { value: '26' } });
    fireEvent.change(screen.getByDisplayValue('2026-08-05'), { target: { value: '2026-12-21' } });
    expect(intents).toEqual([{ kind: 'set_time', nightHours: 26 }, { kind: 'set_time', date: '2026-12-21' }]);
  });
});

describe('the chart\'s own word', () => {
  it('shows a refusal, and offers the hour when the thing is well up', () => {
    const later: Notice[] = [];
    const notice: Notice = { text: "Orion isn't up at this hour from Taipei — it rises about half past 2 in the morning.", later: 1785961800, retry: { kind: 'show_constellation', name: 'Orion' } };
    setup(view(), { notice, onLater: (n) => later.push(n) });
    expect(screen.getByRole('status').textContent).toContain("Orion isn't up at this hour");
    fireEvent.click(screen.getByRole('button', { name: 'Show the sky at 4:30 am' }));
    expect(later).toEqual([notice]);
  });

  it('offers nothing when there is no good hour', () => {
    setup(view(), { notice: { text: "I don't know Kyoto.", later: null } });
    expect(screen.queryByRole('button', { name: /Show the sky at/ })).toBeNull();
  });
});

describe('the side: the marked star, your night, the figures', () => {
  it('invites a tap when nothing is marked, with the brightest up as one-tap marks', () => {
    const { intents } = setup();
    expect(screen.getByText('No star marked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Sirius' }));
    expect(intents).toEqual([{ kind: 'select', star: 'sirius' }]);
  });

  it('shows the marked star\'s name, where to look and the catalogue\'s lines, and unmarks it', () => {
    const fact = { title: 'Vega', lines: ['The bright blue-white star overhead on northern summer nights, in the Summer Triangle.', 'In Lyra, at magnitude 0.03 — brilliant.'] };
    const { intents } = setup(view({ selected: 'vega', fact }));
    expect(screen.getByRole('heading', { name: 'Vega' })).toBeTruthy();
    expect(screen.getByText(/almost overhead in the north/)).toBeTruthy();
    expect(screen.getByText(fact.lines[0])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unmark' }));
    expect(intents).toEqual([{ kind: 'clear_selection' }]);
  });

  it('lists your night by place and hour, with a download', () => {
    const night: NightEntry[] = [{ id: 'a', kind: 'star', name: 'Vega', place: 'Taipei', when: '9:00 pm, Wed 5 Aug', where: 'high up in the north-east', note: 'A line.' }];
    setup(view(), { night, tab: 'night' });
    expect(screen.getByText('Taipei · 9:00 pm, Wed 5 Aug')).toBeTruthy();
    expect(screen.getByText('high up in the north-east')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download the list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Your night · 1' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('lights an up figure, unlights a lit one, and still offers a down one (the chart says when it rises)', () => {
    const { intents, rerender } = setup();
    expect(screen.getByText('1 of 2 up')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lyra' }));
    const orion = screen.getByRole('button', { name: 'Orion' });
    expect(orion.className).toContain('is-down');
    expect(orion.getAttribute('title')).toBe('Not up: it rises about half past 2 in the morning');
    fireEvent.click(orion);
    rerender(<Screen v={view({ figure: { con: 'Lyr', name: 'Lyra', lines: [['vega', 'sirius']] } })} onIntent={(intent) => intents.push(intent)} />);
    expect(screen.getByRole('button', { name: 'Lyra' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Lyra' }));
    expect(intents).toEqual([
      { kind: 'show_constellation', name: 'Lyr' },
      { kind: 'show_constellation', name: 'Ori' },
      { kind: 'clear_figure' },
    ]);
  });
});

// Stars (the keyboard list), marks and figures share one screen: no button
// name may mean two things.
it('never offers the same button name twice', () => {
  setup();
  const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
  expect(new Set(names).size).toBe(names.length);
});

it('the notice can be dismissed', () => {
  const dismiss = vi.fn();
  render(<NoticeBar notice={{ text: 'No.', later: null }} tz={8} onLater={() => undefined} onDismiss={dismiss} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(dismiss).toHaveBeenCalled();
});
