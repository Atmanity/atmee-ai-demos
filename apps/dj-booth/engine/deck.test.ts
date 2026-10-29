import { describe, expect, test } from 'vitest';
import { advance, dig, pick, playNow, queueNext, setPaused } from './deck.ts';
import { crateText, deckState, said, TOOLS, INSTRUCTIONS } from './director.ts';
import { emptyDeck, type Track } from './types.ts';

const track = (id: string, title = id): Track => ({ id, title, artist: 'Artist', album: '', year: '1999', durationMs: 1, art: null });
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

  test('an end cue with nothing queued asks the host to line up the next record', () => {
    expect(said.ending(a, null)).toContain('nothing is queued');
    expect(said.ending(a, b)).toContain('"Bravo" by Artist (1999) is up next');
  });

  test('every tool waits for the page, and the instructions fit the session limit', () => {
    expect(TOOLS.every((t) => t['x-atmee']?.mode === 'await')).toBe(true);
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
  });
});
