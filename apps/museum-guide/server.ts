// The Meridian's server side: Edmund's tools and instructions (declared for
// the session; each call is answered by the page, which holds the camera),
// and the one thing that needs a key: asking a vision model which of the
// catalogue's works a camera frame shows. The model only picks an id; the
// catalogue (engine/catalogue.ts) is what Edmund is told about it.
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { fromModel, IDENTIFY_SCHEMA, IDENTIFY_SYSTEM, identifyPrompt, type ModelAnswer } from './engine/identify.ts';

const ID = 'museum-guide';
// A 768 px JPEG is well under this; anything bigger is not a frame from the page.
const MAX_IMAGE_CHARS = 1_500_000;

const app: AppServer = {
  id: ID,
  title: 'The Meridian',
  tagline: 'Hold up your phone in the galleries, and the chairman tells you what you are looking at.',
  brand: { color: '#17120e', ink: '#f1e7d4' },
  maxSeconds: 1200,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/identify', async (req, res) => {
      const image = typeof req.body?.image === 'string' ? req.body.image.replace(/^data:image\/jpeg;base64,/, '') : '';
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      if (!image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(image)) return void res.status(400).json({ error: 'bad_image' });
      if (!llmAvailable()) return void res.status(503).json({ error: 'no_model' });
      const started = Date.now();
      try {
        const answer = await structured<ModelAnswer>({
          system: IDENTIFY_SYSTEM,
          user: identifyPrompt(question || undefined),
          schema: IDENTIFY_SCHEMA,
          images: [{ mimeType: 'image/jpeg', base64: image }],
          temperature: 0,
        });
        const found = fromModel(answer);
        console.log('[%s] identify -> %s (%s) in %d ms', ID, found.kind === 'found' ? found.exhibit.id : found.kind, answer.confidence, Date.now() - started);
        res.json(found.kind === 'found' ? { kind: found.kind, id: found.exhibit.id, seen: found.seen } : found);
      } catch (err) {
        console.warn('[%s] identify failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'model_failed' });
      }
    });
  },
};

export default app;
