// @vitest-environment jsdom
//
// The range screen as a projection: snapshots in, presses out, nothing decided
// here (from the panel's RangePanel.test.tsx). What these protect is the seam:
// the screen shows numbers it was given rather than numbers it worked out, it
// cannot show a result while the shot is in the air, the lesson waits until it
// is earned, and a refusal always ends up on the screen.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Press } from '../engine/controls.ts';
import type { RangeSnapshot } from '../engine/types.ts';
import { Board, Brief, Console, Lesson, Result, Syllabus, conditionsOf } from './Board.tsx';
import { IN_FLIGHT, LANDED, snapshot } from './fixtures.ts';
import { useRange } from './useRange.ts';

beforeAll(() => {
  // jsdom has no 2-D context; the drawing is not under test here.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

function Screen({ state, live = true, message = '', onPress }: { state: RangeSnapshot; live?: boolean; message?: string; onPress: (p: Press) => void }) {
  return (
    <>
      <Brief state={state} />
      <Board state={state} seq={1} locked={live ? null : 'Theo is on his way to the range…'} onPress={onPress} />
      <Console state={state} seq={1} live={live} onPress={onPress} />
      <Result state={state} message={message} />
      <Lesson state={state} live={live} allCleared={false} onPress={onPress} onLogbook={() => {}} />
      <Syllabus state={state} live={live} onPress={onPress} />
    </>
  );
}

function show(over: Partial<RangeSnapshot> = {}, props: { live?: boolean; message?: string } = {}) {
  const onPress = vi.fn<(p: Press) => void>();
  const view = render(<Screen state={snapshot(over)} onPress={onPress} {...props} />);
  return { onPress, ...view };
}

describe('the range screen, on the range\'s authority', () => {
  it("shows the challenge, the aim and the range's numbers for the last shot", () => {
    show();
    expect(screen.getByRole('heading', { name: 'Clear the wall' })).toBeTruthy();
    expect(screen.getByText('45°')).toBeTruthy();
    expect(screen.getByText('20 m/s')).toBeTruthy();
    expect(screen.getByText('40.77 m')).toBeTruthy();
    expect(screen.getByText('10.19 m')).toBeTruthy();
    expect(screen.getByText('2.88 s')).toBeTruthy();
    expect(screen.getByText('Missed by 2.65 m')).toBeTruthy();
    expect(screen.getByText(LANDED.note!)).toBeTruthy();
  });

  it('cannot show a result while the shot is in the air, because it has none', () => {
    show({ phase: 'flying', last_shot: IN_FLIGHT, history: [] });
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(screen.queryByText(/40\.77/)).toBeNull();
    expect(screen.queryByText(/below the top/)).toBeNull();
    expect(button(/In the air/).disabled).toBe(true);   // and no second shot while one is up
    expect(button('Angle up one degree').disabled).toBe(true);
  });

  it('never claims a result the snapshot does not carry, whatever the phase says', () => {
    show({ phase: 'scored', last_shot: IN_FLIGHT, history: [] });
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(screen.queryByText(/Missed by|Cleared/)).toBeNull();
  });

  it('names the conditions that matter', () => {
    expect(conditionsOf(snapshot())).toEqual(['g 9.81 m/s²', 'No wind']);
    const moon = snapshot({ challenge: { ...snapshot().challenge, gravity: 1.62, wind_ms: -6, ceiling_m: 6 }, limits: { angle: [5, 85], speed: [5, 18] } });
    expect(conditionsOf(moon)).toEqual(['g 1.62 m/s² · the Moon', '6 m/s headwind', 'Roof at 6 m', 'Speed capped at 18 m/s']);
  });

  it('the lesson appears only when the range sends it, with the way on', () => {
    const { rerender, onPress } = show();
    expect(screen.queryByText(/maximises range/)).toBeNull();
    const teach = 'Forty-five degrees maximises range, and range is not what a wall asks for.';
    rerender(<Screen state={snapshot({ phase: 'debrief', challenge: { ...snapshot().challenge, teach } })} onPress={onPress} />);
    expect(screen.getByText(teach)).toBeTruthy();
    fireEvent.click(button(/Next challenge/));
    expect(onPress).toHaveBeenCalledWith({ kind: 'next' });
  });

  it('Fire asks for one shot and changes nothing itself', () => {
    const { onPress } = show();
    fireEvent.click(button('Fire'));
    expect(onPress.mock.calls).toEqual([[{ kind: 'fire' }]]);
    expect(screen.getByText('40.77 m')).toBeTruthy();
  });

  it('the steppers aim one degree or one metre a second at a time, and stop at the limits', () => {
    const { onPress, rerender } = show();
    fireEvent.click(button('Angle up one degree'));
    fireEvent.click(button('Speed down one metre a second'));
    expect(onPress.mock.calls).toEqual([[{ kind: 'aim', angle_deg: 46, speed_ms: 20 }], [{ kind: 'aim', angle_deg: 45, speed_ms: 19 }]]);
    rerender(<Screen state={snapshot({ aim: { angle_deg: 85, speed_ms: 5 } })} onPress={onPress} />);
    expect(button('Angle up one degree').disabled).toBe(true);
    expect(button('Speed down one metre a second').disabled).toBe(true);
  });

  it('a refusal is on the screen, and the aim stays where it was', () => {
    show({}, { message: 'The launcher only elevates between 5 and 85 degrees — 90 is off the rail.' });
    expect(screen.getByRole('status').textContent).toContain('90 is off the rail');
    expect(screen.getByText('45°')).toBeTruthy();
  });

  it('a challenge in the list asks for that challenge; start over waits for a shot', () => {
    const { onPress } = show();
    fireEvent.click(button(/Land in the zone/));
    expect(onPress.mock.calls).toEqual([[{ kind: 'challenge', id: 'zone30' }]]);
    cleanup();
    show({ attempts: 0, history: [], last_shot: null });
    expect(button('Start over').disabled).toBe(true);
    expect(screen.getByText(/No shot yet/)).toBeTruthy();
  });

  it('until Theo is on the call, the launcher is locked and says why', () => {
    show({}, { live: false });
    expect(screen.getByText('Theo is on his way to the range…')).toBeTruthy();
    for (const name of ['Fire', /Land in the zone/, 'Start over', 'Angle up one degree']) expect(button(name).disabled, String(name)).toBe(true);
  });
});

describe('on a real range: the page owns the clock that lands the shot', () => {
  function Harness({ start = null }: { start?: string | null }) {
    const r = useRange(start, { tell: () => {} });
    return <Screen state={r.state} message={r.message} onPress={(p) => { r.controls.press(p); }} />;
  }

  it('Fire: in the air for the play time, then the verdict, the numbers and the sentence together', () => {
    vi.useFakeTimers();
    render(<Harness />);
    expect(screen.getByText(/No shot yet/)).toBeTruthy();
    fireEvent.click(button('Fire'));
    expect(screen.getByText('In the air…')).toBeTruthy();
    expect(screen.queryByText(/below the top/)).toBeNull();
    act(() => { vi.advanceTimersByTime(2_500); });   // the animation's length: still not down
    expect(screen.getByText('In the air…')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('Missed by 2.24 m')).toBeTruthy();
    expect(screen.getByText(/You were at 0\.76 m going past 40 m, 2\.24 m below the top/)).toBeTruthy();
  });

  it('?challenge= opens on that challenge, like the original\'s startChallenge', () => {
    render(<Harness start="moonshot" />);
    expect(screen.getByRole('heading', { name: 'On the Moon' })).toBeTruthy();
    expect(screen.getByText('12 m/s')).toBeTruthy();
  });
});
