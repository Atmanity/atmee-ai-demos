import { describe, expect, test } from 'vitest';
import { advance, askOpen, ASK_OPEN_MS, clearHostPicks, dig, pick, playedTonight, playNow, queueNext, setPaused } from './deck.ts';
import { crateText, deckState, said, TOOLS, INSTRUCTIONS } from './director.ts';
import { emptyDeck, type Track } from './types.ts';

const track = (id: string, title = id): Track => ({ id, title, artist: 'Artist', album: '', year: '1999', durationMs: 1, art: null, cover: null });
const a = track('a', 'Alpha');
const b = track('b', 'Bravo');
const c = track('c', 'Charlie');

describe('the deck', () => {
  test('pick reads the host\'s 1-based number from the latest crate, and nothing else', () => {
    const d = dig(emptyDeck, 'x', [a, b]);
    expect(pick(d, 1)).toBe(a);
    expect(pick(d, '2')).toBe(b);
    expect(pick(d, 0)).toBeNull();
    expect(pick(d, 3)).toBeNull();
    expect(pick(d, 'two')).toBeNull();
  });

  test('a record plays, queued ones follow in order, and the decks empty after the last', () => {
    let d = playNow(emptyDeck, a);
    d = queueNext(queueNext(d, b), c);
    d = advance(d);
    expect(d.playing).toBe(b);
    expect(d.queue).toEqual([c]);
    d = advance(advance(d));
    expect(d.playing).toBeNull();
  });

  test('the same record queued twice in a row is kept once', () => {
    expect(queueNext(queueNext(playNow(emptyDeck, a), b), b).queue).toEqual([b]);
  });

  test('playing a record unpauses; pausing empty decks changes nothing', () => {
    expect(playNow(setPaused(playNow(emptyDeck, a), true), b).paused).toBe(false);
    expect(setPaused(emptyDeck, true)).toBe(emptyDeck);
  });
});

describe('what the host is told', () => {
  test('a search numbers its results the way play_track reads them', () => {
    expect(crateText('90s', [a, b])).toContain('1. "Alpha" by Artist (1999); 2. "Bravo"');
    expect(crateText('zzz', [])).toContain('Nothing on Spotify');
  });

  test('the live deck says what is on, what is queued and the latest results', () => {
    const d = queueNext(playNow(dig(emptyDeck, 'jazz', [a, b]), a), c);
    const text = deckState(setPaused(d, true));
    expect(text).toContain('Paused: "Alpha"');
    expect(text).toContain('Queued next: "Charlie"');
    expect(text).toContain('Latest results (for "jazz"): 1. "Alpha"');
    expect(deckState(emptyDeck)).toContain('Nothing is playing. Nothing is queued.');
  });

  test('a break back-announces the record ending and introduces the next, briefly', () => {
    const text = said.break(a, b, 2);
    expect(text).toContain('"Alpha" by Artist (1999) is ending');
    expect(text).toContain('introduce "Bravo" by Artist (1999): the artist and the story of the song');
    expect(text).toContain('two or three sentences');
    expect(text).not.toContain('line up');
  });

  test('a break with nothing lined up first finds the next record', () => {
    expect(said.break(a, null, 0)).toContain('nothing is lined up. First search for the next record');
  });

  test('every tool waits for the page, and the instructions fit the session limit', () => {
    expect(TOOLS.every((t) => t['x-atmee']?.mode === 'await')).toBe(true);
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
  });
});

describe('the host keeps the show going', () => {
  test('a break with a short line quietly fills it back up to ten, in one call', () => {
    expect(said.break(a, b, 0)).toContain('fill the line back up to 10 with one line_up call (10 records');
    expect(said.break(a, b, 6)).not.toContain('line_up');
  });

  test('the show opens on the host\'s own pick, unasked', () => {
    expect(said.start()).toContain('decide the style of tonight\'s set, pick one opening record');
    expect(said.opener(a)).toContain('first describe the style of music you will play tonight');
    expect(said.opener(a)).toContain('saying its title "Alpha" and its artist Artist');
    expect(said.opener(a)).toContain('It starts as you finish');
    expect(said.start()).toContain('nine more in one line_up call, never with "now": the opener plays to its end');
  });
});

describe('the line keeps order and no repeats', () => {
  test('a record on now, or already in line, is not lined up again', () => {
    const d = queueNext(playNow(emptyDeck, a), b);
    expect(queueNext(d, a)).toBe(d);
    expect(queueNext(queueNext(d, c), b).queue).toEqual([b, c]);
  });

});

test('another release of the same song counts as already in line', () => {
  const nuxx = { ...a, id: 'x1', title: 'Born Slippy (Nuxx)', artist: 'Underworld' };
  const radio = { ...a, id: 'x2', title: 'Born Slippy (Nuxx) - Radio Edit', artist: 'Underworld, Someone' };
  const other = { ...a, id: 'x3', title: 'Born Slippy', artist: 'Another Band' };
  const d = queueNext(playNow(emptyDeck, a), nuxx);
  expect(queueNext(d, radio)).toBe(d);
  expect(queueNext(d, other).queue).toHaveLength(2);
});

describe('what has played tonight', () => {
  test('a record moves into the played list when the next one goes on, once per song', () => {
    let d = queueNext(playNow(emptyDeck, a), b);
    d = advance(d);
    expect(d.played).toEqual([a]);
    d = playNow(d, c);
    expect(d.played).toEqual([a, b]);
    expect(playedTonight(d, { ...a, id: 'another-release' })).toBe(true);
    expect(playedTonight(d, c)).toBe(false);
  });

  test('search results mark what has played, and the live deck lists it', () => {
    const d = advance(queueNext(playNow(dig(emptyDeck, 'x', [a, b]), a), b));
    const text = crateText('x', [a, b], (t) => playedTonight(d, t));
    expect(text).toContain('1. "Alpha" by Artist (1999) (played tonight)');
    expect(text).not.toContain('2. "Bravo" by Artist (1999) (played tonight)');
    expect(deckState(d)).toContain('Played tonight, never to be picked again: "Alpha"');
  });
});

test('the host is pointed away from played songs, except when the listener asks again', () => {
  expect(INSTRUCTIONS).toContain('unless the listener asks to hear it again');
});

test('a change of vibe clears the host\'s picks from the line and keeps what the listener asked for', () => {
  const d = queueNext(queueNext(queueNext(playNow(emptyDeck, a), b), c), { ...a, id: 'd', title: 'Delta' });
  const after = clearHostPicks(d, (t) => t.id === 'c');
  expect(after.queue.map((t) => t.id)).toEqual(['c']);
  expect(after.playing).toBe(a);
  expect(said.newVibe(2)).toContain('2 records you had lined up were cleared');
  expect(said.newVibe(0)).toBe('');
});

test('a listener\'s ask stays open until the host acts on it, or for 90 seconds', () => {
  const t0 = 1_000_000;
  expect(askOpen(t0, 0, t0 + 45_000)).toBe(true);          // a search and a reply later: still theirs
  expect(askOpen(t0, t0 + 30_000, t0 + 45_000)).toBe(false); // already used for one change
  expect(askOpen(t0, 0, t0 + ASK_OPEN_MS + 1)).toBe(false);  // long gone
});

test('early in a record with a short line, the host is asked to fill it to ten quietly, in one call', () => {
  expect(said.topUp(a, 3)).toContain('one line_up call with 7 searches');
  expect(said.topUp(a, 3)).toContain('Say nothing at all');
  expect(said.linedUp([b], ['nope'], 4)).toBe('Lined up: "Bravo" by Artist (1999). Not found, or already on, in line or played tonight: nope. 4 in line now.');
});

test('a record put on now leaves the line, so it never plays twice', () => {
  const d = playNow(queueNext(queueNext(playNow(emptyDeck, a), b), c), b);
  expect(d.playing).toBe(b);
  expect(d.queue).toEqual([c]);
});
