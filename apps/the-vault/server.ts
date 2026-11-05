// The Vault's server side: it owns each run's trust and Walter's session. Every line the
// negotiator says is judged here; the answer says what Walter may now share, and the ending.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { atDeadline, DEADLINE_S, ENDINGS, instructions, JUDGE_SCHEMA, JUDGE_SYSTEM, normalise, readOf, START_TRUST, stateFor, step, TOOLS, unlocked, wordVerdict, type Run, type Verdict } from './story.ts';

const ID = 'the-vault';
const CAP_S = Number(process.env.THE_VAULT_SESSION_CAP) || DEADLINE_S + 60;
const FILM = resolve('apps/the-vault/film');
const VIDEOS: string[] = [];
const SOUNDS = ['static', 'alarm', 'tick', 'hum', 'clunk'];
const fileOf = (n: string) => (VIDEOS.includes(n) ? `${n}.mp4` : SOUNDS.includes(n) ? `${n}.mp3` : n === 'walter' ? 'walter.jpg' : '');

const BASE = process.env.ATMEE_BASE_URL || 'https://staging.atmanity.us';
const STAGING = BASE.includes('staging');
// Walter lives on production; another server sets THE_VAULT_WALTER.
const WALTER = process.env.THE_VAULT_WALTER || (STAGING ? '' : 'e9a821f3-4c5a-4f4e-a2b1-df89862d5fa8');

const runs = new Map<string, Run>();
const live = new Map<string, string>();   // sessionId -> run
const endAll = async (runId?: string) => {
  const ids = [...live].filter(([, r]) => !runId || r === runId).map(([id]) => id);
  await Promise.all(ids.map(async (id) => { await endSession(id); live.delete(id); }));
  return ids.length;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void endAll(); });

async function judged(text: string): Promise<Verdict> {
  if (!llmAvailable()) return wordVerdict(text);
  try {
    return normalise(await structured<Verdict>({ system: JUDGE_SYSTEM, user: `The negotiator said: "${text}"`, schema: JUDGE_SCHEMA }));
  } catch (err) {
    console.warn('[%s] judge failed (%s); using word rules', ID, (err as Error).message);
    return wordVerdict(text);
  }
}
const view = (run: Run) => ({ trust: run.trust, read: readOf(run.trust), state: stateFor(run.trust, run.lies), notes: unlocked(run.trust).map((l) => ({ id: l.id, note: l.note, said: l.said.source })) });

const app: AppServer = {
  id: ID,
  title: 'The Vault',
  tagline: "2:57 a.m. A night guard has locked himself in the bank vault. He asked for someone who'll listen.",
  brand: { color: '#10161d', ink: '#e6edf3' },
  maxSeconds: CAP_S,
  async shutdown() { await endAll(); },
  routes(router) {
    router.get('/film', (_req, res) => {
      res.json({ ready: [...VIDEOS, ...SOUNDS].every((n) => existsSync(`${FILM}/${fileOf(n)}`)), cast: Boolean(WALTER), deadline: DEADLINE_S, endings: ENDINGS, videos: VIDEOS, sounds: SOUNDS });
    });

    router.get('/film/:name', (req, res) => {
      const file = fileOf(req.params.name.replace(/\.(mp4|mp3|jpg)$/, ''));
      if (!file || !existsSync(`${FILM}/${file}`)) return void res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(`${FILM}/${file}`);
    });

    router.post('/run', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const run: Run = { trust: START_TRUST, lies: 0, ended: null, at: Date.now() };
      runs.set(id, run);
      for (const [key, old] of runs) if (Date.now() - old.at > 3600_000) runs.delete(key);
      res.status(201).json({ id, ...view(run) });
    });

    router.post('/run/:run/walter/session', async (req, res) => {
      if (!runs.has(req.params.run)) return void res.status(404).json({ error: 'not_found' });
      if (!WALTER) return void res.status(500).json({ error: 'no_avatar', message: 'Set THE_VAULT_WALTER' });
      const ended = await endAll();
      if (ended) console.log('[%s] ended %d stale session(s)', ID, ended);
      const r = await startSession(WALTER, CAP_S, { app: 'atmee-usecase-demos', usecase: ID }, { instructions: instructions(), tools: TOOLS }, undefined, STAGING ? { welcome: false } : {});
      if (!r.ok) {
        console.warn('[%s] POST /v1/session -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      live.set(r.session.sessionId, req.params.run);
      console.log('[%s] session %s', ID, r.session.sessionId);
      res.status(201).json(r.session);
    });

    router.post('/run/:run/walter/session/:id/end', async (req, res) => {
      if (!live.has(req.params.id)) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) live.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    router.post('/run/:run/end-all', async (req, res) => res.json({ ended: await endAll(req.params.run) }));

    // A line the negotiator said: judged, applied to trust, and maybe an ending.
    router.post('/run/:run/said', async (req, res) => {
      const run = runs.get(req.params.run);
      if (!run) return void res.status(404).json({ error: 'not_found' });
      const text = String(req.body?.text ?? '').slice(0, 600).trim();
      if (!text || run.ended) return void res.json({ ...view(run), ending: run.ended });
      const v = await judged(text);
      const ending = step(run, v);
      if (ending) run.ended = ending;
      console.log('[%s] trust %d (warmth %d, lie %s, asks out %s)%s', ID, run.trust, v.warmth, v.lie, v.asksOut, ending ? ` -> ${ending}` : '');
      res.json({ ...view(run), verdict: v, ending });
    });

    router.post('/run/:run/deadline', (req, res) => {
      const run = runs.get(req.params.run);
      if (!run) return void res.status(404).json({ error: 'not_found' });
      if (!run.ended) run.ended = atDeadline(run);
      res.json({ ...view(run), ending: run.ended });
    });
  },
};

export default app;
