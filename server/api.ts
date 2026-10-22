// /api: the apps (discovered from apps/<id>/server.ts), their sessions, and
// each app's own routes under /api/apps/<id>/.
import { existsSync, readdirSync } from 'node:fs';
import { Router } from 'express';
import type { AppServer } from './app-server.ts';
import { endSession, setConductor, startSession } from './atmee.ts';

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

const avatarFor = (id: string) =>
  process.env[`AVATAR_${id.toUpperCase().replace(/-/g, '_')}`] || process.env.AVATAR_DEFAULT || '';

// Which app's agenda each avatar carries now, so a shared avatar is switched
// only when the app changes.
const conductorOf = new Map<string, string>();
// Sessions this server started, forgotten once they can no longer run.
const started = new Map<string, string>();

export const api = Router();

api.get('/apps', (_req, res) => {
  res.json([...apps.values()].map(({ id, title, tagline }) => ({ id, title, tagline, avatar: Boolean(avatarFor(id)) })));
});

api.post('/apps/:app/session', async (req, res) => {
  const app = apps.get(req.params.app);
  if (!app) return void res.status(404).json({ error: 'unknown_app' });
  const avatarId = avatarFor(app.id);
  if (!avatarId) return void res.status(500).json({ error: 'no_avatar', message: `Set AVATAR_DEFAULT or AVATAR_${app.id.toUpperCase().replace(/-/g, '_')}` });

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
  const r = await startSession(avatarId, maxSeconds, { app: 'atmee-usecase-demos', usecase: app.id });
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

api.post('/apps/:app/session/:id/end', async (req, res) => {
  if (started.get(req.params.id) !== req.params.app) return void res.status(404).json({ error: 'not_found' });
  const r = await endSession(req.params.id);
  if (r.status === 200) started.delete(req.params.id);
  res.status(r.status).json(r.json);
});

for (const app of apps.values()) {
  if (!app.routes) continue;
  const router = Router();
  app.routes(router);
  api.use(`/apps/${app.id}`, router);
}
