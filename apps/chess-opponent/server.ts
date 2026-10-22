// Chess Opponent's server side. Chess has no secrets, so the board, the rules
// and the opponent's move choice all run in the page (engine/*). The server
// holds only what the page must not: the model key, behind one route that
// judges the lines the rules could not settle ("okay, e4", "I'd like the dark
// pieces this time", "that knight belongs on g5").
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { JUDGE_SCHEMA, judgePrompt, verdictFrom, type ModelContext, type Verdict } from './engine/judge.ts';

const ID = 'chess-opponent';

const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length <= 12).slice(0, max) : [];

const app: AppServer = {
  id: ID,
  title: 'Chess Opponent',
  tagline: 'A real game of chess against an opponent who moves on its own, says why, and needles you a little.',
  // A game by voice runs long; the original held the room for an hour.
  maxSeconds: 1500,
  routes(router) {
    router.post('/judge', async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 400) : '';
      if (!text) return void res.status(400).json({ error: 'nothing_to_judge' });
      if (!llmAvailable()) return void res.json({ kind: 'none', why: 'no_model' });
      const ctx: ModelContext = {
        userColor: body.userColor === 'black' ? 'black' : 'white',
        turn: body.turn === 'user' || body.turn === 'agent' ? body.turn : null,
        legal: strings(body.legal, 256),
        moves: Number.isFinite(body.moves) ? Number(body.moves) : 0,
        over: body.over === true,
      };
      try {
        const raw = await structured({
          system: 'You judge one utterance in a spoken chess game: is the player asking the board to do something right now?',
          user: judgePrompt(text, ctx),
          schema: JUDGE_SCHEMA,
          temperature: 0,
        });
        const verdict: Verdict = verdictFrom(raw, text);
        res.json(verdict);
      } catch (err) {
        console.warn('[%s] judging failed (%s); treating the line as talk', ID, (err as Error).message);
        res.json({ kind: 'none', why: 'model_failed' });
      }
    });
  },
};

export default app;
