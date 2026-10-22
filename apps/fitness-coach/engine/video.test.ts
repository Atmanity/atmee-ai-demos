// Ported from the original `test_video.py`: request shaping, poll reading,
// and the pipeline driven by a fake provider. The DemoNarrator tests are
// gone with the narrator (a status is now an outcome the app sends as an
// event; see coach.test.ts). No test touches the network.
import { describe, expect, it, vi } from 'vitest';
import {
  buildGenerationRequest,
  clampDuration,
  DemoRenderer,
  isUsableReferenceUrl,
  normalizeAspectRatio,
  normalizeResolution,
  readPoll,
  referenceImageUrls,
  XAI_GENERATIONS_URL,
} from './video.ts';
import type { VideoPayload } from './types.ts';

describe('request shaping', () => {
  it.each([['9:16', '9:16'], ['16:9', '16:9'], ['banana', '9:16'], ['', '9:16'], [null, '9:16']])('falls back from an aspect ratio outside the set: %j', (given, expected) => {
    expect(normalizeAspectRatio(given)).toBe(expected);
  });

  it.each([['480p', '480p'], ['720P', '720p'], ['4k', '480p'], [null, '480p']])('falls back from a resolution outside the set: %j', (given, expected) => {
    expect(normalizeResolution(given)).toBe(expected);
  });

  it.each([
    [6, false, 6], [0, false, 1], [99, false, 15],
    // The ceiling drops with reference images: exceeding it is a rejected generation, not a shorter clip.
    [99, true, 10], ['nonsense', false, 6], [null, false, 6],
  ] as const)('clamps the duration to what the provider accepts: %j', (given, refs, expected) => {
    expect(clampDuration(given, refs)).toBe(expected);
  });

  it('omits reference images rather than sending them empty', () => {
    // The provider treats the key's presence as a mode.
    expect(buildGenerationRequest({ prompt: 'squats', references: [] })).not.toHaveProperty('reference_images');
    expect(buildGenerationRequest({ prompt: 'squats', references: ['https://example.com/a.jpg'] }).reference_images).toEqual([{ url: 'https://example.com/a.jpg' }]);
  });

  it.each([
    ['https://cdn.example.com/sammy.jpg', true],
    ['http://example.com/a.png', true],
    // xAI fetches from its own network: these fail the whole generation.
    ['http://localhost:8080/a.jpg', false],
    ['http://127.0.0.1/a.jpg', false],
    ['http://artifacts.taild36ab5.ts.net/a.jpg', false],
    ['http://media.default.svc.cluster.local/a.jpg', false],
    ['ftp://example.com/a.jpg', false],
    ['not a url', false],
    ['', false],
  ] as const)('keeps only publicly fetchable reference URLs: %s', (url, ok) => {
    expect(isUsableReferenceUrl(url)).toBe(ok);
  });

  it('reads reference URLs from the environment, filtered', () => {
    expect(referenceImageUrls({ FITNESS_VIDEO_REFERENCE_IMAGE_URLS: 'https://cdn.example.com/a.jpg, http://localhost/b.jpg , ' })).toEqual(['https://cdn.example.com/a.jpg']);
    expect(referenceImageUrls({})).toEqual([]);
  });
});

describe('reading a poll', () => {
  it.each([
    [{ status: 'done', video: { url: 'https://x.ai/v.mp4' } }, ['done', 'https://x.ai/v.mp4']],
    [{ status: 'pending' }, ['pending', null]],
    [{ status: 'failed' }, ['failed', null]],
    [{ status: 'expired' }, ['expired', null]],
    // Anything unrecognised keeps waiting: the loop has its own timeout.
    [{}, ['pending', null]],
    [{ status: 'done' }, ['done', null]],
    [null, ['pending', null]],
    ['not an object', ['pending', null]],
    [{ status: 'done', video: 'not an object' }, ['done', null]],
  ])('reads %j defensively', (data, expected) => {
    expect(readPoll(data)).toEqual(expected);
  });
});

// -- the pipeline ---------------------------------------------------------------

const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function fakeProvider({ create = json(200, { request_id: 'xai-1' }), polls = [json(200, { status: 'done', video: { url: 'https://x.ai/v.mp4' } })], download = new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 }) } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...polls];
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === XAI_GENERATIONS_URL) return create.clone();
    if (String(url).startsWith('https://api.x.ai/v1/videos/')) return (queue.length > 1 ? queue.shift()! : queue[0]).clone();
    return download.clone();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

interface RendererSetup { key?: string; store?: (bytes: Uint8Array) => Promise<string>; suppressed?: () => boolean }

function aRenderer(provider = fakeProvider(), { key = 'key-123', store = async (bytes: Uint8Array) => `/api/apps/fitness-coach/clips/clip-${bytes.length}`, suppressed = () => false }: RendererSetup = {}) {
  const statuses: VideoPayload[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });
  const renderer = new DemoRenderer({
    fetch: provider.fetch,
    sleep: async () => {},
    env: key ? { XAI_API_KEY: key } : {},
    store,
    suppressed,
    onStatus: (p) => { statuses.push(p); if (p.status !== 'generating') resolveDone(); },
    newId: () => 'req-1',
  });
  return { renderer, statuses, done, provider };
}

/** Long enough for a fake pipeline to run to the end. */
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('rendering a demo', () => {
  it('degrades instead of failing the session when there is no key', async () => {
    // The one that matters most: no key is a normal state, and a session
    // without a clip is still a session.
    const { renderer, provider, statuses } = aRenderer(fakeProvider(), { key: '' });
    expect(renderer.available()).toBe(false);
    const first = renderer.start({ prompt: 'squats with clean form' });
    expect(first.status).toBe('unavailable');
    expect(first.message).toBeTruthy();
    await settle();
    expect(provider.calls).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it('starts at once and later publishes a stored URL, never the provider one', async () => {
    const { renderer, statuses, done } = aRenderer();
    expect(renderer.start({ prompt: 'goblet squats, clean form' }).status).toBe('generating');
    await done;
    expect(statuses.map((s) => s.status)).toEqual(['ready']);
    expect(statuses[0].video_url).toBe('/api/apps/fitness-coach/clips/clip-4');
    expect(statuses[0].video_url).not.toContain('x.ai');
  });

  it('never sends an empty prompt', async () => {
    const { renderer, provider } = aRenderer();
    renderer.start({ prompt: '   ' });
    await settle();
    expect(provider.calls).toEqual([]);
  });

  it('ends a refused generation as an error the board can show', async () => {
    const { renderer, statuses, done } = aRenderer(fakeProvider({ create: json(400, { error: 'bad prompt' }) }));
    renderer.start({ prompt: 'squats' });
    await done;
    expect(statuses.map((s) => s.status)).toEqual(['error']);
    expect(statuses[0].message).toBeTruthy();
  });

  it('treats a generation response without a request id as an error', async () => {
    const { renderer, statuses, done } = aRenderer(fakeProvider({ create: json(200, 'not json at all') }));
    renderer.start({ prompt: 'squats' });
    await done;
    expect(statuses[0].status).toBe('error');
  });

  it('stops polling on a provider-side failure', async () => {
    const provider = fakeProvider({ polls: [json(200, { status: 'failed' })] });
    const { renderer, statuses, done } = aRenderer(provider);
    renderer.start({ prompt: 'squats' });
    await done;
    expect(statuses[0].status).toBe('error');
    expect(provider.calls.filter((c) => c.url.startsWith('https://api.x.ai/v1/videos/') && c.url !== XAI_GENERATIONS_URL)).toHaveLength(1);
  });

  it('keeps waiting through a transient poll error', async () => {
    const { renderer, statuses, done } = aRenderer(fakeProvider({
      polls: [json(429, 'slow down'), json(200, { status: 'pending' }), json(200, { status: 'done', video: { url: 'https://x.ai/v.mp4' } })],
    }));
    renderer.start({ prompt: 'squats' });
    await done;
    expect(statuses[0].status).toBe('ready');
  });

  it('reports a clip that cannot be stored as an error, not a provider URL', async () => {
    const { renderer, statuses, done } = aRenderer(fakeProvider(), { store: async () => { throw new Error('bucket is not configured'); } });
    renderer.start({ prompt: 'squats' });
    await done;
    expect(statuses[0].status).toBe('error');
    expect(statuses[0]).not.toHaveProperty('video_url');
  });

  it('gives every provider call a timeout', async () => {
    // Declared and passed to nothing in the original: a quiet provider held
    // the board on "rendering" for five minutes an attempt.
    const { renderer, done, provider } = aRenderer();
    renderer.start({ prompt: 'squats' });
    await done;
    expect(provider.calls.length).toBeGreaterThan(0);
    for (const call of provider.calls) expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('publishes nothing for a superseded render', async () => {
    // Naming a second move while the first renders must not end on the first clip.
    const provider = fakeProvider();
    const { renderer, statuses } = aRenderer(provider);
    renderer.start({ prompt: 'squats' });
    renderer.start({ prompt: 'plank' });
    await settle();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].prompt).toBe('plank');
  });

  it('publishes nothing once stopped', async () => {
    const { renderer, statuses } = aRenderer();
    renderer.start({ prompt: 'squats' });
    renderer.stop();
    await settle();
    expect(statuses).toEqual([]);
  });

  it('shows and announces nothing while clips are suppressed (the safety hold)', async () => {
    let hold = false;
    const { renderer, statuses } = aRenderer(fakeProvider(), { suppressed: () => hold });
    renderer.start({ prompt: 'walking lunges' });
    hold = true;
    await settle();
    expect(statuses).toEqual([]);
  });
});
