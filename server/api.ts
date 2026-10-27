// /api: the apps (discovered from apps/<id>/server.ts), their sessions, and
// each app's own routes under /api/apps/<id>/.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppServer } from './app-server.ts';
import { avatarApi, endSession, setConductor, startSession } from './atmee.ts';
import { endRender, renderConfigured, startRender } from './render.ts';
import { endSpeechSession, readSpeechSession, startSpeechSession } from './speech-sessions.ts';
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

/**
 * A speech app's avatar: its own AVATAR_<APP_ID> only, never avatar.json or AVATAR_DEFAULT. The
 * avatar's voice is the app's character's, so the app stays off until one is chosen for it.
 */
export const speechAvatarFor = (id: string) => process.env[avatarEnvName(id)] || '';

// The functions each host may call: a speech app's are the tools its server pins.
const toolCount = (app: AppServer) => (app.speech ? app.speech.settings().delegation?.responses?.tools?.length ?? 0 : app.appTools?.tools.length ?? 0);

api.get('/apps', (_req, res) => {
  // tools and agenda: what the home page counts (the functions each host may call, and whether it keeps to a conductor).
  // A speech app without its avatar is off, and not listed.
  res.json([...apps.values()].filter((app) => app.way !== 'speech' || speechAvatarFor(app.id)).map((app) => ({
    id: app.id, title: app.title, tagline: app.tagline, brand: app.brand, way: app.way ?? 'full-stack', host: hostNameOf(app.id),
    avatar: Boolean(app.way === 'speech' ? speechAvatarFor(app.id) : avatarFor(app.id)),
    tools: toolCount(app), agenda: Boolean(app.conductor?.graph),
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
    if (r.status >= 300 && !(graph === null && r.status === 404)) {
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

// The speech apps: a voice call the page holds over a WebSocket to Atmee's speech server.
// Each start reserves the visitor's own session, with the settings the app pins.
const speaking = new Map<string, { app: string; ended: boolean }>(); // speech session id -> its app

api.post('/apps/:app/speech', async (req, res) => {
  const app = apps.get(req.params.app);
  if (!app || app.way !== 'speech' || !app.speech) return void res.status(404).json({ error: 'unknown_app' });
  const avatarId = speechAvatarFor(app.id);
  if (!avatarId) return void res.status(503).json({ error: 'no_avatar', message: `Set ${avatarEnvName(app.id)} to an avatar with a voice` });
  const maxSeconds = Number(process.env.MAX_SECONDS) || app.maxSeconds || 600;
  const r = await startSpeechSession(avatarId, maxSeconds, app.speech.settings(), app.speech.language);
  if (!r.ok) {
    // The code is for the page; the message (which limit, which field) is for you.
    console.warn('[%s] POST /v1/speech_sessions -> %d %s %s', app.id, r.status, r.json?.error ?? '', r.json?.message ?? '');
    return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
  }
  const id = r.session.sessionId;
  speaking.set(id, { app: app.id, ended: false });
  // Kept a while past its end, for the page's summary of what it cost.
  setTimeout(() => speaking.delete(id), (r.session.maxSeconds + 900) * 1000).unref();
  console.log('[%s] speech session %s on avatar %s', app.id, id, avatarId.slice(0, 8));
  res.status(201).json(r.session);
});

// The call's state: once it ended, why, and what it cost (the page's summary).
api.get('/apps/:app/speech/:id', async (req, res) => {
  if (speaking.get(req.params.id)?.app !== req.params.app) return void res.status(404).json({ error: 'not_found' });
  const r = await readSpeechSession(req.params.id);
  res.status(r.status).json(r.json);
});

api.post('/apps/:app/speech/:id/end', async (req, res) => {
  const call = speaking.get(req.params.id);
  if (call?.app !== req.params.app) return void res.status(404).json({ error: 'not_found' });
  const r = await endSpeechSession(req.params.id);
  if (r.status === 200) call.ended = true;
  res.status(r.status).json(r.json);
});

/** Ends every session and render this server started and has not seen end: on shutdown, so a rollout leaves nothing billing. */
export async function endLiveSessions() {
  const ids = [...started.keys()];
  const renders = [...rendering.keys()];
  const calls = [...speaking].filter(([, call]) => !call.ended).map(([id]) => id);
  started.clear();
  rendering.clear();
  speaking.clear();
  await Promise.allSettled([...ids.map((id) => endSession(id)), ...renders.map((id) => endRender(id)), ...calls.map((id) => endSpeechSession(id))]);
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
