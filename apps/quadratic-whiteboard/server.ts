// Chalkline's server side: it owns each teacher's board, so the working the
// class has not seen never reaches the browser (the page gets the revealed
// lines and a count of the rest). It answers the host's tool calls and the
// teacher's controls with one set of actions (engine/table.ts), and reads an
// equation the rules cannot place with a Gemini call.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { EQUATION_SCHEMA, EQUATION_SYSTEM } from './engine/judge.ts';
import { MAX_EQUATION, Table, type Ask, type Intent } from './engine/table.ts';
import type { Outcome, ToolOutcome, View } from './engine/types.ts';

const ID = 'quadratic-whiteboard';
/** The model reads one equation; the host waits at most 15 s for the whole call. */
const MODEL_TIMEOUT_MS = 8000;

const boards = new Map<string, { table: Table; at: number }>();
const ACTIONS = new Set(TOOLS.map((t) => t.name));

/** The app's own model call, or none without GEMINI_API_KEY (the rules still read every plainly said equation). */
const ask: Ask | undefined = llmAvailable()
  ? async (user) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        structured({ system: EQUATION_SYSTEM, user, schema: EQUATION_SCHEMA, temperature: 0 }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${MODEL_TIMEOUT_MS} ms`)), MODEL_TIMEOUT_MS); }),
      ]);
    } catch (err) {
      // Logged without the teacher's words.
      console.warn('[%s] [Equation] model call failed: %s', ID, (err as Error).message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  : undefined;

const app: AppServer = {
  id: ID,
  title: 'Chalkline',
  tagline: 'Say the equation; reveal the working one exact line at a time, with Ada reading it out.',
  brand: { color: '#213d33', ink: '#f4f1e6' },
  // The board takes no turns of its own: no agenda for the host.
  conductor: null,
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    // A board for the call. Calling back resumes the board the teacher left, while the server still has it.
    router.post('/boards', (req, res) => {
      for (const [key, board] of boards) if (Date.now() - board.at > 3 * 3600_000) boards.delete(key);
      const resume = (req.body as { resume?: unknown } | undefined)?.resume;
      const kept = typeof resume === 'string' ? boards.get(resume) : undefined;
      if (kept && typeof resume === 'string') {
        kept.at = Date.now();
        return void res.json({ id: resume, view: kept.table.view(), opening: kept.table.resume() } satisfies { id: string; view: View; opening: string });
      }
      const id = randomBytes(9).toString('hex');
      const table = new Table();
      boards.set(id, { table, at: Date.now() });
      res.json({ id, view: table.view(), opening: table.open() } satisfies { id: string; view: View; opening: string });
    });

    // The host's tool calls: the result is what it says next.
    router.post('/boards/:id/tool', async (req, res) => {
      const board = boards.get(req.params.id);
      if (!board) return void res.status(404).json({ error: 'no_board' });
      const { name, arguments: args } = (req.body ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof name !== 'string' || !ACTIONS.has(name)) return void res.status(400).json({ error: 'unknown_tool' });
      board.at = Date.now();
      try {
        const outcome = await board.table.tool(name, args && typeof args === 'object' ? args as Record<string, unknown> : {}, ask);
        res.json(outcome satisfies ToolOutcome);
      } catch (err) {
        console.error('[%s] [Tool] %s failed: %s', ID, name, (err as Error).message);
        res.status(500).json({ error: 'board_failed' });
      }
    });

    // The teacher's controls: { intent } from a button, { equation } from the box.
    router.post('/boards/:id/act', async (req, res) => {
      const board = boards.get(req.params.id);
      if (!board) return void res.status(404).json({ error: 'no_board' });
      board.at = Date.now();
      const { intent, equation } = (req.body ?? {}) as { intent?: unknown; equation?: unknown };
      try {
        if (intent !== undefined) {
          if (typeof intent !== 'object' || intent === null) return void res.status(400).json({ error: 'bad_intent' });
          // An unknown kind goes through too, so the board refuses it by name.
          return void res.json(board.table.press(intent as Intent) satisfies Outcome);
        }
        if (typeof equation === 'string' && equation.trim()) {
          return void res.json(await board.table.enter(equation.slice(0, MAX_EQUATION), ask) satisfies Outcome);
        }
        res.status(400).json({ error: 'nothing_to_do' });
      } catch (err) {
        console.error('[%s] [Act] failed: %s', ID, (err as Error).message);
        res.status(500).json({ error: 'board_failed' });
      }
    });
  },
};

export default app;
