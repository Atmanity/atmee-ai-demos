// @vitest-environment jsdom
//
// The panel as a projection: snapshots in, intents out, nothing decided here
// (ported from the panel's RangePanel.test.tsx; the scripted agent is now
// props, and a real range stands in for the agent where the clock matters).
// What these protect is the seam: the panel shows numbers it was given rather
// than numbers it worked out, it cannot show a result while the shot is in the
// air, and a refusal always ends up on the screen.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Intent, Result, Source } from '../engine/types.ts';
import { RangePanel } from './RangePanel.tsx';
import { IN_FLIGHT, LANDED, snapshot } from './fixtures.ts';
import { useRange } from './useRange.ts';

beforeAll(() => {
  // jsdom has no 2-D context and says so loudly; the drawing is not under test here.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

function panel(over: Parameters<typeof snapshot>[0] = {}, props: Partial<Parameters<typeof RangePanel>[0]> = {}) {
  const onIntent = vi.fn<(intent: Intent) => void>();
  const view = render(<RangePanel state={snapshot(over)} seq={1} live message="" onIntent={onIntent} {...props} />);
  return { onIntent, ...view };
}

describe('RangePanel on the range\'s authority', () => {
  it("shows the challenge, the aim and the range's numbers for the last shot", () => {
    panel();
    // Twice on purpose: the challenge on the header and its chip in the list.
    expect(screen.getAllByText('Clear the wall')).toHaveLength(2);
    expect(screen.getByText('45° · 20 m/s')).toBeTruthy();
    expect(screen.getByText('40.77 m · apex 10.19 m · 2.88 s')).toBeTruthy();
    expect(screen.getByText(LANDED.note!)).toBeTruthy();
    expect(screen.getByText('best miss 2.65 m')).toBeTruthy();
  });

  it('cannot show a result while the shot is in the air, because it has none', () => {
    panel({ phase: 'flying', last_shot: IN_FLIGHT, history: [] });
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(screen.queryByText(/40\.77/)).toBeNull();
    expect(screen.queryByText(/below the top/)).toBeNull();
    // And firing again is not offered while one is up.
    expect(button('In the air').disabled).toBe(true);
  });

  it('the teaching point appears only when the range sends it, with the way on', () => {
    const { rerender, onIntent } = panel();
    expect(screen.queryByText(/maximises range/)).toBeNull();
    const teach = 'Forty-five degrees maximises range, and range is not what a wall asks for.';
    rerender(<RangePanel state={snapshot({ phase: 'debrief', challenge: { ...snapshot().challenge, teach } })} seq={2} live message="" onIntent={onIntent} />);
    expect(screen.getByText(/maximises range/)).toBeTruthy();
    fireEvent.click(button(/Next challenge/));
    expect(onIntent).toHaveBeenCalledWith({ kind: 'next_challenge' });
  });

  it('firing asks for exactly one intent and applies nothing locally', () => {
    const { onIntent } = panel();
    fireEvent.click(button('Fire'));
    expect(onIntent.mock.calls).toEqual([[{ kind: 'fire' }]]);
    // Still the same readout: the panel does not guess what the shot did.
    expect(screen.getByText('40.77 m · apex 10.19 m · 2.88 s')).toBeTruthy();
  });

  it('a refusal is a message on the range, and the aim stays where it was', () => {
    panel({}, { message: "That's past what this launcher does — 5 to 40 metres a second." });
    expect(screen.getByText(/5 to 40 metres a second/)).toBeTruthy();
    expect(screen.getByText('45° · 20 m/s')).toBeTruthy();
  });

  it('a challenge chosen by voice arrives as a new snapshot, with no intent from here', () => {
    const { rerender, onIntent } = panel();
    rerender(<RangePanel
      state={snapshot({
        phase: 'aiming', last_shot: null, attempts: 0, best_miss_m: null, history: [],
        challenge: { id: 'zone30', name: 'Land in the zone', blurb: 'A four-metre landing zone centred thirty metres out.', target: { kind: 'zone', x_m: 30, w_m: 4 }, wind_ms: 0, gravity: 9.81, ceiling_m: null },
      })}
      seq={2} live message="" onIntent={onIntent}
    />);
    expect(screen.getAllByText('Land in the zone')).toHaveLength(2);
    expect(screen.getByText('No shot yet.')).toBeTruthy();
    expect(onIntent).not.toHaveBeenCalled();
  });

  it('a challenge chip asks for start_challenge with that id', () => {
    const { onIntent } = panel();
    fireEvent.click(button('Land in the zone'));
    expect(onIntent.mock.calls).toEqual([[{ kind: 'start_challenge', id: 'zone30' }]]);
  });

  it('start over is offered only once there is something to clear', () => {
    panel({ attempts: 0, history: [], last_shot: null });
    expect(button('Start over').disabled).toBe(true);
  });

  it('before the session is on, the launcher is locked and says so', () => {
    panel({}, { live: false });
    expect(screen.getByText(/Start the session to step up to the launcher/)).toBeTruthy();
    for (const name of ['Fire', 'Land in the zone', 'Start over']) expect(button(name).disabled, name).toBe(true);
  });

  it('while the app works out what a line meant, the hint says so', () => {
    panel({}, { thinking: true });
    expect(screen.getByText('Working out what you meant…')).toBeTruthy();
  });
});

describe('the panel on a real range: the page owns the clock that lands the shot', () => {
  let dispatch: (intent: Intent, by: Source) => Result = () => { throw new Error('not mounted'); };
  function Harness({ start = null }: { start?: string | null }) {
    const range = useRange(start);
    dispatch = range.dispatch;
    return <RangePanel state={range.state} seq={range.seq} live message={range.message} onIntent={(i) => { range.dispatch(i, 'panel'); }} />;
  }

  it('Fire: in the air for the play time, then the verdict, the note and the score together', () => {
    vi.useFakeTimers();
    render(<Harness />);
    expect(screen.getByText('No shot yet.')).toBeTruthy();
    fireEvent.click(button('Fire'));
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(button('In the air').disabled).toBe(true);
    expect(screen.queryByText(/below the top/)).toBeNull();
    act(() => { vi.advanceTimersByTime(2_500); });   // the animation's length: still not down
    expect(screen.getByText('In the air…')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('40.77 m · apex 10.19 m · 2.88 s')).toBeTruthy();
    expect(screen.getByText(/You were at 0\.76 m going past 40 m, 2\.24 m below the top/)).toBeTruthy();
    expect(screen.getByText('1 shot')).toBeTruthy();
    expect(screen.getByText('best miss 2.24 m')).toBeTruthy();
  });

  it('a spoken aim the range refused is on the panel, and the next action clears it', () => {
    vi.useFakeTimers();
    render(<Harness start="maxrange" />);
    act(() => { dispatch({ kind: 'set_aim', speed_ms: 30 }, 'spoken'); });
    expect(screen.getByRole('status').textContent).toBe("That's past what this launcher does — 5 to 18 metres a second.");
    expect(screen.getByText('30° · 18 m/s')).toBeTruthy();
    fireEvent.click(button('Fire'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('?challenge= opens on that challenge, like the original\'s startChallenge', () => {
    render(<Harness start="moonshot" />);
    expect(screen.getAllByText('On the Moon')).toHaveLength(2);
    expect(screen.getByText('45° · 12 m/s')).toBeTruthy();
  });
});
