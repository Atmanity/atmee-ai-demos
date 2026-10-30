import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

// The Avatar API, faked: each call is recorded with its body; the page's calls go to the real routes.
const BASE = 'https://avatar-api.test';
const calls: { method: string; path: string; body: any }[] = [];
const realFetch = globalThis.fetch;
let server: Server;
let port: number;
let endLiveSessions: () => Promise<void>;
let reply: (path: string, method: string) => Response | null = () => null;
let reserved = 0;

beforeAll(async () => {
  process.env.ATMEE_BASE_URL = BASE;
  process.env.ATMEE_API_KEY = 'test-key';
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(BASE)) return realFetch(url, init);
    const path = u.slice(BASE.length);
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = reply(path, method);
    if (custom) return custom;
    if (path === '/v1/speech_sessions') {
      return Response.json({ sessionId: `sp-${++reserved}`, url: 'wss://speech.test/v1/speech_sessions', token: 'jwt', tokenExpiresAt: '2026-10-27T12:01:00Z', actualDurationSeconds: 600, billingMode: 'reserve', durationCapped: false }, { status: 201 });
    }
    if (path.endsWith('/end')) return Response.json({ status: 'active', endRequestedAt: '2026-10-27T12:02:00Z' });
    if (path.startsWith('/v1/speech_sessions/')) return Response.json({ sessionId: 'x', status: 'completed', endReason: 'ended_by_api', billedSeconds: 75, chargedMicrocredits: 125, token: 'never-passed-on' });
    return new Response(null, { status: 204 });
  });
  const mod = await import('../../server/api.ts');
  endLiveSessions = mod.endLiveSessions;
  const app = express();
  app.use('/api', express.json(), mod.api);
  server = createServer(app);
  port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
});
afterAll(() => { server?.close(); vi.unstubAllGlobals(); });
beforeEach(() => { calls.length = 0; reply = () => null; delete process.env.AVATAR_FRONT_DESK; delete process.env.AVATAR_DEFAULT; });

const url = (path: string) => `http://127.0.0.1:${port}/api${path}`;
const post = (path: string) => fetch(url(path), { method: 'POST' });

test('a speech app is off, and not listed, until its own AVATAR_<APP_ID> is set: never AVATAR_DEFAULT', async () => {
  process.env.AVATAR_DEFAULT = 'some-default-avatar';
  const list = (await (await fetch(url('/apps'))).json()) as { id: string }[];
  expect(list.map((a) => a.id)).not.toContain('front-desk');
  const r = await post('/apps/front-desk/speech');
  expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({ error: 'no_avatar' });
  expect(calls).toEqual([]);

  process.env.AVATAR_FRONT_DESK = 'desk-avatar';
  const listed = (await (await fetch(url('/apps'))).json()) as { id: string; way: string; tools: number; host: string }[];
  expect(listed.find((a) => a.id === 'front-desk')).toMatchObject({ way: 'speech', tools: 4, host: 'Rosa' });
});

test('the server reserves the call with the avatar and its pinned settings; the page gets only where to connect', async () => {
  process.env.AVATAR_FRONT_DESK = 'desk-avatar';
  const r = await post('/apps/front-desk/speech');
  expect(r.status).toBe(201);
  expect(await r.json()).toEqual({ sessionId: `sp-${reserved}`, url: 'wss://speech.test/v1/speech_sessions', token: 'jwt', tokenExpiresAt: '2026-10-27T12:01:00Z', maxSeconds: 600 });
  const [{ method, path, body }] = calls;
  expect(`${method} ${path}`).toBe('POST /v1/speech_sessions');
  expect(body.avatarId).toBe('desk-avatar');
  expect(body.maxDurationSeconds).toBeGreaterThanOrEqual(60);
  expect(body).not.toHaveProperty('metadata');   // the speech API takes none
  expect(body.settings).toMatchObject({ avatar_name: 'Rosa', avatar_timezone: 'America/Los_Angeles' });
  expect(body.settings.instructions).toContain('appointment book');
  expect(body.settings.delegation.responses.tools.map((t: { name: string }) => t.name))
    .toEqual(['check_availability', 'book_appointment', 'cancel_appointment', 'find_appointments']);
});

test('a call whose page went while it was being reserved is ended, not left reserved', async () => {
  process.env.AVATAR_FRONT_DESK = 'desk-avatar';
  let reservedId = '';
  reply = ((path: string) => path !== '/v1/speech_sessions' ? null : new Promise<Response>((done) => setTimeout(() => {
    reservedId = `sp-${++reserved}`;
    done(Response.json({ sessionId: reservedId, url: 'wss://speech.test/v1/speech_sessions', token: 'jwt',
      tokenExpiresAt: '2026-10-27T12:01:00Z', actualDurationSeconds: 600 }, { status: 201 }));
  }, 300))) as unknown as typeof reply;
  const leaving = new AbortController();
  const asked = fetch(url('/apps/front-desk/speech'), { method: 'POST', signal: leaving.signal }).catch(() => null);
  setTimeout(() => leaving.abort(), 50);       // the tab closes before the session comes
  await asked;
  await vi.waitFor(() => expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/v1/speech_sessions/${reservedId}/end` }), { timeout: 3000 });
  // And it is no call of the page's: nothing reads or ends it again.
  expect((await fetch(url(`/apps/front-desk/speech/${reservedId}`))).status).toBe(404);
});

test("a refusal reaches the page as its code: an avatar with no voice, a key's cap", async () => {
  process.env.AVATAR_FRONT_DESK = 'mute-avatar';
  reply = (path) => (path === '/v1/speech_sessions' ? Response.json({ error: 'avatar_has_no_voice', message: 'the avatar has no voice' }, { status: 422 }) : null);
  const r = await post('/apps/front-desk/speech');
  expect(r.status).toBe(422);
  expect(await r.json()).toEqual({ error: 'avatar_has_no_voice', retryAfter: 0 });
});

test("the page reads its own call's state and cost, never its token, and ends only its own", async () => {
  process.env.AVATAR_FRONT_DESK = 'desk-avatar';
  const { sessionId } = await (await post('/apps/front-desk/speech')).json();
  const status = await (await fetch(url(`/apps/front-desk/speech/${sessionId}`))).json();
  expect(status).toMatchObject({ status: 'completed', endReason: 'ended_by_api', billedSeconds: 75, chargedMicrocredits: 125 });
  expect(status).not.toHaveProperty('token');

  expect((await post('/apps/front-desk/speech/someone-elses/end')).status).toBe(404);
  expect((await post(`/apps/parcel-help-desk/speech/${sessionId}/end`)).status).toBe(404);
  const end = await post(`/apps/front-desk/speech/${sessionId}/end`);
  expect(end.status).toBe(200);
  expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/v1/speech_sessions/${sessionId}/end` });
});

test('on shutdown every call not yet ended is ended, once', async () => {
  process.env.AVATAR_FRONT_DESK = 'desk-avatar';
  const a = (await (await post('/apps/front-desk/speech')).json()).sessionId;
  const b = (await (await post('/apps/front-desk/speech')).json()).sessionId;
  await post(`/apps/front-desk/speech/${b}/end`);
  calls.length = 0;
  await endLiveSessions();
  const ended = calls.map((c) => `${c.method} ${c.path}`);
  expect(ended).toContain(`POST /v1/speech_sessions/${a}/end`);
  expect(ended).not.toContain(`POST /v1/speech_sessions/${b}/end`);
  calls.length = 0;
  await endLiveSessions();
  expect(calls).toEqual([]);
});

test('only a speech app has the speech routes', async () => {
  process.env.AVATAR_PARCEL_HELP_DESK = 'x';
  expect((await post('/apps/parcel-help-desk/speech')).status).toBe(404);
  delete process.env.AVATAR_PARCEL_HELP_DESK;
});
