// Last Seen's server side: it owns each run (what Sam has proved) and the callers' sessions. The
// account runs one session at a time, so every new call first ends whatever is still live.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { CAST, ending, EVIDENCE, instructions, MIA, QUIET, shownEvent, shownState, toldState, TOOLS, WRAP, type Caller, type Destination } from './story.ts';

const ID = 'last-seen';
const CAP_S = Number(process.env.LAST_SEEN_SESSION_CAP) || 120;
const FILM = resolve('apps/last-seen/film');
const ASSETS = [...Object.keys(MIA), 'doorbell', 'ring', 'ding'];
const FILE: Record<string, string> = { ring: 'ring.mp3', ding: 'ding.mp3' };
const fileOf = (name: string) => FILE[name] ?? `${name}.mp4`;

const STAGING = (process.env.ATMEE_BASE_URL || 'https://staging.atmanity.us').includes('staging');
const AVATARS: Record<Caller, { staging: string; env: string }> = {
  theo: { staging: '20d3b8c4-d051-4c2e-b67b-26a520e1c397', env: 'LAST_SEEN_THEO' },
  jonah: { staging: '220fc83c-c3d3-4733-ba68-da716db8c30c', env: 'LAST_SEEN_JONAH' },
};
const avatarOf = (who: Caller) => process.env[AVATARS[who].env] || (STAGING ? AVATARS[who].staging : '');

interface Run { truths: Partial<Record<Caller, true>>; admitted: Partial<Record<Caller, string>>; at: number }
const runs = new Map<string, Run>();
/** Every live session this process started, by run and caller: at most one at a time on this account. */
const live = new Map<string, { run: string; who: Caller }>();
const callerOf = (v: string): Caller | null => (v === 'theo' || v === 'jonah' ? v : null);
const found = (runId: string, who: string) => {
  const run = runs.get(runId); const caller = callerOf(who);
  return run && caller ? { run, who: caller } : null;
};
const endAll = async (runId?: string) => {
  const ids = [...live].filter(([, v]) => !runId || v.run === runId).map(([id]) => id);
  await Promise.all(ids.map(async (id) => { await endSession(id); live.delete(id); }));
  return ids.length;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void endAll(); });

const app: AppServer = {
  id: ID,
  title: 'Last Seen',
  tagline: "1:12 a.m. Your sister hasn't come home. Two people know where she is, and both are lying.",
  brand: { color: '#0d1420', ink: '#e8eef7' },
  maxSeconds: CAP_S,
  async shutdown() { await endAll(); },
  routes(router) {
    router.get('/film', (_req, res) => {
      res.json({
        ready: ASSETS.every((a) => existsSync(`${FILM}/${fileOf(a)}`)) && existsSync(`${FILM}/theo.jpg`) && existsSync(`${FILM}/jonah.jpg`),
        cast: { theo: Boolean(avatarOf('theo')), jonah: Boolean(avatarOf('jonah')) },
        people: Object.fromEntries((['theo', 'jonah'] as const).map((c) => [c, { name: CAST[c].name, where: CAST[c].where, chips: CAST[c].chips }])),
        evidence: Object.fromEntries((['theo', 'jonah'] as const).map((c) => [c, { from: EVIDENCE[c].from, text: EVIDENCE[c].text, media: EVIDENCE[c].media, lie: EVIDENCE[c].lie, truth: EVIDENCE[c].truth }])),
        mia: MIA,
      });
    });

    router.get('/film/:name', (req, res) => {
      const name = req.params.name.replace(/\.(mp4|mp3|jpg)$/, '');
      const file = ['theo', 'jonah', 'mia'].includes(name) ? `${name}.jpg` : ASSETS.includes(name) ? fileOf(name) : '';
      if (!file || !existsSync(`${FILM}/${file}`)) return void res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(`${FILM}/${file}`);
    });

    router.post('/run', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      runs.set(id, { truths: {}, admitted: {}, at: Date.now() });
      for (const [key, old] of runs) if (Date.now() - old.at > 3600_000) runs.delete(key);
      res.status(201).json({ id });
    });

    // A caller's session, with what Sam has already proved in its instructions.
    router.post('/run/:run/:who/session', async (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      const avatarId = avatarOf(f.who);
      if (!avatarId) return void res.status(500).json({ error: 'no_avatar', message: `Set ${AVATARS[f.who].env}` });
      // One line at a time: hang up anything still live before ringing the next caller.
      const ended = await endAll();
      if (ended) console.log('[%s] ended %d stale session(s) before %s', ID, ended, f.who);
      const known = (Object.keys(f.run.truths) as Caller[]).filter((c) => c !== f.who).map((c) => EVIDENCE[c].truth);
      const r = await startSession(avatarId, CAP_S, { app: 'atmee-usecase-demos', usecase: ID, caller: f.who }, { instructions: instructions(f.who, known), tools: TOOLS }, undefined, STAGING ? { welcome: false } : {});
      if (!r.ok) {
        console.warn('[%s] POST /v1/session -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      live.set(r.session.sessionId, { run: req.params.run, who: f.who });
      console.log('[%s] %s: session %s', ID, f.who, r.session.sessionId);
      res.status(201).json(r.session);
    });

    router.post('/run/:run/:who/session/:id/end', async (req, res) => {
      if (!live.has(req.params.id)) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) live.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    // A closing tab (sendBeacon) or a finished film: nothing of this run may keep the line busy.
    router.post('/run/:run/end-all', async (req, res) => res.json({ ended: await endAll(req.params.run) }));

    router.get('/run/:run/:who/cue', (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      res.json({ opening: CAST[f.who].opening, wrap: WRAP, quiet: QUIET, shownState: shownState(f.who), shownEvent: shownEvent(f.who), toldState: toldState(f.who), said: EVIDENCE[f.who].said.source, quietStart: STAGING });
    });

    // Sam showed the caller the evidence: the lie is broken, whatever the caller says next.
    router.post('/run/:run/:who/shown', (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      f.run.truths[f.who] = true;
      res.json({ truth: EVIDENCE[f.who].truth });
    });

    router.post('/run/:run/:who/admitted', (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      f.run.admitted[f.who] = String(req.body?.what ?? '').slice(0, 300);
      res.json({ ok: true });
    });

    router.post('/run/:run/ending', (req, res) => {
      const run = runs.get(req.params.run);
      if (!run) return void res.status(404).json({ error: 'not_found' });
      const destination: Destination = req.body?.destination === 'bridge' ? 'bridge' : 'party';
      const truths = Object.keys(run.truths).length;
      res.json({ ...ending(destination, truths), truths, found: (Object.keys(run.truths) as Caller[]).map((c) => EVIDENCE[c].truth) });
    });
  },
};

export default app;
