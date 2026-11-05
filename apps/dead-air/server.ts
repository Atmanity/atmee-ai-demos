// Dead Air's server side: it owns each run and the callers' sessions. The
// account runs one session at a time, so every new call first ends whatever is still live.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { CALLERS, instructions, OUTCOME, TOOLS, type Friend } from './story.ts';

const ID = 'dead-air';
const CAP_S = Number(process.env.DEAD_AIR_SESSION_CAP) || 120;
const FILM = resolve('apps/dead-air/film');
// Everything the page plays, by name: videos are .mp4, sounds .mp3, stills .jpg.
// The phones' own views when they stop pointing at a face, and the security cameras.
const VIDEOS = ['figure', 'charge', 'ceiling', 'road', 'crash'];
const SOUNDS = ['ring', 'ding', 'flicker', 'scream', 'shriek', 'thud', 'drop', 'drone', 'breath', 'skid', 'impact', 'horn', 'tinnitus'];
const STILLS = ['jake', 'maya'];
const fileOf = (n: string) => (VIDEOS.includes(n) ? `${n}.mp4` : SOUNDS.includes(n) ? `${n}.mp3` : STILLS.includes(n) ? `${n}.jpg` : '');

const STAGING = (process.env.ATMEE_BASE_URL || 'https://staging.atmanity.us').includes('staging');
const AVATARS: Record<Friend, { staging: string; env: string }> = {
  jake: { staging: 'b2c29951-36bd-4a68-bc64-8eed366e905d', env: 'DEAD_AIR_JAKE' },
  maya: { staging: 'bb64ce62-5f82-4223-a1b4-633ba6e0d31f', env: 'DEAD_AIR_MAYA' },
};
const avatarOf = (f: Friend) => process.env[AVATARS[f].env] || (STAGING ? AVATARS[f].staging : '');

interface Run { at: number }
const runs = new Map<string, Run>();
const live = new Map<string, string>();       // sessionId -> run
const friendOf = (v: string): Friend | null => (v === 'jake' || v === 'maya' ? v : null);
const endAll = async (runId?: string) => {
  const ids = [...live].filter(([, r]) => !runId || r === runId).map(([id]) => id);
  await Promise.all(ids.map(async (id) => { await endSession(id); live.delete(id); }));
  return ids.length;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void endAll(); });

const app: AppServer = {
  id: ID,
  title: 'Dead Air',
  tagline: 'Your friend is closing the mall alone, and he just video-called you because he is bored.',
  brand: { color: '#120607', ink: '#f2e9e9' },
  maxSeconds: CAP_S,
  async shutdown() { await endAll(); },
  routes(router) {
    router.get('/film', (_req, res) => {
      res.json({
        ready: [...VIDEOS, ...SOUNDS, ...STILLS].every((n) => existsSync(`${FILM}/${fileOf(n)}`)),
        cast: { jake: Boolean(avatarOf('jake')), maya: Boolean(avatarOf('maya')) },
        callers: Object.fromEntries((['jake', 'maya'] as const).map((f) => [f, { name: CALLERS[f].name, where: CALLERS[f].where, chips: CALLERS[f].chips, beats: CALLERS[f].beats }])),
        sounds: SOUNDS, videos: VIDEOS,
      });
    });

    router.get('/film/:name', (req, res) => {
      const file = fileOf(req.params.name.replace(/\.(mp4|mp3|jpg)$/, ''));
      if (!file || !existsSync(`${FILM}/${file}`)) return void res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(`${FILM}/${file}`);
    });

    router.post('/run', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      runs.set(id, { at: Date.now() });
      for (const [key, old] of runs) if (Date.now() - old.at > 3600_000) runs.delete(key);
      res.status(201).json({ id });
    });

    router.post('/run/:run/:who/session', async (req, res) => {
      const friend = friendOf(req.params.who);
      if (!runs.has(req.params.run) || !friend) return void res.status(404).json({ error: 'not_found' });
      const avatarId = avatarOf(friend);
      if (!avatarId) return void res.status(500).json({ error: 'no_avatar', message: `Set ${AVATARS[friend].env}` });
      // One line at a time: hang up anything still live before ringing the next caller.
      const ended = await endAll();
      if (ended) console.log('[%s] ended %d stale session(s) before %s', ID, ended, friend);
      const r = await startSession(avatarId, CAP_S, { app: 'atmee-usecase-demos', usecase: ID, caller: friend }, { instructions: instructions(friend), tools: TOOLS }, undefined, STAGING ? { welcome: false } : {});
      if (!r.ok) {
        console.warn('[%s] POST /v1/session -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      live.set(r.session.sessionId, req.params.run);
      console.log('[%s] %s: session %s', ID, friend, r.session.sessionId);
      res.status(201).json(r.session);
    });

    router.post('/run/:run/:who/session/:id/end', async (req, res) => {
      if (!live.has(req.params.id)) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) live.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    router.post('/run/:run/end-all', async (req, res) => res.json({ ended: await endAll(req.params.run) }));

    router.get('/run/:run/:who/cue', (req, res) => {
      const friend = friendOf(req.params.who);
      if (!runs.has(req.params.run) || !friend) return void res.status(404).json({ error: 'not_found' });
      res.json({ opening: CALLERS[friend].opening, beats: CALLERS[friend].beats, quietStart: STAGING });
    });

    router.post('/run/:run/ending', (req, res) => {
      const run = runs.get(req.params.run);
      if (!run) return void res.status(404).json({ error: 'not_found' });
      res.json(OUTCOME);
    });
  },
};

export default app;
