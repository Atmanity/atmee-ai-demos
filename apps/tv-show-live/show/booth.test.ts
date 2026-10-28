import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooth, DIRECTIVE_LEAD_MS, GOODBYE_WAIT_MS, GREETING_WAIT_MS, IDLE_MS, NUDGES, SPEAK_UP_MS, TURN_QUIET_MS, type Delivery } from './booth.ts';

const REPLY_DELAY_MS = DIRECTIVE_LEAD_MS + 500;

function setup() {
  const sent: Delivery[] = [];
  const dial = vi.fn();
  const roll = vi.fn();
  const booth = createBooth({ deliver: (d) => sent.push(d), dialGuest: dial, rollTrailer: roll, film: 'FILM', invite: 'INVITE', welcome: 'WELCOME', nudge: 'NUDGE', wrap: 'WRAP', goodbye: 'BYE' });
  // A turn: a moment to start (a reply takes a few seconds to make), speech, then quiet.
  const turn = (role: 'host' | 'guest') => {
    vi.advanceTimersByTime(REPLY_DELAY_MS);
    booth.speaking(role, true);
    vi.advanceTimersByTime(2000);
    booth.speaking(role, false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
  };
  return { booth, sent, dial, roll, turn };
}

function onAir() {
  const s = setup();
  s.booth.hostLive();
  s.turn('host');            // the greeting
  s.turn('host');            // the film, "roll the trailer"
  s.booth.trailerDone();
  s.turn('host');            // the invitation
  s.booth.guestLive();
  s.turn('guest');           // "can you hear me?"
  s.turn('host');            // the welcome
  s.sent.length = 0;
  return s;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the opening', () => {
  it('has her speak up for the film after the greeting, and rolls the trailer once she has introduced it', () => {
    const { booth, sent, roll, dial, turn } = setup();
    booth.hostLive();
    turn('host');
    expect(sent).toEqual([{ to: 'host', kind: 'commentary', text: 'FILM' }]);
    expect(booth.stage).toBe('introducing');
    turn('host');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: '' });
    expect(roll).toHaveBeenCalledOnce();
    expect(booth.stage).toBe('trailer');
    expect(dial).not.toHaveBeenCalled();
  });

  it('has her speak up after the trailer, then dials the guest once the invitation is spoken', () => {
    const { booth, sent, dial, turn } = setup();
    booth.hostLive();
    turn('host');
    turn('host');
    sent.length = 0;
    booth.trailerDone();
    expect(booth.stage).toBe('inviting');
    expect(sent).toEqual([{ to: 'host', kind: 'commentary', text: 'INVITE' }]);
    turn('host');
    expect(sent.slice(1)).toEqual([
      { to: 'host', kind: 'directive', text: '' },
      { to: 'host', kind: 'directive', text: 'WELCOME' },
    ]);
    expect(dial).toHaveBeenCalledOnce();
    booth.guestLive();
    expect(booth.stage).toBe('on-air');
  });

  it('asks again when she does not speak up after the trailer, three times in all', () => {
    const { booth, sent, turn } = setup();
    booth.hostLive();
    turn('host');
    turn('host');
    sent.length = 0;
    booth.trailerDone();
    vi.advanceTimersByTime(SPEAK_UP_MS * 5);
    expect(sent.filter((d) => d.text === 'INVITE')).toHaveLength(3);
  });

  it('pays no attention to her talking during the trailer', () => {
    const { booth, dial, turn } = setup();
    booth.hostLive();
    turn('host');
    turn('host');
    turn('host');            // a check-in while the trailer plays
    expect(booth.stage).toBe('trailer');
    expect(dial).not.toHaveBeenCalled();
  });

  it('takes the welcome directive off after the host has welcomed the guest', () => {
    const { booth, sent, turn } = setup();
    booth.hostLive();
    turn('host');
    turn('host');
    booth.trailerDone();
    turn('host');
    booth.guestLive();
    turn('guest');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: 'WELCOME' });
    turn('host');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: '' });
  });

  it('gets on with the film when the host never greets', () => {
    const { booth, sent } = setup();
    booth.hostLive();
    vi.advanceTimersByTime(GREETING_WAIT_MS);
    expect(sent).toEqual([{ to: 'host', kind: 'commentary', text: 'FILM' }]);
  });

  it('asks again when she does not speak up for the film, three times in all, and not once she has', () => {
    const { booth, sent, turn } = setup();
    booth.hostLive();
    turn('host');
    vi.advanceTimersByTime(SPEAK_UP_MS * 5);
    expect(sent.filter((d) => d.text === 'FILM')).toHaveLength(3);

    const second = setup();
    second.booth.hostLive();
    second.turn('host');
    second.turn('host');
    vi.advanceTimersByTime(SPEAK_UP_MS * 5);
    expect(second.sent.filter((d) => d.text === 'FILM')).toHaveLength(1);
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
    vi.advanceTimersByTime(2000);
    booth.cue('TOPIC');
    turn('host');             // her reply starts a few seconds later, inside the idle window
    vi.advanceTimersByTime(IDLE_MS);
    // The host took the cue in her turn: it is never spoken over it (a later stall gets a prompt of its own).
    expect(sent.filter((d) => d.kind === 'commentary' && d.text === 'TOPIC')).toEqual([]);
  });
});

describe('a stalled conversation', () => {
  it('prompts the host to pick it back up, again while it stays quiet, then gives up', () => {
    const { sent } = onAir();
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent).toEqual([{ to: 'host', kind: 'commentary', text: 'NUDGE' }]);
    vi.advanceTimersByTime(IDLE_MS * (NUDGES + 2));
    expect(sent.filter((d) => d.text === 'NUDGE')).toHaveLength(NUDGES);
  });

  it('prompts again in a later stall, once someone has spoken in between', () => {
    const { sent, turn } = onAir();
    vi.advanceTimersByTime(IDLE_MS * (NUDGES + 2));   // every prompt used up
    turn('guest');
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent.filter((d) => d.text === 'NUDGE')).toHaveLength(NUDGES + 1);
  });

  it('stops prompting as soon as anyone speaks', () => {
    const { sent, turn } = onAir();
    vi.advanceTimersByTime(IDLE_MS);
    turn('host');   // she spoke: the quiet counts again from the end of her words
    vi.advanceTimersByTime(IDLE_MS - TURN_QUIET_MS - 1);
    expect(sent.filter((d) => d.text === 'NUDGE')).toHaveLength(1);
  });
});

describe('the wrap', () => {
  it('is not taken by a reply that was already starting when it landed', () => {
    const { booth, sent, turn } = onAir();
    booth.wrap();
    vi.advanceTimersByTime(DIRECTIVE_LEAD_MS - 1000);
    booth.speaking('host', true);   // the reply already in flight when the wrap landed: not the wrap
    vi.advanceTimersByTime(2000);
    booth.speaking('host', false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
    expect(booth.stage).toBe('on-air');
    expect(sent.at(-1)).toEqual({ to: 'host', kind: 'directive', text: 'WRAP' });
    turn('guest');
    turn('host');            // her next turn is the wrap
    expect(booth.stage).toBe('closing');
  });

  it('ends the show when the guest never says goodbye', () => {
    const { booth, turn } = onAir();
    booth.speaking('guest', true);
    booth.wrap();
    booth.speaking('guest', false);
    vi.advanceTimersByTime(TURN_QUIET_MS);
    turn('host');
    expect(booth.stage).toBe('closing');
    vi.advanceTimersByTime(GOODBYE_WAIT_MS);
    expect(booth.stage).toBe('over');
  });

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
