// Lodestar's server side is small on purpose. The astronomy runs in the page:
// nothing in it is secret, it is pure arithmetic over a static catalogue, and
// the chart, the host's state and every tool result are projections of the
// one SkyChart there, so the guide can never describe a sky the user is not
// looking at. Here: the host's tools and instructions (declared for the
// session; each call is answered by the page), and the one thing that needs a
// key: asking a model what some words meant when the rules over the
// catalogue's own names could not place them ("the Hunter's sword", "late
// March"). The model only ever picks words; the chart validates whatever it picks.
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { fromModel, INTERPRET_SCHEMA, interpretPrompt, type Interpretation } from './engine/judge.ts';
import type { Intent } from './engine/types.ts';

const ID = 'sky-guide';

const app: AppServer = {
  id: ID,
  title: 'Lodestar',
  tagline: 'Any sky on Earth, at any hour, and Mira to name every star in it.',
  brand: { color: '#0b1331', ink: '#f2eee1' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/interpret', async (req, res) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
      if (!text) return void res.status(400).json({ error: 'nothing_to_do' });
      if (!llmAvailable()) return void res.json({ model: false, intents: [] satisfies Intent[] });
      try {
        const today = new Date().toISOString().slice(0, 10);
        const answer = await structured<Interpretation>({
          system: 'You map one utterance onto a star chart\'s vocabulary. You never add facts.',
          user: interpretPrompt(text, today),
          schema: INTERPRET_SCHEMA,
          temperature: 0,
        });
        res.json({ model: true, intents: fromModel(answer) });
      } catch (err) {
        console.warn('[%s] interpreting failed (%s); the rules stand', ID, (err as Error).message);
        res.json({ model: false, intents: [] });
      }
    });
  },
};

export default app;
