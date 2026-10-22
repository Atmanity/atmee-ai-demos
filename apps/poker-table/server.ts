// Poker Table's server side: it owns the table (the deck and the opponent's
// hole cards never reach the browser), reads what the player says or types,
// and decides the opponent's moves with the app's own model call. The page
// sees the masked view (engine/types.ts TableView) and the event texts for the
// avatar.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { DECISION_SYSTEM_PROMPT, decisionPrompt, decisionSchema, type Ask } from './engine/decide.ts';
import { Table } from './engine/table.ts';
import type { Intent, Outcome } from './engine/types.ts';

const ID = 'poker-table';
const INTENTS = new Set(['deal', 'restart', 'fold', 'check', 'call', 'raise', 'all_in']);

interface Seat { table: Table; at: number }
const tables = new Map<string, Seat>();

/** The opponent's decision: a structured answer from the app's model, or none (the table then plays it safe). */
const ask: Ask | null = llmAvailable()
  ? (request) => structured({ system: DECISION_SYSTEM_PROMPT, user: decisionPrompt(request), schema: decisionSchema(request), temperature: 0.9 })
  : null;

if (!ask) console.warn('[%s] GEMINI_API_KEY is not set: the opponent will only check and call', ID);

function intentFrom(body: unknown): Intent | undefined {
  const raw = (body as { intent?: { kind?: unknown; amount?: unknown } })?.intent;
  if (!raw || typeof raw.kind !== 'string' || !INTENTS.has(raw.kind)) return undefined;
  const amount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? Math.trunc(raw.amount) : undefined;
  return { kind: raw.kind, amount } as Intent;
}

const app: AppServer = {
  id: ID,
  title: 'Poker Table',
  tagline: "Heads-up no-limit hold'em against the avatar: say your moves, it plays its own.",
  maxSeconds: 900,
  routes(router) {
    router.post('/tables', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const table = new Table();
      tables.set(id, { table, at: Date.now() });
      for (const [key, seat] of tables) if (Date.now() - seat.at > 3 * 3600_000) tables.delete(key);
      res.json({ id, outcome: table.open() satisfies Outcome });
    });

    // A button (`intent`) or a typed/spoken line (`text`, `how`).
    router.post('/tables/:id/act', (req, res) => {
      const seat = tables.get(req.params.id);
      if (!seat) return void res.status(404).json({ error: 'no_table' });
      seat.at = Date.now();
      const intent = intentFrom(req.body);
      const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 500) : '';
      const how = req.body?.how === 'spoken' ? 'spoken' : 'typed';
      if (!intent && !text.trim()) return void res.status(400).json({ error: 'nothing_to_do' });
      const outcome = seat.table.act({ intent, text }, intent ? 'click' : how);
      if (outcome.handled && text) console.log('[%s] %s line handled; table seq %d', ID, how, outcome.view.seq);
      res.json(outcome satisfies Outcome);
    });

    // The opponent's turn, when it is one. The page asks after each change
    // that leaves the action on the opponent; a call when it is not is a no-op.
    router.post('/tables/:id/opponent', async (req, res) => {
      const seat = tables.get(req.params.id);
      if (!seat) return void res.status(404).json({ error: 'no_table' });
      seat.at = Date.now();
      try {
        const outcome = await seat.table.opponentTurn(ask);
        if (outcome.handled && seat.table.lastDecision) {
          const d = seat.table.lastDecision;
          console.log('[%s] opponent played %s%s (%s)', ID, d.kind, d.amount ? ` ${d.amount}` : '', d.source);
        }
        res.json(outcome satisfies Outcome);
      } catch (err) {
        console.warn('[%s] opponent turn failed: %s', ID, (err as Error).message);
        res.status(500).json({ error: 'opponent_failed' });
      }
    });
  },
};

export default app;
