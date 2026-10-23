import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// The Avatar API, faked: every call is recorded; the page-side calls go to the real server.
const BASE = 'https://avatar-api.test';
const calls: string[] = [];
const realFetch = globalThis.fetch;
let server: Server;
let port: number;
let endLiveSessions: () => Promise<void>;

beforeAll(async () => {
  process.env.ATMEE_BASE_URL = BASE;
  process.env.ATMEE_API_KEY = 'test-key';
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(BASE)) return realFetch(url, init);
    const path = u.slice(BASE.length);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/v1/session') return Response.json({ sessionId: `s-${calls.length}`, serverUrl: 'wss://lk.test', userToken: 't', actualDurationSeconds: 600 }, { status: 201 });
    if (path.endsWith('/end')) return Response.json({ status: 'completed' });
    return new Response(null, { status: 204 });
  });
  const mod = await import('./api.ts');
  endLiveSessions = mod.endLiveSessions;
  const app = express();
  app.use('/api', express.json(), mod.api);
  server = createServer(app);
  port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
});
afterAll(() => { server?.close(); vi.unstubAllGlobals(); });

const start = async (app: string) => (await (await fetch(`http://127.0.0.1:${port}/api/apps/${app}/session`, { method: 'POST' })).json()).sessionId as string;

test('on shutdown every session still live is ended, once; one the page already ended is left alone', async () => {
  const a = await start('guess-the-city');
  const b = await start('chess-opponent');
  const c = await start('travel-guide');
  expect((await fetch(`http://127.0.0.1:${port}/api/apps/chess-opponent/session/${b}/end`, { method: 'POST' })).status).toBe(200);
  calls.length = 0;

  await endLiveSessions();
  expect(calls.sort()).toEqual([`POST /v1/session/${a}/end`, `POST /v1/session/${c}/end`].sort());

  calls.length = 0;
  await endLiveSessions();
  expect(calls).toEqual([]);
});
