import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooth, GREETING_WAIT_MS, IDLE_MS, QUIET_MS, type Delivery } from './booth.ts';

function setup() {
  const sent: Delivery[] = [];
  const patched = vi.fn();
  const booth = createBooth({
    deliver: (d) => sent.push(d),
    patchIn: patched,
    states: { host: 'HOST', guest: 'GUEST' },
    intro: 'INTRO', wrap: 'WRAP', goodbye: 'BYE',
  });
  // An avatar speaking one utterance, then going quiet for a turn's end.
  const speak = (role: 'host' | 'guest', text: string) => {
    booth.speaking(role, true);
    booth.said(role, text);
    booth.speaking(role, false);
    vi.advanceTimersByTime(QUIET_MS);
  };
  return { booth, sent, patched, speak };
}

// The greeting done, the guest put through, the intro spoken and answered.
function onAir() {
  const s = setup();
  s.booth.hostLive();
  s.booth.guestLive();
  s.speak('host', 'Good evening!');
  s.speak('host', 'Tonight, Frank. Frank, welcome!');
  s.speak('guest', 'Thanks, Nico.');
  s.sent.length = 0;
  return s;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the opening', () => {
  it('puts the guest through after the greeting and only then cues the intro', () => {
    const { booth, sent, patched, speak } = setup();
    booth.hostLive();
    speak('host', 'Good evening, night owls!');
    expect(booth.stage).toBe('dialing');
    expect(patched).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    booth.guestLive();
    expect(patched).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ to: 'host', kind: 'event', text: 'INTRO' }]);
    expect(booth.stage).toBe('on-air');
  });

  it('waits for the greeting even when the guest is up first', () => {
    const { booth, sent, patched, speak } = setup();
    booth.hostLive();
    booth.guestLive();
    speak('guest', 'Malone, Homicide. Grab a coffee.');   // its own greeting, off air
    booth.speaking('host', true);
    booth.said('host', 'Good evening,');
    vi.advanceTimersByTime(QUIET_MS * 3);
    expect(patched).not.toHaveBeenCalled();
    booth.speaking('host', false);
    vi.advanceTimersByTime(QUIET_MS);
    expect(patched).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ to: 'host', kind: 'event', text: 'INTRO' }]);
  });

  it('goes on without a greeting when the host says nothing', () => {
    const { booth, sent } = setup();
    booth.hostLive();
    booth.guestLive();
    vi.advanceTimersByTime(GREETING_WAIT_MS);
    expect(sent).toEqual([{ to: 'host', kind: 'event', text: 'INTRO' }]);
  });
});

describe("the producer's topics", () => {
  it("ride on the host's next turn as a directive, which comes off once that turn is over", () => {
    const { booth, sent, speak } = onAir();
    booth.speaking('guest', true);   // the guest is talking
    booth.cue('TOPIC');
    expect(sent).toEqual([{ to: 'host', kind: 'state', text: 'HOST\n\nFor your next turn only: TOPIC' }]);
    booth.said('guest', 'A long story.');
    booth.speaking('guest', false);
    vi.advanceTimersByTime(QUIET_MS);
    speak('host', 'Wow. Now, the topic?');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'state', text: 'HOST' });
    expect(sent).toHaveLength(2);
  });

  it('keep the directive through a host turn that had begun before the cue', () => {
    const { booth, sent, speak } = onAir();
    booth.speaking('host', true);
    booth.cue('TOPIC');
    booth.said('host', 'Still answering.');
    booth.speaking('host', false);
    vi.advanceTimersByTime(QUIET_MS);
    expect(sent).toHaveLength(1);   // the directive, still on
    speak('guest', 'Sure.');
    speak('host', 'The topic.');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'state', text: 'HOST' });
  });

  it('go out as an event when the floor is quiet', () => {
    const { booth, sent } = onAir();
    vi.advanceTimersByTime(IDLE_MS);
    booth.cue('TOPIC');
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ to: 'host', kind: 'event', text: 'TOPIC' }]);
  });

  it('merge a second cue into the one waiting', () => {
    const { booth, sent } = onAir();
    booth.speaking('guest', true);
    booth.cue('ONE');
    booth.cue('TWO');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'state', text: 'HOST\n\nFor your next turn only: ONE TWO' });
  });
});

describe('the wrap', () => {
  it('has the host close, then the guest say goodbye, then the show is over', () => {
    const { booth, sent, speak } = onAir();
    booth.speaking('guest', true);
    booth.wrap();
    expect(sent).toEqual([{ to: 'host', kind: 'state', text: 'HOST\n\nFor your next turn only: WRAP' }]);
    booth.said('guest', 'And that was that.');
    booth.speaking('guest', false);
    vi.advanceTimersByTime(QUIET_MS);
    speak('host', 'Thanks Frank, goodnight everyone!');
    expect(booth.stage).toBe('closing');
    expect(sent.slice(1)).toEqual([
      { to: 'host', kind: 'state', text: 'HOST' },
      { to: 'guest', kind: 'state', text: 'GUEST\n\nFor your next turn only: BYE' },
    ]);
    speak('guest', 'Goodnight, Nico.');
    expect(booth.stage).toBe('over');
  });

  it('waits for the host\'s turn when he is only slow to answer', () => {
    const { booth, sent, speak } = onAir();
    vi.advanceTimersByTime(5_000);   // the guest is done; the host's reply is still on its way
    booth.wrap();
    expect(sent).toEqual([{ to: 'host', kind: 'state', text: 'HOST\n\nFor your next turn only: WRAP' }]);
    speak('host', 'Thanks, Lumi, goodnight!');
    expect(booth.stage).toBe('closing');
  });

  it('is spoken at once on a quiet floor', () => {
    const { booth, sent, speak } = onAir();
    vi.advanceTimersByTime(IDLE_MS);
    booth.wrap();
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ to: 'host', kind: 'event', text: 'WRAP' }]);
    speak('host', 'Goodnight!');
    expect(booth.stage).toBe('closing');
  });

  it('ends the show at once before the guest is on', () => {
    const { booth } = setup();
    booth.wrap();
    expect(booth.stage).toBe('over');
  });
});
