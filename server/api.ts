// /api: the apps (discovered from apps/<id>/server.ts), their sessions, and
// each app's own routes under /api/apps/<id>/.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppServer } from './app-server.ts';
import { avatarApi, endSession, setConductor, startSession } from './atmee.ts';
import { endRender, renderConfigured, startRender } from './render.ts';
import { avatarEnvName, avatarFor, hostNameOf } from './hosts.js';

const apps = new Map<string, AppServer>();
for (const dir of readdirSync('apps').sort()) {
  if (!existsSync(`apps/${dir}/server.ts`)) continue;
  // One app that fails to load (half-written, a missing key) must not take the others down.
  try {
    const app: AppServer = (await import(`../apps/${dir}/server.ts`)).default;
    apps.set(app.id, app);
  } catch (err) {
    console.error('[%s] not loaded: %s', dir, (err as Error).message);
  }
}

// Which app's agenda each avatar carries now, so a shared avatar is switched
// only when the app changes.
const conductorOf = new Map<string, string>();
// Sessions this server started, forgotten once they can no longer run.
const started = new Map<string, string>();

// Express 4 does not catch a rejected async handler: the request hangs and the
// rejection can end the process (the Avatar API unreachable, a model call that
// throws). Every route here and in the apps goes through this.
function caught(router: Router): Router {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const register = router[method].bind(router) as (...args: unknown[]) => Router;
    (router as unknown as Record<string, unknown>)[method] = (path: unknown, ...handlers: unknown[]) =>
      register(path, ...handlers.map((h) => (typeof h === 'function'
        ? (req: Request, res: Response, next: NextFunction) => Promise.resolve(h(req, res, next)).catch(next)
        : h)));
  }
  return router;
}

export const api = caught(Router());

api.get('/apps', (_req, res) => {
  // tools and agenda: what the home page counts (the functions each host may call, and whether it keeps to a conductor).
  res.json([...apps.values()].map(({ id, title, tagline, brand, way, appTools, conductor }) => ({
    id, title, tagline, brand, way: way ?? 'full-stack', host: hostNameOf(id), avatar: Boolean(avatarFor(id)),
    tools: appTools?.tools.length ?? 0, agenda: Boolean(conductor?.graph),
  })));
});

// Each host's face, small, for the home page's tiles (the portrait is 2048 px).
const portraits = new Map<string, Promise<Buffer | null>>();
api.get('/apps/:app/portrait', async (req, res) => {
  const id = req.params.app;
  if (!apps.has(id)) return void res.status(404).end();
  if (!portraits.has(id)) {
    portraits.set(id, readFile(`apps/${id}/host/portrait.jpg`)
      .then((jpg) => sharp(jpg).resize(192, 192, { fit: 'cover', position: 'top' }).webp({ quality: 80 }).toBuffer())
      .catch(() => null));
  }
  const webp = await portraits.get(id)!;
  if (!webp) return void res.status(404).end();
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(webp);
});

api.post('/apps/:app/session', async (req, res) => {
  const app = apps.get(req.params.app);
  if (!app) return void res.status(404).json({ error: 'unknown_app' });
  const avatarId = avatarFor(app.id);
  if (!avatarId) return void res.status(500).json({ error: 'no_avatar', message: `Set avatarId in apps/${app.id}/avatar.json, ${avatarEnvName(app.id)} or AVATAR_DEFAULT` });

  if (conductorOf.get(avatarId) !== app.id) {
    const graph = app.conductor ?? null;
    const r = await setConductor(avatarId, graph?.graph ?? null, graph?.speakAfterS);
    // Clearing an agenda the avatar may not have is best-effort: a key bound to one avatar can be
    // refused it (403) and the app, which runs none, still starts. Setting one must succeed.
    if (graph === null && r.status === 403) console.warn('[%s] could not clear the avatar\'s agenda (403): starting anyway', app.id);
    else if (r.status >= 300 && !(graph === null && r.status === 404)) {
      console.warn('[%s] conductor -> %d %s', app.id, r.status, JSON.stringify(r.json).slice(0, 300));
      return void res.status(502).json({ error: 'conductor_failed' });
    }
    conductorOf.set(avatarId, app.id);
  }

  const maxSeconds = Number(process.env.MAX_SECONDS) || app.maxSeconds || 600;
  const r = await startSession(avatarId, maxSeconds, { app: 'atmee-usecase-demos', usecase: app.id }, app.appTools);
  if (!r.ok) {
    // The code is for the page; the message (which limit, which key) is for you.
    console.warn('[%s] POST /v1/session -> %d %s %s', app.id, r.status, r.json?.error ?? '', r.json?.message ?? '');
    return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
  }
  started.set(r.session.sessionId, app.id);
  setTimeout(() => started.delete(r.session.sessionId), (maxSeconds + 120) * 1000).unref();
  console.log('[%s] session %s on avatar %s', app.id, r.session.sessionId, avatarId.slice(0, 8));
  res.status(201).json(r.session);
});

// The avatar-only apps: the avatar rendered into this server's own LiveKit room, for the page's own agent.
const rendering = new Map<string, string>(); // avatar session id -> app id

api.post('/apps/:app/render', async (req, res) => {
  const app = apps.get(req.params.app);
  if (!app || app.way !== 'avatar-only') return void res.status(404).json({ error: 'unknown_app' });
  if (!renderConfigured()) return void res.status(503).json({ error: 'livekit_not_configured', message: 'Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET' });
  const avatarId = avatarFor(app.id);
  if (!avatarId) return void res.status(500).json({ error: 'no_avatar', message: `Set avatarId in apps/${app.id}/avatar.json, ${avatarEnvName(app.id)} or AVATAR_DEFAULT` });
  const maxSeconds = Number(process.env.MAX_SECONDS) || app.maxSeconds || 600;
  const r = await startRender(avatarId, maxSeconds, { app: 'atmee-usecase-demos', usecase: app.id });
  if (!r.ok) {
    console.warn('[%s] POST /v1/avatars/{id}/avatar_sessions -> %d %s %s', app.id, r.status, r.json?.error ?? '', r.json?.message ?? '');
    return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
  }
  rendering.set(r.render.sessionId, app.id);
  setTimeout(() => rendering.delete(r.render.sessionId), (r.render.maxSeconds + 120) * 1000).unref();
  console.log('[%s] render %s of avatar %s', app.id, r.render.sessionId, avatarId.slice(0, 8));
  res.status(201).json(r.render);
});

// Whether the render is running, and why it ended: the page asks when the avatar is slow to appear.
api.get('/apps/:app/render/:id', async (req, res) => {
  if (rendering.get(req.params.id) !== req.params.app) return void res.status(404).json({ error: 'not_found' });
  const r = await avatarApi('GET', `/v1/avatar_sessions/${req.params.id}`);
  const { status, endReason, failureCode } = r.json ?? {};
  res.status(r.status).json({ status, endReason, failureCode });
});

api.post('/apps/:app/render/:id/end', async (req, res) => {
  if (rendering.get(req.params.id) !== req.params.app) return void res.status(404).json({ error: 'not_found' });
  const r = await endRender(req.params.id);
  if (r.status === 200) rendering.delete(req.params.id);
  res.status(r.status).json(r.json);
});

/** Ends every session and render this server started and has not seen end: on shutdown, so a rollout leaves nothing billing. */
export async function endLiveSessions() {
  const ids = [...started.keys()];
  const renders = [...rendering.keys()];
  started.clear();
  rendering.clear();
  await Promise.allSettled([...ids.map((id) => endSession(id)), ...renders.map((id) => endRender(id))]);
}

api.post('/apps/:app/session/:id/end', async (req, res) => {
  if (started.get(req.params.id) !== req.params.app) return void res.status(404).json({ error: 'not_found' });
  const r = await endSession(req.params.id);
  if (r.status === 200) started.delete(req.params.id);
  res.status(r.status).json(r.json);
});

for (const app of apps.values()) {
  if (!app.routes) continue;
  const router = caught(Router());
  app.routes(router);
  api.use(`/apps/${app.id}`, router);
}

api.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('[api] %s %s failed: %s', req.method, req.path, err.message);
  if (!res.headersSent) res.status(502).json({ error: 'upstream_failed' });
  else res.end();
});
