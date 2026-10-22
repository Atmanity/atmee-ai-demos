// Market Desk's server side. It owns each page's board: the quote feed
// (Nasdaq first, Yahoo as the fallback; neither answers a browser), the fetch
// pump, the once-a-minute refresh of the focused card, and the announcer that
// speaks on a 1% move. The page streams the board (server-sent events) and
// relays the desk's own lines to the avatar as events: only the page holds
// the session's user token, so the server cannot speak into the room itself.
//
// Everything the user says or types comes here to be judged (rules first,
// then the app's own model call, then Nasdaq's symbol search), because the
// avatar cannot call the app: the original's add_symbol/decline_advice tools
// are this route.
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { DeskSession } from './engine/desk.ts';
import { searchSymbols } from './engine/feed.ts';
import { judge, JUDGE_SCHEMA, judgePrompt, type ModelCall, type ModelReading } from './engine/judge.ts';
import type { DeskMessage, Kind, Origin } from './engine/types.ts';

const ID = 'market-desk';
const KINDS: Kind[] = ['add', 'remove', 'focus', 'refresh', 'clear'];
/** A desk nobody has watched for this long is dropped. */
const IDLE_MS = 15 * 60_000;
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
    // updated the avatar's state before it hands the avatar the event.
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

/** The app's own model call, when there is a key: what rules cannot read. */
const model: ModelCall = (utterance, board) => structured<ModelReading>({
  system: 'You read one request made to a stock-watchlist app and say what it asks for.',
  user: judgePrompt(utterance, board),
  schema: JUDGE_SCHEMA,
  temperature: 0,
});

const app: AppServer = {
  id: ID,
  title: 'Market Desk',
  tagline: 'A live stock watchlist you build by talking, read by an analyst who never gives advice.',
  maxSeconds: 600,
  // No agenda: the desk is driven by the user and by the board.
  conductor: null,
  routes(router) {
    router.post('/desks', (_req, res) => {
      sweep();
      const [id, entry] = newDesk();
      res.json({ id, seq: entry.session.desk.seq, board: entry.session.board() });
    });

    // The board as a stream: every change, and the desk's own lines for the avatar.
    router.get('/desks/:id/stream', (req, res) => {
      const entry = desks.get(req.params.id);
      if (!entry) return void res.status(404).end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      send(res, { type: 'board', seq: entry.session.desk.seq, board: entry.session.board() });
      entry.subscribers.add(res);
      // The focused card refreshes once a minute while someone is watching.
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

    // A control press ({intent}), or a line the user said or typed ({text, from}).
    router.post('/desks/:id/act', async (req, res) => {
      const entry = desks.get(req.params.id);
      if (!entry) return void res.status(404).json({ error: 'no_desk' });
      const { session } = entry;
      const { intent, text, from } = (req.body ?? {}) as { intent?: { kind?: string; symbol?: string }; text?: string; from?: string };

      if (intent && KINDS.includes(intent.kind as Kind)) {
        const symbols = typeof intent.symbol === 'string' && intent.symbol.trim() ? [intent.symbol.trim().slice(0, 16)] : [];
        return void res.json(session.act({ kind: intent.kind as Kind, symbols }, 'button'));
      }

      const said = typeof text === 'string' ? text.trim().slice(0, 500) : '';
      if (!said) return void res.status(400).json({ error: 'nothing_to_do' });
      const origin: Origin = from === 'typed' ? 'typed' : 'spoken';
      const judgement = await judge(said, session.board(), {
        model: llmAvailable() ? model : null,
        search: (query) => searchSymbols(query),
      });
      console.info('[%s] [Judge] %s %s', ID, judgement.kind, 'symbols' in judgement ? judgement.symbols.join(',') : '');
      res.json(session.handle(judgement, said, origin));
    });
  },
};

export default app;
