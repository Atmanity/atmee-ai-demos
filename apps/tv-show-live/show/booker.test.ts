import { describe, expect, it, vi } from 'vitest';
import { ASK_EVERY_MS, BOOK_AFTER_MS, createBooker, MAX_GUESTS, type Booking, type BookerOptions } from './booker.ts';

function setup(answers: Booking[], guests = ['Inès']) {
  let t = 1_000_000;
  let enabled = true;
  const asked: number[] = [];
  const booked: string[] = [];
  const opts: BookerOptions = {
    ask: vi.fn(async () => { asked.push(t); return answers.shift() ?? { book: false, description: '', reason: '' }; }),
    book: (d) => { booked.push(d); guests.push(d); },
    enabled: () => enabled,
    guests: () => guests,
    now: () => t,
  };
  const booker = createBooker(opts);
  const tick = (ms: number) => { t += ms; };
  const answer = async () => { booker.line({ who: 'host', text: 'q' }); booker.line({ who: 'guest', text: 'a' }); await Promise.resolve(); await Promise.resolve(); };
  return { booker, opts, asked, booked, tick, answer, off: () => { enabled = false; } };
}

const yes = (d = 'the actress who plays the queen'): Booking => ({ book: true, description: d, reason: 'mentioned twice' });

describe('auto-booking', () => {
  it(`waits until the guest has been on ${BOOK_AFTER_MS / 1000} s before asking`, async () => {
    const s = setup([yes()]);
    s.booker.guestOn();
    s.tick(BOOK_AFTER_MS - 1);
    await s.answer();
    expect(s.asked).toHaveLength(0);
    s.tick(1);
    await s.answer();
    expect(s.booked).toEqual(['the actress who plays the queen']);
  });

  it(`asks at most every ${ASK_EVERY_MS / 1000} s`, async () => {
    const s = setup([]);
    s.booker.guestOn();
    s.tick(BOOK_AFTER_MS);
    await s.answer();
    await s.answer();
    expect(s.asked).toHaveLength(1);
    s.tick(ASK_EVERY_MS);
    await s.answer();
    expect(s.asked).toHaveLength(2);
  });

  it('books nobody when the conversation gives no reason to', async () => {
    const s = setup([{ book: false, description: 'someone', reason: '' }]);
    s.booker.guestOn();
    s.tick(BOOK_AFTER_MS);
    await s.answer();
    expect(s.booked).toEqual([]);
  });

  it(`stops at ${MAX_GUESTS} guests a show`, async () => {
    const s = setup([yes('b'), yes('c')], ['a']);
    s.booker.guestOn();
    s.tick(BOOK_AFTER_MS);
    await s.answer();
    s.tick(ASK_EVERY_MS);
    await s.answer();
    expect(s.booked).toEqual(['b', 'c']);
    s.tick(ASK_EVERY_MS);
    await s.answer();
    expect(s.asked).toHaveLength(2);
  });

  it('does nothing while it is off (switched off, wrapping, or a guest being made)', async () => {
    const s = setup([yes()]);
    s.off();
    s.booker.guestOn();
    s.tick(BOOK_AFTER_MS);
    await s.answer();
    expect(s.asked).toHaveLength(0);
  });

  it('counts the time on air afresh for each guest', async () => {
    const s = setup([yes()]);
    s.booker.guestOn();
    s.tick(BOOK_AFTER_MS);
    s.booker.guestOn();     // a handover
    await s.answer();
    expect(s.asked).toHaveLength(0);
  });
});
