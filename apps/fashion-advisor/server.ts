// Fashion Advisor's server side. It owns each user's styling session (the
// stylist in engine/stylist.ts): the photo, the try-ons, the read and the
// pieces, because the images and the model keys live here. The page sends
// commands (from a button, a typed line or speech) and waits for the slow
// ones as jobs; it gets views, with every image behind an opaque URL.
//
//   POST /studios                        a new session: { id, outcome }
//   GET  /studios/:id                    the current view (the page polls while thumbnails render)
//   POST /studios/:id/judge {text,offer} what a line means: { command, clearOffer }
//   POST /studios/:id/act {command}      do it: an Outcome, maybe with a job
//   GET  /studios/:id/jobs/:job/:stage   wait for a job's milestone ('image', 'done')
//   GET  /studios/:id/images/:token      a photo or a try-on
//   GET  /thumbs/:key                    a suggestion's catalogue shot
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { say } from './engine/director.ts';
import {
  chat, fromIntentModel, fromNameModel, fromStyleModel, INTENT_SCHEMA, intentPrompt, judgeRules, NAME_SCHEMA, namePrompt,
  parseCommand, STYLE_SCHEMA, stylePrompt, type JudgeContext,
} from './engine/judge.ts';
import { retryTransient } from './engine/prompts.ts';
import { matchStyleKeyword, styleHintFromNameReply } from './engine/style.ts';
import { Stylist } from './engine/stylist.ts';
import { ThumbnailRack } from './engine/thumbnails.ts';
import type { Command, Milestone, Outcome } from './engine/types.ts';
import { createModels } from './models.ts';

const ID = 'fashion-advisor';
const API = `/api/apps/${ID}`;
const MAX_STUDIOS = 40;
const STUDIO_TTL_MS = 3 * 3600_000;

const models = createModels();
const thumbnails = new ThumbnailRack((item) => models.renderThumbnail(item), {
  enabled: models.tryOnAvailable,
  urlFor: (key) => `${API}/thumbs/${encodeURIComponent(key)}`,
});
const amazon = { domain: process.env.AMAZON_STORE_DOMAIN, tag: process.env.AMAZON_ASSOCIATE_TAG };
const studios = new Map<string, Stylist>();

function newStudio(): [string, Stylist] {
  for (const [key, s] of studios) if (Date.now() - s.at > STUDIO_TTL_MS) studios.delete(key);
  while (studios.size >= MAX_STUDIOS) studios.delete(studios.keys().next().value!);
  const id = randomBytes(9).toString('hex');
  const stylist = new Stylist(models, {
    imageUrl: (token) => `${API}/studios/${id}/images/${token}`,
    thumbnails,
    amazon,
    newId: () => randomBytes(8).toString('hex'),
  });
  studios.set(id, stylist);
  return [id, stylist];
}

const ask = <T>(user: string, schema: Record<string, unknown>, system: string) =>
  retryTransient(() => structured<T>({ system, user, schema, temperature: 0 }), { attempts: 2, baseDelayMs: 600 });

/** Rules first; the model only where they could not tell (a bare name, a style in the user's own words, a request in loose words). */
async function judge(stylist: Stylist, text: string, offer: string | null): Promise<{ command: Command | null; clearOffer?: boolean }> {
  const ctx: JudgeContext = {
    step: stylist.step,
    suggestions: stylist.analysis?.suggestions.map((s) => s.item) ?? [],
    offer,
    hasPhoto: Boolean(stylist.current),
    photoDeclined: stylist.photoDeclined,
    hasName: Boolean(stylist.name),
    hasTarget: Boolean(stylist.target),
  };
  const verdict = judgeRules(text, ctx);
  let command = verdict.command;
  if (verdict.ask && verdict.askText && llmAvailable()) {
    try {
      if (verdict.ask === 'name') {
        const name = fromNameModel(await ask<{ name: string }>(namePrompt(verdict.askText), NAME_SCHEMA, "You extract the person's name from a short spoken reply."));
        if (name) {
          const hint = styleHintFromNameReply(text, name);
          const style = hint ? matchStyleKeyword(hint) : '';
          command = style ? { type: 'name', name, style } : { type: 'name', name };
        } else if (command?.type === 'name') {
          command = chat(text);   // the rule's guess was not a name ("Excited!")
        }
      } else if (verdict.ask === 'style' || verdict.ask === 'styleHint') {
        const style = fromStyleModel(await ask<{ style: string }>(stylePrompt(verdict.askText), STYLE_SCHEMA, "You normalize a user's reply into a single short style or look phrase."));
        if (style) command = verdict.ask === 'styleHint' && command?.type === 'name' ? { ...command, style } : { type: 'style', style };
      } else if (verdict.ask === 'intent') {
        command = fromIntentModel(await ask(intentPrompt(verdict.askText, ctx.suggestions, offer), INTENT_SCHEMA, 'You decide which app action a user asked for.'), ctx);
      }
    } catch (err) {
      console.warn('[%s] judging with the model failed (%s); using the rules', ID, (err as Error).message);
    }
  }
  return { command, ...(verdict.clearOffer ? { clearOffer: true } : {}) };
}

const app: AppServer = {
  id: ID,
  title: 'Fashion Advisor',
  tagline: 'Share a photo of your outfit: a stylist rates it for the look you want, suggests pieces and puts them on you.',
  maxSeconds: 900,
  routes(router) {
    router.post('/studios', (_req, res) => {
      const [id, stylist] = newStudio();
      res.json({ id, outcome: { view: stylist.view(), handled: true, events: [say.start()] } satisfies Outcome });
    });

    router.get('/studios/:id', (req, res) => {
      const stylist = studios.get(req.params.id);
      if (!stylist) return void res.status(404).json({ error: 'no_session' });
      res.json({ view: stylist.view() });
    });

    router.post('/studios/:id/judge', async (req, res) => {
      const stylist = studios.get(req.params.id);
      if (!stylist) return void res.status(404).json({ error: 'no_session' });
      const { text, offer } = req.body as { text?: unknown; offer?: unknown };
      if (typeof text !== 'string' || !text.trim()) return void res.status(400).json({ error: 'no_text' });
      res.json(await judge(stylist, text.slice(0, 600), typeof offer === 'string' && offer.trim() ? offer.trim().slice(0, 80) : null));
    });

    router.post('/studios/:id/act', (req, res) => {
      const stylist = studios.get(req.params.id);
      if (!stylist) return void res.status(404).json({ error: 'no_session' });
      const command = parseCommand((req.body as { command?: unknown }).command);
      if (!command) return void res.status(400).json({ error: 'bad_command' });
      try {
        res.json(stylist.act(command));
      } catch (err) {
        console.warn('[%s] %s failed: %s', ID, command.type, (err as Error).message);
        res.status(500).json({ error: 'act_failed' });
      }
    });

    router.get('/studios/:id/jobs/:job/:milestone', async (req, res) => {
      const stylist = studios.get(req.params.id);
      const waiting = stylist?.wait(req.params.job, req.params.milestone as Milestone);
      if (!waiting) return void res.status(404).json({ error: 'no_job' });
      res.json(await waiting);
    });

    router.get('/studios/:id/images/:token', (req, res) => {
      const img = studios.get(req.params.id)?.image(req.params.token);
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
