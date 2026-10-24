// Planwright's server side. The plan lives in the page: nothing about it is
// secret, every drag is an instant local change, and the architect's tool
// calls are answered there by the planner. The server declares those tools
// for the session and does the one thing that needs a key:
//   POST /photo   a photo of a room or a piece  ->  add_item intents (kit types, never sizes)
//   GET  /samples/room.jpg                         the "Try a sample room" photo
// A floor plan or photo the client shares with the architect in the call never
// comes here: it goes to her host, whose runtime reads it.
import { readFile } from 'node:fs/promises';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import type { JudgeContext } from './engine/judge.ts';
import { PHOTO_SCHEMA, PHOTO_SYSTEM, photoIntents, photoPrompt, type PhotoReading, type Purpose } from './engine/photo.ts';

const ID = 'room-planner';
const SAMPLE = new URL('./samples/room.jpg', import.meta.url);

const isContext = (value: unknown): value is JudgeContext =>
  Boolean(value) && typeof value === 'object' && Array.isArray((value as JudgeContext).rooms) && Array.isArray((value as JudgeContext).items);

const app: AppServer = {
  id: ID,
  title: 'Planwright',
  tagline: 'Talk your home into shape with Iris, an architect who draws while you talk.',
  brand: { color: '#1f4e8c', ink: '#ffffff' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
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
