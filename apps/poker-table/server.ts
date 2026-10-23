// Blindside's server side: it owns the table (the deck and Dex's hole cards
// never reach the browser), answers the host's tool calls and the player's
// buttons, and decides Dex's moves with the app's own model call. The page
// sees the masked view (engine/types.ts TableView) and the words Dex speaks
// from (engine/director.ts).
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { DECISION_SYSTEM_PROMPT, decisionPrompt, decisionSchema, type Ask } from './engine/decide.ts';
import { INSTRUCTIONS, speak, TOOLS } from './engine/director.ts';
import { Table, type Result } from './engine/table.ts';
import type { Heard, Intent } from './engine/types.ts';

const ID = 'poker-table';
const INTENTS = new Set(['deal', 'restart', 'fold', 'check', 'call', 'raise', 'all_in']);

interface Seat { table: Table; at: number }
const tables = new Map<string, Seat>();

/** Dex's decision: a structured answer from the app's model, or none (the table then plays it safe). */
const ask: Ask | null = llmAvailable()
  ? (request) => structured({ system: DECISION_SYSTEM_PROMPT, user: decisionPrompt(request), schema: decisionSchema(request), temperature: 0.9 })
  : null;

if (!ask) console.warn('[%s] GEMINI_API_KEY is not set: Dex will only check and call', ID);

function intentFrom(body: unknown): Intent | undefined {
  const raw = (body as { intent?: { kind?: unknown; amount?: unknown } })?.intent;
  if (!raw || typeof raw.kind !== 'string' || !INTENTS.has(raw.kind)) return undefined;
  const amount = typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? Math.trunc(raw.amount) : undefined;
  return { kind: raw.kind, amount } as Intent;
}

/** The player's recent lines, as the page heard them: bounded, and only well-formed ones. */
function heardFrom(body: unknown): Heard[] {
  const raw = (body as { heard?: unknown })?.heard;
  if (!Array.isArray(raw)) return [];
  return raw.slice(-12).flatMap((h) => {
    const { text, seq } = (h ?? {}) as { text?: unknown; seq?: unknown };
    return typeof text === 'string' && Number.isInteger(seq) ? [{ text: text.slice(0, 300), seq: seq as number }] : [];
  });
}

/** What the page gets back: the view, the words for Dex, and anything the table refused. */
const reply = (r: Result): Result => r;

const app: AppServer = {
  id: ID,
  title: 'Blindside',
  tagline: "Heads-up hold'em against Dex: say your move, and he talks back.",
  brand: { color: '#7d1d2c', ink: '#f6f0e3' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/tables', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const table = new Table();
      tables.set(id, { table, at: Date.now() });
      for (const [key, seat] of tables) if (Date.now() - seat.at > 3 * 3600_000) tables.delete(key);
      const opened = table.open();
      res.json({ id, view: opened.view, opening: speak([opened.line]) });
    });

    // The host's play_move: the move in its words, checked against the player's own.
    router.post('/tables/:id/move', (req, res) => {
      const seat = tables.get(req.params.id);
      if (!seat) return void res.status(404).json({ error: 'no_table' });
      seat.at = Date.now();
      const words = typeof req.body?.words === 'string' ? req.body.words : '';
      const result = seat.table.playerMove(words, heardFrom(req.body));
      console.log('[%s] play_move %s (table seq %d)', ID, result.changed ? 'played' : result.unbacked ? 'not in their words' : 'refused', result.view.seq);
      res.json(reply(result));
    });

    // The host's other table tools.
    router.post('/tables/:id/tool', (req, res) => {
      const seat = tables.get(req.params.id);
      if (!seat) return void res.status(404).json({ error: 'no_table' });
      seat.at = Date.now();
      const name = (req.body as { name?: unknown })?.name;
      const { table } = seat;
      const result = name === 'deal_hand' ? table.deal() : name === 'new_match' ? table.rematch() : name === 'read_my_cards' ? table.ownCards() : null;
      if (!result) return void res.status(400).json({ error: 'unknown_tool' });
      res.json(reply(result));
    });

    // The player's buttons: exact moves, deals and the rematch.
    router.post('/tables/:id/act', (req, res) => {
      const seat = tables.get(req.params.id);
      if (!seat) return void res.status(404).json({ error: 'no_table' });
      seat.at = Date.now();
      const intent = intentFrom(req.body);
      if (!intent) return void res.status(400).json({ error: 'unknown_intent' });
      res.json(reply(seat.table.press(intent)));
    });

    // Dex's turn, when it is one. The page asks after each change that leaves
    // the action on Dex; a call when it is not is a no-op.
    router.post('/tables/:id/opponent', async (req, res) => {
      const seat = tables.get(req.params.id);
      if (!seat) return void res.status(404).json({ error: 'no_table' });
      seat.at = Date.now();
      try {
        const result = await seat.table.opponentTurn(ask, req.body?.again === true);
        if (result.changed && seat.table.lastDecision) {
          const d = seat.table.lastDecision;
          console.log('[%s] Dex played %s%s (%s)', ID, d.kind, d.amount ? ` ${d.amount}` : '', d.source);
        }
        res.json(reply(result));
      } catch (err) {
        console.warn('[%s] Dex\'s turn failed: %s', ID, (err as Error).message);
        res.status(500).json({ error: 'opponent_failed' });
      }
    });
  },
};

export default app;
