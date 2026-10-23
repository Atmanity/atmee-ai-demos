// Outcry's server side. It owns each page's board: the quote feed (Nasdaq
// first, Yahoo as the fallback; neither answers a browser), the fetch pump,
// the once-a-minute refresh of the stock on watch, and the announcer that
// speaks on a 1% move. The host's tool calls and the user's buttons both come
// here and run the same actions (`engine/actions.ts`); a call that needs a
// quote waits for it, so the host's first reply carries the real number.
//
// The page streams the board (server-sent events) and relays the desk's own
// lines (a 1% move, a quote that outlived the host's wait) to the host as
// events: only the page holds the call's user token.
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { press, run, TOOL_NAMES } from './engine/actions.ts';
import { DeskSession } from './engine/desk.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { searchSymbols } from './engine/feed.ts';
import { LOOKUP_SCHEMA, lookupPrompt, type TickerLookup } from './engine/judge.ts';
import type { ActReply, DeskMessage, Kind } from './engine/types.ts';

const ID = 'market-desk';
const KINDS: Kind[] = ['add', 'remove', 'focus', 'refresh', 'clear'];
/** A desk nobody has watched for this long is dropped. */
const IDLE_MS = 30 * 60_000;
const HEARTBEAT_MS = 25_000;

interface Entry { session: DeskSession; subscribers: Set<Response>; idleSince: number }
const desks = new Map<string, Entry>();

const send = (res: Response, message: DeskMessage) => res.write(`data: ${JSON.stringify(message)}\n\n`);
const broadcast = (entry: Entry, message: DeskMessage) => { for (const res of entry.subscribers) send(res, message); };

function newDesk(): [string, Entry] {
  const id = randomBytes(9).toString('hex');
  const entry: Entry = { session: undefined as unknown as DeskSession, subscribers: new Set(), idleSince: Date.now() };
  entry.session = new DeskSession({
    // A line goes out after the board change that caused it, so the page has
    // updated the host's state before it hands the host the event.
    speaker: { say: (text, ttl) => void setImmediate(() => broadcast(entry, { type: 'say', text, ttl })) },
  });
  entry.session.desk.onChange((seq) => broadcast(entry, { type: 'board', seq, board: entry.session.board() }));
  desks.set(id, entry);
  return [id, entry];
}

function sweep() {
  for (const [id, entry] of desks) {
    if (!entry.subscribers.size && Date.now() - entry.idleSince > IDLE_MS) {
      entry.session.close();
      desks.delete(id);
    }
  }
}
setInterval(sweep, 60_000).unref();

/** The app's own model call, when there is a key: names the rules cannot read ("the search-engine one"). */
const lookup: TickerLookup = async (names, board) => {
  const reply = await structured<{ stocks?: { said: string; ticker: string }[] }>({
    system: 'You map the company names a user said to their stock tickers.',
    user: lookupPrompt(names, board),
    schema: LOOKUP_SCHEMA,
    temperature: 0,
  });
  return reply.stocks ?? [];
};
const deps = () => ({ lookup: llmAvailable() ? lookup : null, search: (query: string) => searchSymbols(query) });

const reply = (entry: Entry, text: string, refused?: string): ActReply => ({ seq: entry.session.desk.seq, board: entry.session.board(), text, refused });

const app: AppServer = {
  id: ID,
  title: 'Outcry',
  tagline: 'Call out a ticker. Reese reads the tape, and never gives advice.',
  brand: { color: '#f4c430', ink: '#2b1116' },
  maxSeconds: 600,
  // No agenda: the desk is driven by the user and by the board.
  conductor: null,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/desks', (_req, res) => {
      sweep();
      const [id, entry] = newDesk();
      res.json({ id, seq: entry.session.desk.seq, board: entry.session.board() });
    });

    // The board as a stream: every change, and the desk's own lines for the host.
    router.get('/desks/:id/stream', (req, res) => {
      const entry = desks.get(req.params.id);
      if (!entry) return void res.status(404).end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      send(res, { type: 'board', seq: entry.session.desk.seq, board: entry.session.board() });
      entry.subscribers.add(res);
      // The stock on watch refreshes once a minute while someone is looking.
      entry.session.timer.start();
      const beat = setInterval(() => res.write(': beat\n\n'), HEARTBEAT_MS);
      res.on('close', () => {
        clearInterval(beat);
        entry.subscribers.delete(res);
        if (!entry.subscribers.size) {
          entry.session.timer.stop();
          entry.idleSince = Date.now();
        }
      });
    });

    // The host's tool calls: the result is what it says next.
    router.post('/desks/:id/tool', async (req, res) => {
      const entry = desks.get(req.params.id);
      if (!entry) return void res.status(404).json({ error: 'no_desk' });
      const { name, arguments: args } = (req.body ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!name || !TOOL_NAMES.has(name)) return void res.status(400).json({ error: 'unknown_tool' });
      const started = Date.now();
      const done = await run(entry.session, name, args && typeof args === 'object' ? args : {}, 'tool', deps());
      console.info('[%s] [Tool] %s answered in %dms%s', ID, name, Date.now() - started, done.refused ? ' (refused)' : '');
      res.json(reply(entry, done.text, done.refused));
    });

    // The user's buttons: they act at once, and the host is told (it cannot see the screen).
    router.post('/desks/:id/act', async (req, res) => {
      const entry = desks.get(req.params.id);
      if (!entry) return void res.status(404).json({ error: 'no_desk' });
      const { command, symbol } = (req.body ?? {}) as { command?: string; symbol?: unknown };
      if (!KINDS.includes(command as Kind)) return void res.status(400).json({ error: 'unknown_command' });
      const target = typeof symbol === 'string' ? symbol.trim().slice(0, 40) : '';
      if (!target && command !== 'clear' && command !== 'refresh') return void res.status(400).json({ error: 'no_symbol' });
      const done = await press(entry.session, command as Kind, target, deps());
      res.json(reply(entry, done.text, done.refused));
    });
  },
};

export default app;
