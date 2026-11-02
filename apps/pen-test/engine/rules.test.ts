import { describe, expect, it } from 'vitest';
import { GUESTS } from './guests.ts';
import { direction } from './director.ts';
import { normalise, wordRules } from './judge.ts';
import { applyVerdict, clockFor, gateOpen, LEVELS, levelById, moneyLeft, newRound, pickGuests, priceIn, report, score, topNow, type Round } from './rules.ts';

const round = (level = 'walkin', motive = 0): Round => newRound(GUESTS[0], levelById(level)!, () => motive / 2);
const say = (r: Round, text: string, v = {}) => applyVerdict(r, text, normalise(v));
const fit = { interest: 25, pitchFits: true, needUncovered: true };
const ask = { askedForSale: true, interest: 5, pitchFits: true };

describe('the clock', () => {
  it('fits inside the plan cap, since the session starts first', () => {
    expect(clockFor(levelById('walkin')!, 180)).toBe(160);
    expect(clockFor(levelById('walkin')!, 600)).toBe(180);
    expect(clockFor(levelById('thirty')!, 180)).toBe(30);
  });
  it('gives harder levels less discount room', () => {
    expect(LEVELS.map((l) => l.lowest)).toEqual([8, 10, 12, 12]);
  });
});

describe('prices in speech', () => {
  it.each([['how about $20', 20], ['twenty two dollars', 22], ['twenty-two bucks', 22], ["let's say eighteen", 18], ['I can do it for 15 bucks', 15]])('%s', (text, price) => {
    expect(priceIn(text)).toBe(price);
  });
  it.each(['it lasts ten years', 'I sold twenty pens', 'what do you do all day?'])('no price in: %s', (text) => {
    expect(priceIn(text)).toBeNull();
  });
});

describe('the sale gate', () => {
  it('never sells on charm alone', () => {
    const r = round();
    for (let i = 0; i < 6; i++) say(r, 'You seem lovely and I really like your style today', { interest: 25 });
    expect(say(r, 'So will you buy it?', { askedForSale: true, interest: 25 }).sold).toBeUndefined();
    expect(r.outcome).toBe('live');
    expect(r.interest).toBeLessThan(r.level.interestToBuy);
  });

  it('never sells to a spec reciter', () => {
    const r = round();
    for (let i = 0; i < 4; i++) say(r, 'It has a steel body, a refill that lasts years and a lifetime warranty', { interest: 0 });
    say(r, 'Will you buy?', { askedForSale: true });
    expect(r.outcome).toBe('live');
  });

  it('needs a clear ask: a warm chat that never closes stays unsold', () => {
    const r = round();
    say(r, 'Your site must be wet. This pen writes on wet paper for your clipboard.', fit);
    say(r, 'It really would help you, and it is eighteen dollars.', fit);
    expect(gateOpen(r)).toBe(true);
    expect(r.outcome).toBe('live');
  });

  it('sells a fitted pitch once asked, and a haggler pushes back once', () => {
    const r = round();
    expect(r.motive.haggles).toBe(true);
    say(r, 'This pen writes on wet paper, so your site notes survive the rain.', fit);
    say(r, 'A pencil smudges, but this ink stays on the sheet.', { ...fit, handledObjection: true });
    expect(say(r, 'Eighteen dollars, shall we do it?', ask).haggle).toBe(true);
    expect(r.outcome).toBe('live');
    expect(say(r, 'Eighteen dollars and it is yours, deal?', ask).sold).toBe(18);
    expect(r.price).toBe(18);
  });

  it('refuses an offer below the lowest price', () => {
    const r = round();
    say(r, 'This pen writes on wet paper for your site notes.', fit);
    expect(say(r, 'Five dollars, deal?', ask).refused).toBe(5);
    expect(r.offer).toBeNull();
  });

  it('will not sell above what the guest would pay now', () => {
    const r = round();
    say(r, 'This pen writes on wet paper for your site notes.', { ...fit, interest: 25 });
    say(r, 'A pencil smudges, this does not.', { ...fit, interest: 15 });
    expect(topNow(r)).toBeLessThan(25);
    expect(say(r, 'Twenty-five dollars, deal?', { ...ask, interest: 0 }).sold).toBeUndefined();
  });

  it('walks when interest runs out', () => {
    const r = round();
    expect(say(r, 'Just buy it, you must', { interest: -25, pressure: true }).walked).toBe(true);
    expect(r.outcome).toBe('walked');
  });
});

describe('money and scores', () => {
  const sold = (price: number) => {
    const r = round('walkin', 1);
    say(r, 'Inspectors want ink. This pen does not smudge.', fit);
    say(r, 'Any cheap pen smudges in rain, this one does not.', { ...fit, handledObjection: true });
    say(r, `${price} dollars, deal?`, ask);
    r.read = { motive: true, clue: true };
    r.score = score(r);
    return r;
  };

  it('pays more for holding the price', () => {
    const high = sold(20), low = sold(8);
    expect(high.outcome).toBe('sold');
    expect(low.outcome).toBe('sold');
    expect(high.score!.pricing).toBeGreaterThan(low.score!.pricing);
    expect(moneyLeft(low)).toBeGreaterThan(moneyLeft(high));
    expect(report([low]).money).toBe(8);
  });

  it('marks a false claim down and has the guest challenge it', () => {
    const r = round();
    const step = say(r, 'It works a hundred metres underwater', { falseClaims: ['works underwater'] });
    expect(step.challenge).toBe('works underwater');
    expect(direction(r, step)).toContain('challenge this claim');
    expect(score(r).penalties).toBe(5);
  });

  it('reports the weakest skill as the drill', () => {
    const r = round();
    r.outcome = 'time';
    r.read = { motive: true, clue: true };
    r.score = score(r);
    expect(report([r]).drill).toContain('question');
  });
});

describe('the guest', () => {
  it('is told not to buy until the rules say so', () => {
    const r = round();
    expect(direction(r)).toContain('NOT decided');
    expect(direction(r, { sold: 20 })).toContain('YOU MAY BUY at $20');
  });
  it('gets three different guests a run', () => {
    expect(new Set(pickGuests().map((g) => g.id)).size).toBe(3);
  });
  it('has word rules that work without a model', () => {
    const r = round();
    expect(wordRules(r, 'What do you write on at work all day?').askedAboutNeed).toBe(true);
  });
});
