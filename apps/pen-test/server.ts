// The Pen Test's server side: it owns each run. The page never holds a guest's real need or top
// price until the reveal. Each guest is their own session on their own avatar, started under
// /api/apps/pen-test/run/<run>/<n>/session so the page's useAvatar finds it like any app's.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { closingEvent, direction, secretInstructions, TOOLS } from './engine/director.ts';
import { guestById, type Guest } from './engine/guests.ts';
import { COACH_SCHEMA, COACH_SYSTEM, coachPrompt, JUDGE_SYSTEM, judgePrompt, normalise, VERDICT_SCHEMA, wordRules } from './engine/judge.ts';
import { applyVerdict, clockFor, earned, LEVELS, mayLeave, levelById, moneyLeft, newRound, PEN, LIST_PRICE, pickGuests, plainCoach, report, score, topNow, type Coach, type Level, type Round, type Step, type Verdict } from './engine/rules.ts';

const ID = 'pen-test';
// The plan's session cap: the clock has to end inside it.
const CAP_S = Number(process.env.PEN_TEST_SESSION_CAP) || 180;

// A local test can meet one guest first; the live game never sets it.
const guestOrder = (level: Level) => {
  const order = pickGuests(level);
  if (!process.env.PEN_TEST_FIRST) return order;
  const forced = guestById(process.env.PEN_TEST_FIRST);
  if (forced && !order.includes(forced)) order[0] = forced;
  const first = order.findIndex((g) => g.id === process.env.PEN_TEST_FIRST);
  if (first > 0) order.unshift(...order.splice(first, 1));
  return order;
};

// The same, for a guest's reason to buy.
const roundFor = (guest: Guest, level: Level) => {
  const round = newRound(guest, level);
  round.motive = guest.motives.find((m) => m.id === process.env.PEN_TEST_MOTIVE) ?? round.motive;
  return round;
};

interface Run { level: Level; rounds: Round[]; sessions: Map<number, string>; at: number }
const runs = new Map<string, Run>();

const roundOf = (runId: string, n: unknown) => {
  const run = runs.get(runId);
  const round = run?.rounds[Number(n)];
  return run && round ? { run, round, index: Number(n) } : null;
};

/** What the seller may see of a round: never the need or the top price while it is live. */
function view(run: Run, index: number) {
  const round = run.rounds[index];
  const guest = guestById(round.guestId)!;
  return { index, guest: { id: guest.id, name: guest.name, role: guest.role, spotted: guest.spotted, image: guest.image }, outcome: round.outcome, offer: round.offer, price: round.price, earned: earned(round) };
}
const scoreboard = (run: Run) => ({ money: run.rounds.reduce((n, r) => n + earned(r), 0), sold: run.rounds.filter((r) => r.outcome === 'sold').length });

async function judged(round: Round, text: string): Promise<Verdict> {
  if (!llmAvailable()) return wordRules(round, text);
  try {
    return normalise(await structured<Verdict>({ system: JUDGE_SYSTEM, user: judgePrompt(round, text), schema: VERDICT_SCHEMA }));
  } catch (err) {
    console.warn('[%s] judge failed (%s); using word rules', ID, (err as Error).message);
    return wordRules(round, text);
  }
}

async function coached(round: Round): Promise<Coach> {
  const plain = plainCoach(round);
  if (!llmAvailable() || !round.lines.some((l) => l.who === 'seller')) return plain;
  const coach = await structured<Coach>({ system: COACH_SYSTEM, user: coachPrompt(round), schema: COACH_SCHEMA }).catch(() => plain);
  return { did: coach.did || plain.did, improve: coach.improve?.length ? coach.improve.slice(0, 3) : plain.improve, best: coach.best ?? '', worst: coach.worst ?? '' };
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { for (const run of runs.values()) for (const id of run.sessions.values()) void endSession(id); });
}

const app: AppServer = {
  id: ID,
  title: 'The Pen Test',
  tagline: 'Three strangers. One pen. Read them, then sell it.',
  brand: { color: '#123a8c', ink: '#ffffff' },
  maxSeconds: CAP_S,
  routes(router) {
    router.get('/levels', (_req, res) => {
      res.json({ pen: { ...PEN, list: LIST_PRICE }, levels: LEVELS.map((l) => ({ id: l.id, name: l.name, blurb: l.blurb, lowest: l.lowest, hints: l.hints, seconds: clockFor(l, CAP_S) })) });
    });

    router.post('/run', (req, res) => {
      const level = levelById(req.body?.level);
      if (!level) return void res.status(400).json({ error: 'unknown_level' });
      const id = randomBytes(9).toString('hex');
      const run: Run = { level, rounds: guestOrder(level).map((g) => roundFor(g, level)), sessions: new Map(), at: Date.now() };
      runs.set(id, run);
      for (const [key, old] of runs) if (Date.now() - old.at > 3600_000) runs.delete(key);
      res.status(201).json({ id, seconds: clockFor(level, CAP_S), first: view(run, 0) });
    });

    // A guest's session: their avatar, with this run's secrets in the session's instructions.
    router.post('/run/:run/:n/session', async (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      const guest = guestById(found.round.guestId)!;
      const r = await startSession(guest.avatarId, CAP_S, { app: 'atmee-usecase-demos', usecase: ID, guest: guest.id }, { instructions: secretInstructions(found.round), tools: TOOLS });
      if (!r.ok) {
        console.warn('[%s] POST /v1/session -> %d %s %s', ID, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      found.run.sessions.set(found.index, r.session.sessionId);
      console.log('[%s] %s: session %s', ID, guest.id, r.session.sessionId);
      res.status(201).json(r.session);
    });

    router.post('/run/:run/:n/session/:id/end', async (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found || found.run.sessions.get(found.index) !== req.params.id) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) found.run.sessions.delete(found.index);
      res.status(r.status).json(r.json);
    });

    router.get('/run/:run/:n/direction', (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      res.json({ direction: direction(found.round) });
    });

    // A finished line of the conversation. The seller's are judged; the answer steers the guest.
    router.post('/run/:run/:n/line', async (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      const { round } = found;
      const text = String(req.body?.text ?? '').slice(0, 2000).trim();
      if (!text) return void res.json({ view: view(found.run, found.index) });
      if (req.body?.who !== 'seller') {
        round.lines.push({ who: 'guest', text, at: Date.now() });
        return void res.json({ view: view(found.run, found.index) });
      }
      const verdict = await judged(round, text);
      round.lines.push({ who: 'seller', text, at: Date.now() });
      const step: Step = applyVerdict(round, text, verdict);
      console.log('[%s] %s interest %d offer %s top %d %s verdict %s', ID, round.guestId, round.interest, round.offer, topNow(round), JSON.stringify(step), JSON.stringify(verdict));
      res.json({
        view: view(found.run, found.index),
        direction: direction(round, step),
        closing: step.sold || step.walked ? closingEvent(step) : undefined,
        refused: step.refused,
      });
    });

    // The guest called decide. Only a walk can come from the guest: a sale comes from the rules.
    router.post('/run/:run/:n/decide', (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      if (String(req.body?.choice ?? '').toLowerCase().includes('walk') && found.round.outcome === 'live' && mayLeave(found.round)) found.round.outcome = 'walked';
      res.json({ view: view(found.run, found.index) });
    });

    router.post('/run/:run/:n/finish', (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      if (found.round.outcome === 'live') found.round.outcome = req.body?.reason === 'void' ? 'void' : 'time';
      res.json({ view: view(found.run, found.index), next: found.index + 1 < found.run.rounds.length ? view(found.run, found.index + 1) : null });
    });

    // The feedback, and everything the guest was hiding.
    router.post('/run/:run/:n/feedback', async (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      const { round, run, index } = found;
      const guest = guestById(round.guestId)!;
      round.score = score(round);
      round.coach = await coached(round);
      res.json({
        view: view(run, index), clues: guest.clues, keyClue: round.motive.clue, motive: round.motive.label, top: round.price === null ? round.motive.top : topNow(round), left: moneyLeft(round),
        score: round.score, falseClaims: round.falseClaims, coach: round.coach, board: scoreboard(run),
        next: index + 1 < run.rounds.length ? view(run, index + 1) : null,
      });
    });

    // A guest met again, after a lost connection or to try again: that round's result is cleared.
    router.post('/run/:run/:n/replay', (req, res) => {
      const found = roundOf(req.params.run, req.params.n);
      if (!found) return void res.status(404).json({ error: 'not_found' });
      found.run.rounds[found.index] = roundFor(guestById(found.round.guestId)!, found.run.level);
      res.json({ view: view(found.run, found.index), board: scoreboard(found.run) });
    });

    router.get('/run/:run/report', (req, res) => {
      const run = runs.get(req.params.run);
      if (!run) return void res.status(404).json({ error: 'not_found' });
      res.json(report(run.rounds));
    });

  },
};

export default app;
