// The kit by the names people use. Every piece is reachable by its own label,
// and a longer name in the kit beats a shorter alias inside it.
import { expect, test } from 'vitest';
import { CATALOG, resolveType } from './catalog.ts';
import { KINDS, resolveKind } from './rooms.ts';

test('every piece answers to its own name, however it is written', () => {
  for (const piece of Object.values(CATALOG)) {
    for (const said of [piece.label, piece.label.toLowerCase(), `a ${piece.label.toLowerCase()}`, `the ${piece.label.toLowerCase()} please`]) {
      expect(resolveType(said)?.type, said).toBe(piece.type);
    }
  }
});

test('a smaller piece is never swapped for a bigger one with a shorter name', () => {
  // "a side table" became a dining table, "small rug" the big rug, and
  // "2-seat sofa" a 3-seat sofa: the shorter alias inside the name won.
  const cases: [string, string | undefined][] = [
    ['2-seat sofa', 'sofa_2'], ['a 2 seat sofa', 'sofa_2'], ['2-seat', 'sofa_2'], ['two seater', 'sofa_2'], ['a two-seat sofa', 'sofa_2'],
    ['3-seat sofa', 'sofa_3'], ['three seater', 'sofa_3'], ['sofa', 'sofa_3'], ['couch', 'sofa_3'],
    ['small rug', 'rug_small'], ['a small rug by the bed', 'rug_small'], ['rug', 'rug'],
    ['side table', 'side_table'], ['a side table', 'side_table'], ['end table', 'side_table'], ['table', 'dining_table'],
    ['bedside table', 'bedside_table'], ['coffee table', 'coffee_table'], ['corner sofa', 'sofa_corner'],
    ['floor lamp', 'floor_lamp'], ['tv stand', 'tv_unit'], ['armchair', 'armchair'], ['chair', 'chair'],
    ['grand piano', undefined],
  ];
  for (const [said, type] of cases) expect(resolveType(said)?.type, said).toBe(type);
});

test('every room kind answers to its own label too (the same lookup, for rooms)', () => {
  for (const kind of Object.values(KINDS).filter((k) => k.kind !== 'other')) {
    for (const said of [kind.label, `a ${kind.label.toLowerCase()}`, `the small ${kind.label.toLowerCase()}`]) expect(resolveKind(said)?.kind, said).toBe(kind.kind);
  }
});
