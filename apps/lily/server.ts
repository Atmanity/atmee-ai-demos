// Where Are You, Lily?: the server owns Lily's live session and serves the film (the four views of
// her back camera and the sounds). The map, the clues and the battery are all the page's.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { instructions, TOOLS } from './story.ts';

const ID = 'lily';
const CAP_S = Number(process.env.LILY_SESSION_CAP) || 300;
const FILM = resolve('apps/lily/film');
const VIDEOS = ['room', 'sign', 'window', 'door'];
const SOUNDS = ['train', 'water', 'steps', 'bang', 'sirens', 'ring', 'lowbatt'];
const fileOf = (n: string) => (VIDEOS.includes(n) ? `${n}.mp4` : SOUNDS.includes(n) ? `${n}.mp3` : n === 'lily' ? 'lily.jpg' : '');

const STAGING = (process.env.ATMEE_BASE_URL || 'https://staging.atmanity.us').includes('staging');
// Lily lives on production; another server sets LILY_AVATAR.
const LILY = process.env.LILY_AVATAR || (STAGING ? '' : '7b067f8f-0497-46e4-98e6-c06ae019a511');

const runs = new Map<string, number>();
const live = new Map<string, string>();   // sessionId -> run
const endAll = async (runId?: string) => {
  const ids = [...live].filter(([, r]) => !runId || r === runId).map(([id]) => id);
  await Promise.all(ids.map(async (id) => { await endSession(id); live.delete(id); }));
  return ids.length;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void endAll(); });

const app: AppServer = {
  id: ID,
  title: 'Where Are You, Lily?',
  tagline: "1:12 a.m. Your little sister is calling. She doesn't know where she is.",
  brand: { color: '#07090c', ink: '#f2f4f7' },
  maxSeconds: CAP_S,
  async shutdown() { await endAll(); },
  routes(router) {
    router.get('/film', (_req, res) => {
      res.json({ ready: [...VIDEOS, ...SOUNDS].every((n) => existsSync(`${FILM}/${fileOf(n)}`)), cast: Boolean(LILY), welcomes: !STAGING });
    });
    router.get('/film/:name', (req, res) => {
      const file = fileOf(req.params.name.replace(/\.(mp4|mp3|jpg)$/, ''));
      if (!file || !existsSync(`${FILM}/${file}`)) return void res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(`${FILM}/${file}`);
    });
    router.post('/run', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      runs.set(id, Date.now());
      for (const [key, at] of runs) if (Date.now() - at > 3600_000) runs.delete(key);
      res.status(201).json({ id });
    });
    router.post('/run/:run/lily/session', async (req, res) => {
      if (!runs.has(req.params.run)) return void res.status(404).json({ error: 'not_found' });
      if (!LILY) return void res.status(500).json({ error: 'no_avatar', message: 'Set LILY_AVATAR' });
      const ended = await endAll();
      if (ended) console.log('[%s] ended %d stale session(s)', ID, ended);
      const r = await startSession(LILY, CAP_S, { app: 'atmee-usecase-demos', usecase: ID }, { instructions: instructions(), tools: TOOLS }, undefined, STAGING ? { welcome: false } : {});
      if (!r.ok) {
        console.warn('[%s] POST /v1/session -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      live.set(r.session.sessionId, req.params.run);
      console.log('[%s] session %s', ID, r.session.sessionId);
      res.status(201).json(r.session);
    });
    router.post('/run/:run/lily/session/:id/end', async (req, res) => {
      if (!live.has(req.params.id)) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) live.delete(req.params.id);
      res.status(r.status).json(r.json);
    });
    router.post('/run/:run/end-all', async (req, res) => res.json({ ended: await endAll(req.params.run) }));
  },
};

export default app;
