// Fitness Coach's server side. It owns the session: the step machine (the
// original's five AgentTasks), the plan model call and the enforcement of the
// user's limits on it, the clearance hold, and the demo clip (xAI, if a key is
// configured, kept and served from this app's own route). The page draws the
// view it is given and relays outcomes to the avatar.
//
// Why on the server: the plan and the demo come from paid APIs whose keys stay
// here; and the board must have ONE writer that can re-check the safety hold
// after every await. A page-side engine would be a second writer racing it.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { Coach } from './engine/coach.ts';
import { judge, type Ask } from './engine/judge.ts';
import { PLAN_SCHEMA, PLAN_SYSTEM_PROMPT, planFromData, planPrompt } from './engine/plan.ts';
import type { Command, Outcome } from './engine/types.ts';
import { DemoRenderer, referenceImageUrls } from './engine/video.ts';

const ID = 'fitness-coach';
const COMMANDS: Command[] = ['goal', 'level', 'move', 'relevel', 'restart'];

interface Session { coach: Coach; at: number }
const sessions = new Map<string, Session>();
/** Rendered clips, kept in memory and served same-origin (the page never sees the provider's URL). */
const clips = new Map<string, { type: string; body: Buffer }>();
const MAX_CLIPS = 24;

function storeClip(bytes: Uint8Array, type: string): string {
  const token = randomBytes(12).toString('hex');
  clips.set(token, { type, body: Buffer.from(bytes) });
  while (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!);
  return `/api/apps/${ID}/clips/${token}`;
}

/** The app's own model call for the judge, when a Gemini key is set. */
const ask: Ask | undefined = llmAvailable()
  ? (request) => structured({ ...request, temperature: 0 })
  : undefined;

function newCoach(seed: string): Coach {
  return new Coach({
    seed,
    // Without a Gemini key the built-in plan is used, enforced like any other.
    generatePlan: llmAvailable()
      ? async ({ goal, level, constraints }) => planFromData(
        await structured<Record<string, unknown>>({ system: PLAN_SYSTEM_PROMPT, user: planPrompt(goal, level, constraints), schema: PLAN_SCHEMA, temperature: 0.8 }),
        { goal, level },
      )
      : undefined,
    // Without XAI_API_KEY the renderer reports demos as off and calls nothing.
    renderer: (hooks) => new DemoRenderer({ ...hooks, store: storeClip }),
    hasReference: referenceImageUrls().length > 0,
  });
}

function prune() {
  for (const [id, s] of sessions) {
    if (Date.now() - s.at > 3 * 3600_000) {
      s.coach.dispose();
      sessions.delete(id);
    }
  }
}

const app: AppServer = {
  id: ID,
  title: 'Fitness Coach',
  tagline: 'Tell a coach your goal, level and limits; get a plan that honours them and a walk-through of the first move.',
  // No conductor: the app's step machine is the source of truth. A conductor
  // judged per turn would be a second decider that can disagree with it (the
  // avatar asking "which move first?" over a board with no plan yet).
  conductor: null,
  maxSeconds: 900,
  routes(router) {
    router.post('/sessions', (req, res) => {
      prune();
      const id = randomBytes(9).toString('hex');
      const seed = String(req.body?.seed ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || id;
      const coach = newCoach(seed);
      sessions.set(id, { coach, at: Date.now() });
      res.json({ id, outcome: coach.open() });
    });

    router.post('/sessions/:id/act', async (req, res) => {
      const session = sessions.get(req.params.id);
      if (!session) return void res.status(404).json({ error: 'no_session' });
      session.at = Date.now();
      const { command, value, text, how } = (req.body ?? {}) as { command?: string; value?: string; text?: string; how?: string };
      if (command) {
        if (!COMMANDS.includes(command as Command)) return void res.status(400).json({ error: 'unknown_command' });
        return void res.json(session.coach.command(command as Command, String(value ?? '')) satisfies Outcome);
      }
      const said = typeof text === 'string' ? text.trim().slice(0, 600) : '';
      if (!said) return void res.status(400).json({ error: 'nothing_to_do' });
      try {
        // A failed model call inside is judged as "no intent", never an error.
        const judgement = await judge(said, session.coach.context(), ask);
        res.json(session.coach.hear(judgement, how === 'spoken' ? 'spoken' : 'typed') satisfies Outcome);
      } catch (err) {
        console.warn('[%s] [Act] judging a line failed (%s)', ID, (err as Error).message);
        res.status(500).json({ error: 'act_failed' });
      }
    });

    // Outcomes of background work: a plan landing, a rebuild, a demo status.
    router.get('/sessions/:id/stream', (req, res) => {
      const session = sessions.get(req.params.id);
      if (!session) return void res.status(404).end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': open\n\n');
      const off = session.coach.subscribe((outcome) => { res.write(`data: ${JSON.stringify(outcome)}\n\n`); });
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        off();
        clearInterval(ping);
      });
    });

    // The demo clips, with byte ranges (a <video> asks for them to seek and loop).
    router.get('/clips/:token', (req, res) => {
      const clip = clips.get(req.params.token);
      if (!clip) return void res.status(404).end();
      const size = clip.body.length;
      res.setHeader('Content-Type', clip.type);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (!range || (!range[1] && !range[2])) {
        res.setHeader('Content-Length', String(size));
        return void res.end(clip.body);
      }
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return void res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.end(clip.body.subarray(start, end + 1));
    });
  },
};

export default app;
