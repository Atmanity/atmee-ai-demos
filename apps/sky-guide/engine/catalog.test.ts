// The catalogue's own consistency. Ported from the original `test_catalog.py`.
// This is the app's content, and content errors here are silent: a typo in a
// figure drops one line out of a shape and nobody can tell which shape was
// wrong, while a duplicated id quietly shadows a star.
import { expect, test } from 'vitest';
import { BY_ID, CONSTELLATION_NAMES, FACTS, factFor, FIGURES, findConstellation, findStar, STARS } from './catalog.ts';

test('there are 135 stars, 18 figures and facts for 40 of them', () => {
  expect(STARS).toHaveLength(135);
  expect(Object.keys(FIGURES)).toHaveLength(18);
  expect(Object.keys(FACTS)).toHaveLength(40);
});

test('every figure line names a star that exists', () => {
  for (const [abbr, lines] of Object.entries(FIGURES)) {
    for (const [a, b] of lines) {
      expect(BY_ID.has(a), `${abbr} ${a}`).toBe(true);
      expect(BY_ID.has(b), `${abbr} ${b}`).toBe(true);
    }
  }
});

test('every figure line touches its own constellation', () => {
  // One end elsewhere is legitimate: Alpheratz is Alpha Andromedae and also a
  // corner of the Square of Pegasus. Both ends elsewhere is a copy-paste slip.
  for (const [abbr, lines] of Object.entries(FIGURES)) {
    for (const [a, b] of lines) expect([BY_ID.get(a)!.con, BY_ID.get(b)!.con], `${abbr} ${a}-${b}`).toContain(abbr);
  }
});

test('ids are unique', () => {
  expect(BY_ID.size).toBe(STARS.length);
});

test('every constellation used has a full name (a missing one prints "CMa" at somebody)', () => {
  for (const s of STARS) expect(CONSTELLATION_NAMES[s.con], s.id).toBeTruthy();
});

test('coordinates are in range', () => {
  for (const s of STARS) {
    expect(s.raH >= 0 && s.raH < 24, s.id).toBe(true);
    expect(s.decDeg >= -90 && s.decDeg <= 90, s.id).toBe(true);
    expect(s.mag > -2 && s.mag < 6, s.id).toBe(true);
  }
});

test('the catalogue is sorted brightest first (the visible cap keeps the head)', () => {
  const mags = STARS.map((s) => s.mag);
  expect(mags).toEqual([...mags].sort((a, b) => a - b));
  expect(STARS[0].id).toBe('sirius');
});

test('spoken names resolve however they arrive from speech', () => {
  for (const spoken of ['Kaus Australis', 'kaus-australis', 'kaus_australis', 'KAUS  AUSTRALIS']) {
    expect(findStar(spoken)?.id).toBe('kaus_australis');
  }
});

test('a near miss is not rounded to some other star', () => {
  // Fuzzy matching is how an avatar confidently describes the wrong star.
  expect(findStar('Siriusly')).toBeNull();
  expect(findStar('')).toBeNull();
});

test('the names people actually use find the constellation', () => {
  expect(findConstellation('the Plough')).toBe('UMa');
  expect(findConstellation('big dipper')).toBe('UMa');
  expect(findConstellation('Southern Cross')).toBe('Cru');
  expect(findConstellation('orion')).toBe('Ori');
  expect(findConstellation('Ori')).toBe('Ori');
  expect(findConstellation('Rivendell')).toBeNull();
  // New in this port: accents folded, as keyboards and recognisers spell it.
  expect(findConstellation('Bootes')).toBe('Boo');
});

test('a fact always ends with the catalogue row, so an unauthored star has something true to say', () => {
  const fact = factFor('megrez')!;
  expect(fact.title).toBe('Megrez');
  expect(fact.lines.at(-1)).toContain('Ursa Major');
});

test('facts only exist for stars in the catalogue', () => {
  for (const id of Object.keys(FACTS)) expect(BY_ID.has(id), id).toBe(true);
  expect(factFor('nonesuch')).toBeNull();
});
