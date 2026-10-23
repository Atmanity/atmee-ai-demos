// Spotter's server side. It owns each training session: the coach (the step
// machine, the plan model call and the enforcement of the user's limits on it,
// the safety hold, the move video), answers Sammy's tool calls and the user's
// taps with one set of actions (engine/actions.ts), and streams what finishes
// in the background (a plan landing, a rebuild, a video).
//
// Why on the server: the plan and the video come from paid APIs whose keys
// stay here; and the board must have ONE writer that can re-check the safety
// hold after every await.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { hold, press, Relay, runTool } from './engine/actions.ts';
import { Coach } from './engine/coach.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { PLAN_SCHEMA, PLAN_SYSTEM_PROMPT, planFromData, planPrompt } from './engine/plan.ts';
import type { Command, View } from './engine/types.ts';
import { DemoRenderer, referenceImageUrls } from './engine/video.ts';

const ID = 'fitness-coach';
const COMMANDS: Command[] = ['goal', 'level', 'move', 'relevel', 'restart'];
const ACTIONS = new Set(TOOLS.map((t) => t.name));

interface Session { coach: Coach; relay: Relay; at: number }
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
    // Without XAI_API_KEY the renderer reports videos as off and calls nothing.
    renderer: (hooks) => new DemoRenderer({ ...hooks, store: storeClip }),
    hasReference: referenceImageUrls().length > 0,
  });
}

function prune() {
  for (const [id, s] of sessions) {
    if (Date.now() - s.at > 3 * 3600_000) {
      s.relay.close();
      s.coach.dispose();
      sessions.delete(id);
    }
  }
}

const app: AppServer = {
  id: ID,
  title: 'Spotter',
  tagline: 'A workout built around you, coached by Sammy.',
  brand: { color: '#ff7a1a', ink: '#1c1e21' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/sessions', (req, res) => {
      prune();
      const id = randomBytes(9).toString('hex');
      const seed = String(req.body?.seed ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || id;
      const coach = newCoach(seed);
      sessions.set(id, { coach, relay: new Relay(coach), at: Date.now() });
      const opened = coach.open();
      res.json({ id, view: opened.view, opening: opened.events[0]?.text ?? '' });
    });

    const find = (id: string) => {
      const session = sessions.get(id);
      if (session) session.at = Date.now();
      return session;
    };

    // Sammy's tool calls: the result is what she says next.
    router.post('/sessions/:id/tool', async (req, res) => {
      const session = find(req.params.id);
      if (!session) return void res.status(404).json({ error: 'no_session' });
      const { name, arguments: args } = (req.body ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!name || !ACTIONS.has(name)) return void res.status(400).json({ error: 'unknown_tool' });
      try {
        const run = await runTool(session.coach, session.relay, name, args ?? {});
        session.relay.poke();
        res.json({ view: run.view, result: run.text } satisfies { view: View; result: string });
      } catch (err) {
        console.warn('[%s] [Tool] %s failed (%s)', ID, name, (err as Error).message);
        res.status(500).json({ error: 'tool_failed' });
      }
    });

    // The user's taps: they act at once; Sammy cannot see them, so the page tells her.
    router.post('/sessions/:id/act', (req, res) => {
      const session = find(req.params.id);
      if (!session) return void res.status(404).json({ error: 'no_session' });
      const { command, value } = (req.body ?? {}) as { command?: string; value?: string };
      if (!command || !COMMANDS.includes(command as Command)) return void res.status(400).json({ error: 'unknown_command' });
      const done = press(session.coach, command as Command, String(value ?? '').slice(0, 160));
      session.relay.poke();
      res.json(done);
    });

    // The page's own safety check: it heard a condition in the user's words and freezes the plan now.
    router.post('/sessions/:id/hold', (req, res) => {
      const session = find(req.params.id);
      if (!session) return void res.status(404).json({ error: 'no_session' });
      const view = hold(session.coach, String((req.body as { text?: string })?.text ?? ''));
      if (!view) return void res.status(400).json({ error: 'no_condition' });
      session.relay.poke();
      res.json({ view });
    });

    // Outcomes of background work: a plan landing, a rebuild, a video.
    router.get('/sessions/:id/stream', (req, res) => {
      const session = find(req.params.id);
      if (!session) return void res.status(404).end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': open\n\n');
      const off = session.relay.listen((outcome) => { res.write(`data: ${JSON.stringify(outcome)}\n\n`); });
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        off();
        clearInterval(ping);
      });
    });

    // The move videos, with byte ranges (a <video> asks for them to seek and loop).
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
