// Nightcap Live's server side: two conversations at once, the host's and the
// guest's, each its own POST /v1/session. The page joins both and carries
// each avatar's words to the other (show/booth.ts). The session routes live
// under this app's own path, one per seat, so the page's joinAvatar finds
// them as it finds any app's: /api/apps/tv-show/host/session and
// /api/apps/tv-show/guest/<guest>/session, each with its /<id>/end.
import type { Response } from 'express';
import type { AppServer } from '../../server/app-server.ts';
import { avatarApi, endSession, startSession } from '../../server/atmee.ts';
import { avatarFor } from '../../server/hosts.js';
import { GUESTS, guestById } from './show/guests.ts';

const ID = 'tv-show';
const MAX_SECONDS = 900;

/** A guest's avatar: AVATAR_TV_SHOW_GUEST_<ID> in the environment, else the roster's. */
const guestAvatar = (id: string) => process.env[`AVATAR_TV_SHOW_GUEST_${id.toUpperCase()}`] || guestById(id)?.avatarId || '';

// Sessions this server started, by id, with the seat they are for.
const started = new Map<string, string>();

async function seat(seatName: string, avatarId: string, res: Response) {
  // A guest that carries an agenda would steer the call back to its own app's steps.
  if (seatName !== 'host') {
    const a = await avatarApi('GET', `/v1/avatars/${avatarId}`);
    if (a.json?.conductor?.configured) {
      console.warn('[%s] guest %s carries a conductor; not putting it on air', ID, avatarId.slice(0, 8));
      return void res.status(409).json({ error: 'guest_has_agenda' });
    }
  }
  const maxSeconds = Number(process.env.MAX_SECONDS) || MAX_SECONDS;
  const r = await startSession(avatarId, maxSeconds, { app: 'atmee-usecase-demos', usecase: ID, seat: seatName });
  if (!r.ok) {
    console.warn('[%s] %s: POST /v1/session -> %d %s %s', ID, seatName, r.status, r.json?.error ?? '', r.json?.message ?? '');
    return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
  }
  started.set(r.session.sessionId, seatName);
  setTimeout(() => started.delete(r.session.sessionId), (maxSeconds + 120) * 1000).unref();
  console.log('[%s] %s session %s on avatar %s', ID, seatName, r.session.sessionId, avatarId.slice(0, 8));
  res.status(201).json(r.session);
}

async function end(seatName: string, sessionId: string, res: Response) {
  if (started.get(sessionId) !== seatName) return void res.status(404).json({ error: 'not_found' });
  const r = await endSession(sessionId);
  if (r.status === 200) started.delete(sessionId);
  res.status(r.status).json(r.json);
}

// A rollout or Ctrl-C: end the show's sessions too, so nothing is left billing.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { for (const id of started.keys()) void endSession(id); });
}

const app: AppServer = {
  id: ID,
  title: 'Nightcap Live',
  tagline: 'A talk show: Nico video-calls a guest, and you run the booth.',
  brand: { color: '#1a1030', ink: '#ffffff' },
  maxSeconds: MAX_SECONDS,
  routes(router) {
    router.get('/guests', (_req, res) => {
      res.json(GUESTS.map(({ id, name, billing, subject, rundown }) => ({ id, name, billing, subject, rundown, ready: Boolean(guestAvatar(id)) })));
    });

    router.post('/host/session', async (_req, res) => {
      const avatarId = avatarFor(ID);
      if (!avatarId) return void res.status(500).json({ error: 'no_avatar' });
      await seat('host', avatarId, res);
    });
    router.post('/host/session/:id/end', (req, res) => end('host', req.params.id, res));

    router.post('/guest/:guest/session', async (req, res) => {
      const guest = guestById(req.params.guest);
      const avatarId = guest && guestAvatar(guest.id);
      if (!avatarId) return void res.status(404).json({ error: 'unknown_guest' });
      await seat(`guest:${guest.id}`, avatarId, res);
    });
    router.post('/guest/:guest/session/:id/end', (req, res) => end(`guest:${req.params.guest}`, req.params.id, res));
  },
};

export default app;
