import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import WebSocket from 'ws';
import { isMiniAppPath } from './site.ts';

test('the mini-apps own /apps and /api/apps (and their page files); everything else is the five apps', () => {
  for (const p of ['/apps', '/apps/', '/apps/guess-the-city/', '/api/apps', '/api/apps/guess-the-city/session']) expect(isMiniAppPath(p, true)).toBe(true);
  for (const p of ['/', '/index.html', '/training.html', '/kit.js', '/api/usecases', '/api/training/session', '/api/avatars/game/portrait', '/healthz', '/appsx', '/api/appsx'])
    expect(isMiniAppPath(p, true)).toBe(false);
  expect(isMiniAppPath('/assets/index-abc.js', true)).toBe(true);
  expect(isMiniAppPath('/assets/index-abc.js', false)).toBe(false);
  for (const p of ['/@vite/client', '/@react-refresh', '/src/kit/index.ts', '/node_modules/.vite/deps/react.js']) {
    expect(isMiniAppPath(p, false)).toBe(true);
    expect(isMiniAppPath(p, true)).toBe(false);
  }
});

// server.js mounted in this process, as the site's server does: its routes answer
// through a server it did not create, and it does not open a port of its own.
let server: Server;
let port: number;
beforeAll(async () => {
  process.env.ATMEE_API_KEY ||= 'test-key-unused';
  const five = await import('../server.js');
  server = createServer(five.app);
  server.on('upgrade', five.handleUpgrade);
  port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
});
afterAll(() => { server?.close(); });

test('the five apps answer from inside the site\'s server: their pages, API and WebSocket', async () => {
  expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  const home = await fetch(`http://127.0.0.1:${port}/`);
  expect(await home.text()).toContain('avatar platform');
  const usecases = await (await fetch(`http://127.0.0.1:${port}/api/usecases`)).json();
  expect(Object.keys(usecases)).toEqual(expect.arrayContaining(['training', 'recruiter', 'presence', 'game', 'livestream']));
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?usecase=livestream&role=viewer`);
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
  ws.close();
});
