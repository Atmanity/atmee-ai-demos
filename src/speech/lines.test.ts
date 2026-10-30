import { describe, expect, test } from 'vitest';
import { CallLines } from './lines.ts';

const view = (c: CallLines) => c.lines.map((l) => `${l.who}${l.final ? '' : '…'}${l.cut ? '!' : ''}: ${l.text}`);

describe("a call's lines", () => {
  test('a plain exchange: the greeting, the question as it is recognised, the answer', () => {
    const c = new CallLines();
    c.avatar('Juniper Family Clinic, ');
    c.avatar('how can I help?');
    expect(c.user('I would', false)).toEqual([{ who: 'avatar', text: 'Juniper Family Clinic, how can I help?' }]);
    expect(c.user('I would like a check-up', true)).toEqual([{ who: 'user', text: 'I would like a check-up' }]);
    c.avatar('Of course.');
    expect(view(c)).toEqual(['avatar: Juniper Family Clinic, how can I help?', 'user: I would like a check-up', 'avatar…: Of course.']);
    expect(c.close()).toEqual([{ who: 'avatar', text: 'Of course.' }]);
  });

  test("the answer begins before the user's message turns final: neither line splits", () => {
    const c = new CallLines();
    c.user('cancel my', false);
    c.avatar('Let me pull up ');
    c.user('cancel my appointment please', true);
    c.avatar('the schedule for you.');
    expect(view(c)).toEqual(['user: cancel my appointment please', 'avatar…: Let me pull up the schedule for you.']);
  });

  test('a cut-off answer is marked, and a backchannel neither splits nor closes it', () => {
    const c = new CallLines();
    c.avatar('We have nine, nine thirty');
    c.user('mm-hm', true, { backchannel: true });
    c.avatar(', or ten.');
    expect(view(c)).toEqual(['avatar…: We have nine, nine thirty, or ten.', 'user: mm-hm']);
    c.user('wait, Friday instead', false, { interruption: true });
    expect(view(c)[0]).toBe('avatar!: We have nine, nine thirty, or ten.');
  });

  test('ending mid-message keeps what was heard, as final', () => {
    const c = new CallLines();
    c.user('thank you, bye', false);
    expect(c.close()).toEqual([]);
    expect(view(c)).toEqual(['user: thank you, bye']);
  });

  test('only the newest lines are kept', () => {
    const c = new CallLines(3);
    for (let i = 0; i < 5; i++) c.user(`line ${i}`, true);
    expect(c.lines.map((l) => l.text)).toEqual(['line 2', 'line 3', 'line 4']);
  });
});
