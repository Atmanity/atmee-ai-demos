import { describe, expect, test, vi } from 'vitest';
import { Spotify, tracksFrom } from './spotify.ts';

const item = { id: 'abc', name: 'One More Time', duration_ms: 320000, artists: [{ name: 'Daft Punk' }], album: { name: 'Discovery', release_date: '2001-03-12', images: [{ url: 'big' }, { url: 'mid' }, { url: 'small' }] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('tracksFrom', () => {
  test('maps a search response to the booth\'s tracks', () => {
    expect(tracksFrom({ tracks: { items: [item] } })).toEqual([
      { id: 'abc', title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', year: '2001', durationMs: 320000, art: 'mid' },
    ]);
  });

  test('drops items with no id and survives a missing body', () => {
    expect(tracksFrom({ tracks: { items: [null, { name: 'x' }] } })).toEqual([]);
    expect(tracksFrom(undefined)).toEqual([]);
  });
});

describe('Spotify', () => {
  test('is unconfigured without both credentials', () => {
    expect(new Spotify('id', '').configured).toBe(false);
    expect(new Spotify('id', 'secret').configured).toBe(true);
  });

  test('signs in once and reuses the token across searches', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('/api/token') ? json({ access_token: 't1', expires_in: 3600 }) : json({ tracks: { items: [item] } })));
    const s = new Spotify('id', 'secret', fetchFn);
    await s.search('daft punk');
    await s.search('justice');
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('/api/token'))).toHaveLength(1);
    expect(fetchFn.mock.calls[1][0]).toContain('q=daft%20punk');
  });

  test('a 401 fetches a fresh token and retries once', async () => {
    let tokens = 0;
    let searches = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/token')) return json({ access_token: `t${++tokens}`, expires_in: 3600 });
      return ++searches === 1 ? json({}, 401) : json({ tracks: { items: [item] } });
    });
    const tracks = await new Spotify('id', 'secret', fetchFn).search('x');
    expect(tracks).toHaveLength(1);
    expect(tokens).toBe(2);
  });
});
