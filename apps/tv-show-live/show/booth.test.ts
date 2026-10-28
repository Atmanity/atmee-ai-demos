import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooth, GREETING_WAIT_MS, IDLE_MS, TURN_QUIET_MS, type Delivery } from './booth.ts';

function setup() {
  const sent: Delivery[] = [];
  const dial = vi.fn();
  const booth = createBooth({ deliver: (d) => sent.push(d), dialGuest: dial, intro: 'INTRO', wrap: 'WRAP', goodbye: 'BYE' });
  const turn = (role: 'host' | 'guest') => {
    booth.speaking(role, true);
    vi.advanceTimersByTime(2000);
    booth.speaking(role, false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
  };
  return { booth, sent, dial, turn };
}

function onAir() {
  const s = setup();
  s.booth.hostLive();
  s.turn('host');            // the greeting
  s.booth.guestLive();
  s.turn('guest');           // "can you hear me?"
  s.turn('host');            // the intro
  s.sent.length = 0;
  return s;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the opening', () => {
  it('directs the intro and dials the guest once the greeting is over', () => {
    const { booth, sent, dial, turn } = setup();
    booth.hostLive();
    turn('host');
    expect(sent).toEqual([{ to: 'host', kind: 'directive', text: 'INTRO' }]);
    expect(dial).toHaveBeenCalledOnce();
    expect(booth.stage).toBe('dialing');
    booth.guestLive();
    expect(booth.stage).toBe('on-air');
  });

  it('takes the intro directive off after the host has introduced the guest', () => {
    const { booth, sent, turn } = setup();
    booth.hostLive();
    turn('host');
    booth.guestLive();
    turn('guest');
    turn('host');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: '' });
  });

  it('dials the guest anyway when the host never greets', () => {
    const { booth, dial } = setup();
    booth.hostLive();
    vi.advanceTimersByTime(GREETING_WAIT_MS);
    expect(dial).toHaveBeenCalledOnce();
  });
});

describe("the producer's cues", () => {
  it("direct the host's next turn and come off once that turn is over", () => {
    const { booth, sent, turn } = onAir();
    booth.speaking('guest', true);
    booth.cue('TOPIC');
    expect(sent).toEqual([{ to: 'host', kind: 'directive', text: 'TOPIC' }]);
    booth.speaking('guest', false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
    turn('host');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: '' });
  });

  it('keep the directive through a host turn that began before the cue', () => {
    const { booth, sent, turn } = onAir();
    booth.speaking('host', true);
    booth.cue('TOPIC');
    booth.speaking('host', false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
    expect(sent).toHaveLength(1);
    turn('guest');
    turn('host');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: '' });
  });

  it('are spoken as commentary when the conversation has stalled', () => {
    const { booth, sent } = onAir();
    booth.cue('TOPIC');
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent).toEqual([
      { to: 'host', kind: 'directive', text: 'TOPIC' },
      { to: 'host', kind: 'commentary', text: 'TOPIC' },
    ]);
  });

  it('are not spoken over a reply that is only slow to start', () => {
    const { booth, sent, turn } = onAir();
    vi.advanceTimersByTime(5000);
    booth.cue('TOPIC');
    vi.advanceTimersByTime(3000);
    turn('host');
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent.filter((d) => d.kind === 'commentary')).toEqual([]);
  });
});

describe('the wrap', () => {
  it('has the host close, then directs the guest to say goodbye, then the show is over', () => {
    const { booth, sent, turn } = onAir();
    booth.speaking('guest', true);
    booth.wrap();
    booth.speaking('guest', false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
    turn('host');
    expect(booth.stage).toBe('closing');
    expect(sent.slice(-2)).toEqual([
      { to: 'host', kind: 'directive', text: '' },
      { to: 'guest', kind: 'directive', text: 'BYE' },
    ]);
    turn('guest');
    expect(booth.stage).toBe('over');
  });

  it('ends the show at once before the guest is on', () => {
    const { booth } = setup();
    booth.wrap();
    expect(booth.stage).toBe('over');
  });
});
