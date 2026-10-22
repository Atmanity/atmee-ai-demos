// Home planner's server side: the two model calls the avatar cannot make for
// the app (the Avatar API has no function calling), and the sample photo.
//
// The plan itself lives in the page: nothing about it is secret, every drag is
// a local, instant change, and undo is the page's own history. The server only
// does what needs a key:
//   POST /judge   an utterance + the plan by id  ->  planner intents (or a question)
//   POST /photo   a photo of a room or a piece   ->  add_item intents (kit types, never sizes)
//   GET  /samples/room.jpg                          the "Try a sample" photo
import { readFile } from 'node:fs/promises';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { JUDGE_SCHEMA, JUDGE_SYSTEM, judgePrompt, stepsToIntents, type JudgeContext, type Line, type Step } from './engine/judge.ts';
import { PHOTO_SCHEMA, PHOTO_SYSTEM, photoIntents, photoPrompt, type PhotoReading, type Purpose } from './engine/photo.ts';

const ID = 'room-planner';
const SAMPLE = new URL('./samples/room.jpg', import.meta.url);

const isContext = (value: unknown): value is JudgeContext =>
  Boolean(value) && typeof value === 'object' && Array.isArray((value as JudgeContext).rooms) && Array.isArray((value as JudgeContext).items);

const app: AppServer = {
  id: ID,
  title: 'Home planner',
  tagline: 'Plan a whole home by talking: rooms, walls, doors and furniture at real sizes, with an architect who never picks coordinates.',
  maxSeconds: 900,
  routes(router) {
    router.post('/judge', async (req, res) => {
      const { text, plan, recent } = req.body as { text?: unknown; plan?: unknown; recent?: unknown };
      if (typeof text !== 'string' || !text.trim() || text.length > 600 || !isContext(plan)) return void res.status(400).json({ error: 'bad_request' });
      if (!llmAvailable()) return void res.status(503).json({ error: 'no_model' });
      const lines = (Array.isArray(recent) ? recent : []).filter((l): l is Line => l && typeof l.text === 'string' && (l.who === 'client' || l.who === 'architect')).slice(-8);
      try {
        const answer = await structured<{ steps?: Step[]; ask?: string }>({
          system: JUDGE_SYSTEM, user: judgePrompt(text.trim(), plan, lines), schema: JUDGE_SCHEMA as unknown as Record<string, unknown>, temperature: 0,
        });
        const { intents, ask } = stepsToIntents(answer.steps, plan);
        res.json({ intents, ask: ask ?? (answer.ask?.trim() || null) });
      } catch (err) {
        console.warn('[%s] judging failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'judge_failed' });
      }
    });

    router.post('/photo', async (req, res) => {
      const { purpose: asked, image, sample, plan } = req.body as { purpose?: unknown; image?: { mimeType?: unknown; base64?: unknown }; sample?: unknown; plan?: unknown };
      const purpose: Purpose = asked === 'piece' ? 'piece' : 'room';
      if (!isContext(plan)) return void res.status(400).json({ error: 'bad_request' });
      let picture: { mimeType: string; base64: string };
      if (sample === 'room') {
        picture = { mimeType: 'image/jpeg', base64: (await readFile(SAMPLE)).toString('base64') };
      } else if (image && typeof image.base64 === 'string' && typeof image.mimeType === 'string' && /^image\/(jpeg|png|webp|heic|heif)$/.test(image.mimeType)) {
        picture = { mimeType: image.mimeType, base64: image.base64 };
      } else {
        return void res.status(400).json({ error: 'no_image' });
      }
      if (!llmAvailable()) return void res.status(503).json({ error: 'no_model' });
      try {
        const reading = await structured<PhotoReading>({
          system: PHOTO_SYSTEM, user: photoPrompt(purpose, plan.rooms), schema: PHOTO_SCHEMA as unknown as Record<string, unknown>, images: [picture], temperature: 0,
        });
        res.json({ seen: String(reading.seen ?? '').slice(0, 200), intents: photoIntents(reading, purpose, plan.rooms, plan.selected) });
      } catch (err) {
        console.warn('[%s] reading the photo failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'photo_failed' });
      }
    });

    router.get('/samples/room.jpg', async (_req, res) => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(await readFile(SAMPLE));
    });
  },
};

export default app;
