// The Meridian's server side: Edmund's tools and instructions (declared for
// the session; each call is answered by the page, which holds the camera),
// and the one thing that needs a key: asking a vision model which of the
// catalogue's works a camera frame shows. The model only picks an id; the
// catalogue (engine/catalogue.ts) is what Edmund is told about it.
import type { AppServer } from '../../server/app-server.ts';
import { endSession, startSession } from '../../server/atmee.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';
import { GUEST_INSTRUCTIONS, GUEST_TOOLS, guestById } from './engine/guests.ts';
import { fromModel, IDENTIFY_SCHEMA, IDENTIFY_SYSTEM, identifyPrompt, type ModelAnswer } from './engine/identify.ts';

const ID = 'museum-guide';
// A 768 px JPEG is well under this; anything bigger is not a frame from the page.
const MAX_IMAGE_CHARS = 1_500_000;
const GUEST_SECONDS = 900;
// Guests are paid sessions: at most this many at once from this server (a visitor has one at a time).
const MAX_GUESTS = 4;
const MAX_QUESTION_CHARS = 300;
// Guest sessions this server started (session id -> guest id), until they can no longer run.
const guestSessions = new Map<string, string>();

const app: AppServer = {
  id: ID,
  title: 'The Meridian',
  tagline: 'Hold up your phone in the galleries, and the chairman tells you what you are looking at.',
  brand: { color: '#17120e', ink: '#f1e7d4' },
  maxSeconds: 1200,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  // Ends the guests' sessions on shutdown, as the site does Edmund's.
  shutdown: () => Promise.allSettled([...guestSessions.keys()].map((id) => endSession(id))),
  routes(router) {
    // A guest's session: the figure from a painting, on its own avatar, with the guest's tools.
    // The page joins it as it joins Edmund's (useAvatar('museum-guide/guest/<id>')).
    router.post('/guest/:guest/session', async (req, res) => {
      const guest = guestById(req.params.guest);
      if (!guest) return void res.status(404).json({ error: 'unknown_guest' });
      if (guestSessions.size >= MAX_GUESTS) return void res.status(429).json({ error: 'no_capacity', retryAfter: 30 });
      const seconds = Number(process.env.MAX_SECONDS) || GUEST_SECONDS;
      const r = await startSession(guest.avatarId, seconds,
        { app: 'atmee-usecase-demos', usecase: `${ID}/guest/${guest.id}` }, { instructions: GUEST_INSTRUCTIONS, tools: GUEST_TOOLS });
      if (!r.ok) {
        console.warn('[%s] guest %s POST /v1/session -> %d %s', ID, guest.id, r.status, r.json?.error ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      guestSessions.set(r.session.sessionId, guest.id);
      setTimeout(() => guestSessions.delete(r.session.sessionId), (seconds + 120) * 1000).unref();
      console.log('[%s] guest %s session %s', ID, guest.id, r.session.sessionId);
      res.status(201).json(r.session);
    });
    router.post('/guest/:guest/session/:id/end', async (req, res) => {
      if (guestSessions.get(req.params.id) !== req.params.guest) return void res.status(404).json({ error: 'not_found' });
      const r = await endSession(req.params.id);
      if (r.status === 200) guestSessions.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    router.post('/identify', async (req, res) => {
      const image = typeof req.body?.image === 'string' ? req.body.image.replace(/^data:image\/jpeg;base64,/, '') : '';
      const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, MAX_QUESTION_CHARS) : '';
      // A JPEG (as the page sends), by its first bytes, not just base64 of anything.
      const jpeg = /^[A-Za-z0-9+/=]+$/.test(image) && Buffer.from(image.slice(0, 8), 'base64').subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
      if (!image || image.length > MAX_IMAGE_CHARS || !jpeg) return void res.status(400).json({ error: 'bad_image' });
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
