// The Stairs' server side: it owns each run. Each parent is their own session on their own
// avatar, started under /api/apps/the-stairs/run/<run>/<parent>/session so the page's useAvatar
// finds it. The page relays the lines; the server decides the bridge and the ending.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import {
  bridgeFor, bridgeShots, endingFor, ENDINGS, instructions, TOOLS, JUDGE_SCHEMA, JUDGE_SYSTEM, judgePrompt, normalise, OPENING, opening, SHOTS, WRAP, wordRules,
  type Choice, type Met, type Parent, type Said,
} from './story.ts';

const ID = 'the-stairs';
// Each call connects while the film plays, then runs about fifty seconds.
const CAP_S = Number(process.env.THE_STAIRS_SESSION_CAP) || 150;
const FILM = resolve('apps/the-stairs/film');

// An avatar lives on one server. Production has none yet: set THE_STAIRS_CLAIRE / _MARK.
const CAST: Record<Parent, { staging: string; env: string }> = {
  claire: { staging: '91411c3f-b675-485a-a740-05636acad0b2', env: 'THE_STAIRS_CLAIRE' },
  mark: { staging: '37472b8f-4236-4551-a053-b9c01581613a', env: 'THE_STAIRS_MARK' },
};
// server/atmee.ts talks to staging when ATMEE_BASE_URL is unset.
const STAGING = (process.env.ATMEE_BASE_URL || 'https://staging.atmanity.us').includes('staging');
const avatarOf = (who: Parent) => process.env[CAST[who].env] || (STAGING ? CAST[who].staging : '');
// Staging takes `welcome: false`: the parent waits, hidden, until the page cues them.
const QUIET_START = STAGING;

interface Run { choice: Choice; lines: Record<Parent, Said[]>; met: Partial<Record<Parent, Met>>; sessions: Partial<Record<Parent, string>>; at: number }
const runs = new Map<string, Run>();
const parentOf = (v: string): Parent | null => (v === 'claire' || v === 'mark' ? v : null);
const found = (runId: string, who: string) => {
  const run = runs.get(runId);
  const parent = parentOf(who);
  return run && parent ? { run, who: parent } : null;
};

async function judged(who: Parent, lines: Said[]): Promise<Met> {
  if (!llmAvailable() || !lines.some((l) => l.who === 'sam')) return wordRules(lines);
  try {
    return normalise(await structured<Met>({ system: JUDGE_SYSTEM, user: judgePrompt(who, lines), schema: JUDGE_SCHEMA }));
  } catch (err) {
    console.warn('[%s] judge failed (%s); using word rules', ID, (err as Error).message);
    return wordRules(lines);
  }
}

const endAll = (run: Run) => Promise.all(Object.values(run.sessions).map((id) => id && endSession(id)));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { for (const run of runs.values()) void endAll(run); });

const app: AppServer = {
  id: ID,
  title: 'The Stairs',
  tagline: "It's late. They're fighting again. You're ten, and they both want to talk to you.",
  brand: { color: '#2a1d14', ink: '#f3e6d3' },
  maxSeconds: CAP_S,
  async shutdown() { await Promise.all([...runs.values()].map(endAll)); },
  routes(router) {
    // The film's shots and its fixed order; the page fetches every clip before it starts.
    router.get('/film', (_req, res) => {
      res.json({ shots: SHOTS, opening: OPENING, ready: Object.keys(SHOTS).every((id) => existsSync(`${FILM}/${id}.mp4`)), cast: { claire: Boolean(avatarOf('claire')), mark: Boolean(avatarOf('mark')) } });
    });

    router.get('/film/:shot.mp4', (req, res) => {
      if (!SHOTS[req.params.shot]) return void res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(`${FILM}/${req.params.shot}.mp4`);
    });

    router.post('/run', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      runs.set(id, { choice: 'stay', lines: { claire: [], mark: [] }, met: {}, sessions: {}, at: Date.now() });
      for (const [key, old] of runs) if (Date.now() - old.at > 3600_000) runs.delete(key);
      res.status(201).json({ id });
    });

    router.post('/run/:run/choice', (req, res) => {
      const run = runs.get(req.params.run);
      if (!run) return void res.status(404).json({ error: 'not_found' });
      run.choice = req.body?.choice === 'step' ? 'step' : 'stay';
      res.json({ choice: run.choice });
    });

    // A parent's session: their avatar, with this run's story so far in its instructions.
    router.post('/run/:run/:who/session', async (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      const avatarId = avatarOf(f.who);
      if (!avatarId) return void res.status(500).json({ error: 'no_avatar', message: `Set ${CAST[f.who].env}` });
      const appTools = { instructions: instructions(f.who, { choice: f.run.choice, claire: f.run.met.claire, claireLines: f.run.lines.claire }), tools: TOOLS };
      const r = await startSession(avatarId, CAP_S, { app: 'atmee-usecase-demos', usecase: ID, parent: f.who }, appTools, undefined, QUIET_START ? { welcome: false } : {});
      if (!r.ok) {
        console.warn('[%s] POST /v1/session -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      f.run.sessions[f.who] = r.session.sessionId;
      console.log('[%s] %s: session %s', ID, f.who, r.session.sessionId);
      res.status(201).json(r.session);
    });

    router.post('/run/:run/:who/session/:id/end', async (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f || f.run.sessions[f.who] !== req.params.id) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) delete f.run.sessions[f.who];
      res.status(r.status).json(r.json);
    });

    // What makes the parent speak first at the cut, and the wrap-up line.
    router.get('/run/:run/:who/cue', (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      res.json({ opening: opening(f.who, f.run.choice), wrap: WRAP, quietStart: QUIET_START });
    });

    router.post('/run/:run/:who/line', (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      const text = String(req.body?.text ?? '').slice(0, 1000).trim();
      const kind = req.body?.who === 'sam' || req.body?.who === 'noticed' ? req.body.who : 'parent';
      if (text) f.run.lines[f.who].push({ who: kind, text });
      res.json({ ok: true });
    });

    // A call is over: how Sam met this parent, and what the film plays next.
    router.post('/run/:run/:who/done', async (req, res) => {
      const f = found(req.params.run, req.params.who);
      if (!f) return void res.status(404).json({ error: 'not_found' });
      const met = await judged(f.who, f.run.lines[f.who]);
      f.run.met[f.who] = met;
      console.log('[%s] %s met: %s', ID, f.who, JSON.stringify(met));
      if (f.who === 'claire') return void res.json({ met, next: bridgeShots(bridgeFor(met)) });
      const ending = endingFor(f.run.met.claire ?? { stance: 'silent', summary: '' }, met);
      res.json({ met, ending, next: ENDINGS[ending].shots, title: ENDINGS[ending].title, line: ENDINGS[ending].line, stances: { claire: f.run.met.claire?.stance ?? 'silent', mark: met.stance } });
    });
  },
};

export default app;
