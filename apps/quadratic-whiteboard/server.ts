// Quadratic Whiteboard's server side: it owns each teacher's board, so the
// working the class has not seen never reaches the browser (the page gets the
// revealed lines, a count of the rest, and the one sentence staged for the
// next "next"). It also judges every spoken and typed line: rules first
// (engine/judge.ts, engine/spoken.ts), and a Gemini call only for what the
// rules cannot place.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { COMMAND_SCHEMA, COMMAND_SYSTEM } from './engine/judge.ts';
import { Table, type Ask, type Intent } from './engine/table.ts';

const ID = 'quadratic-whiteboard';
const MAX_TEXT = 400;

const boards = new Map<string, { table: Table; at: number }>();

/** The app's own model call, or none without GEMINI_API_KEY (the rules still work). */
const ask: Ask | undefined = llmAvailable()
  ? (user) => structured({ system: COMMAND_SYSTEM, user, schema: COMMAND_SCHEMA, temperature: 0 })
  : undefined;

// Logged once per failure, never with the teacher's words.
const asked: Ask | undefined = ask
  ? async (user) => {
    try {
      return await ask(user);
    } catch (err) {
      console.warn('[%s] model call failed: %s', ID, (err as Error).message);
      throw err;
    }
  }
  : undefined;

const app: AppServer = {
  id: ID,
  title: 'Quadratic Whiteboard',
  tagline: 'Name a quadratic, pick a method, and reveal the working one line at a time beside its graph.',
  // The board takes no turns of its own: no agenda for the avatar.
  conductor: null,
  maxSeconds: 900,
  routes(router) {
    router.post('/boards', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const table = new Table();
      boards.set(id, { table, at: Date.now() });
      for (const [key, board] of boards) if (Date.now() - board.at > 3 * 3600_000) boards.delete(key);
      res.json({ id, outcome: table.open() });
    });

    // One door for every input: { intent } from a control, { equation } from
    // the equation box, { text, how } for a spoken or typed line.
    router.post('/boards/:id/act', async (req, res) => {
      const board = boards.get(req.params.id);
      if (!board) return void res.status(404).json({ error: 'no_board' });
      board.at = Date.now();
      const { intent, equation, text, how } = (req.body ?? {}) as { intent?: unknown; equation?: unknown; text?: unknown; how?: unknown };
      try {
        if (intent !== undefined) {
          if (typeof intent !== 'object' || intent === null) return void res.status(400).json({ error: 'bad_intent' });
          // An unknown kind goes through too, so the board refuses it by name.
          return void res.json(board.table.press(intent as Intent));
        }
        if (typeof equation === 'string' && equation.trim()) {
          return void res.json(await board.table.enter(equation.slice(0, MAX_TEXT), asked));
        }
        if (typeof text === 'string' && text.trim()) {
          return void res.json(await board.table.hear(text.slice(0, MAX_TEXT), how === 'typed' ? 'typed' : 'spoken', asked));
        }
        res.status(400).json({ error: 'nothing_to_do' });
      } catch (err) {
        console.error('[%s] act failed: %s', ID, (err as Error).message);
        res.status(500).json({ error: 'board_failed' });
      }
    });
  },
};

export default app;
