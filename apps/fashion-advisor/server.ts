// Notch's server side. It owns each fitting (engine/fitting.ts over the
// stylist): the photo, the try-ons, the verdict and the pieces, because the
// images and the model keys live here. Emery's tool calls and the user's
// buttons arrive as the same intents; slow work (a read, a try-on) is a job
// the page follows milestone by milestone. Every image is behind an opaque URL.
//
//   POST /studios                          a new fitting: { id, view }
//   GET  /studios/:id                      the current view (the page polls while catalogue shots render)
//   POST /studios/:id/tool {name, arguments}   Emery's call: { view, text | job + result }
//   POST /studios/:id/act {button, ...}    the user's button: the same, worded as what they pressed
//   GET  /studios/:id/jobs/:job/:milestone a job's milestone, once it lands: { view, text }
//   GET  /studios/:id/images/:token        a photo or a try-on
//   GET  /thumbs/:key                      a piece's catalogue shot
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { instructions, tools } from './engine/director.ts';
import { Fitting, intentOfButton, intentOfTool } from './engine/fitting.ts';
import { Stylist } from './engine/stylist.ts';
import { ThumbnailRack } from './engine/thumbnails.ts';
import type { Milestone } from './engine/types.ts';
import { createModels } from './models.ts';

const ID = 'fashion-advisor';
const API = `/api/apps/${ID}`;
const MAX_FITTINGS = 40;
const FITTING_TTL_MS = 3 * 3600_000;

const models = createModels();
const thumbnails = new ThumbnailRack((item) => models.renderThumbnail(item), {
  enabled: models.tryOnAvailable,
  urlFor: (key) => `${API}/thumbs/${encodeURIComponent(key)}`,
});
const amazon = { domain: process.env.AMAZON_STORE_DOMAIN, tag: process.env.AMAZON_ASSOCIATE_TAG };
const fittings = new Map<string, Fitting>();

function newFitting(): [string, Fitting] {
  for (const [key, f] of fittings) if (Date.now() - f.at > FITTING_TTL_MS) fittings.delete(key);
  while (fittings.size >= MAX_FITTINGS) fittings.delete(fittings.keys().next().value!);
  const id = randomBytes(9).toString('hex');
  const stylist = new Stylist(models, {
    imageUrl: (token) => `${API}/studios/${id}/images/${token}`,
    thumbnails,
    amazon,
    newId: () => randomBytes(8).toString('hex'),
  });
  // Notch asks for no name: the occasion and the photo are all a fitting needs.
  stylist.nameSkipped = true;
  const fitting = new Fitting(stylist);
  fittings.set(id, fitting);
  return [id, fitting];
}

const app: AppServer = {
  id: ID,
  title: 'Notch',
  tagline: 'A stylist rates your outfit for the occasion, names the one fix and the pieces that take it up a notch.',
  brand: { color: '#95515c', ink: '#ffffff' },
  maxSeconds: 900,
  // Try-ons need an image model; without one Emery is not offered them at all.
  appTools: { instructions: instructions(models.tryOnAvailable), tools: tools(models.tryOnAvailable) },
  routes(router) {
    router.post('/studios', (_req, res) => {
      const [id, fitting] = newFitting();
      res.json({ id, view: fitting.view() });
    });

    router.get('/studios/:id', (req, res) => {
      const fitting = fittings.get(req.params.id);
      if (!fitting) return void res.status(404).json({ error: 'no_fitting' });
      res.json({ view: fitting.view() });
    });

    // Emery's tool calls: the text (now, or with the job's result milestone) is what she says next.
    router.post('/studios/:id/tool', (req, res) => {
      const fitting = fittings.get(req.params.id);
      if (!fitting) return void res.status(404).json({ error: 'no_fitting' });
      const { name, arguments: args } = req.body as { name?: unknown; arguments?: unknown };
      const intent = typeof name === 'string' ? intentOfTool(name, args && typeof args === 'object' ? args as Record<string, unknown> : {}) : null;
      if (!intent) return void res.status(400).json({ error: 'unknown_tool' });
      try {
        res.json(fitting.do(intent, { by: 'host' }));
      } catch (err) {
        console.warn('[%s] tool %s failed: %s', ID, String(name), (err as Error).message);
        res.status(500).json({ error: 'tool_failed' });
      }
    });

    // The user's buttons: Emery cannot see them, so the outcome is worded as what they pressed.
    router.post('/studios/:id/act', (req, res) => {
      const fitting = fittings.get(req.params.id);
      if (!fitting) return void res.status(404).json({ error: 'no_fitting' });
      const button = intentOfButton(req.body);
      if (!button) return void res.status(400).json({ error: 'unknown_button' });
      try {
        res.json(fitting.do(button.intent, { by: 'user', pressed: button.pressed }));
      } catch (err) {
        console.warn('[%s] button %s failed: %s', ID, button.intent.kind, (err as Error).message);
        res.status(500).json({ error: 'act_failed' });
      }
    });

    router.get('/studios/:id/jobs/:job/:milestone', async (req, res) => {
      const step = fittings.get(req.params.id)?.step(req.params.job, req.params.milestone as Milestone);
      if (!step) return void res.status(404).json({ error: 'no_job' });
      res.json(await step);
    });

    router.get('/studios/:id/images/:token', (req, res) => {
      const img = fittings.get(req.params.id)?.stylist.image(req.params.token);
      if (!img) return void res.status(404).end();
      res.setHeader('Content-Type', img.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(Buffer.from(img.bytes));
    });

    router.get('/thumbs/:key', (req, res) => {
      const img = thumbnails.image(req.params.key);
      if (!img) return void res.status(404).end();
      res.setHeader('Content-Type', img.mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(Buffer.from(img.bytes));
    });
  },
};

export default app;
