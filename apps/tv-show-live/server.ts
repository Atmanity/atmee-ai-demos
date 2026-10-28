// The Late Line's server side. A show is one LiveKit room of this site's own
// with two faces in it, the host's and the guest's, each an avatar-only render
// under its own identity, and two speech-to-speech sessions, one per avatar,
// that the page wires to each other: each one's voice is the other's ears, and
// each one's voice is its face's speech. The API key and the LiveKit secret
// stay here; the page gets a token per seat.
//
//   POST /api/apps/tv-show-live/shows                       { guest } -> { showId }
//   POST /api/apps/tv-show-live/show/<show>/<seat>/render    the seat's face, in the show's room
//   POST /api/apps/tv-show-live/show/<show>/<seat>/speech    the seat's speech session: { url, token }
//   POST .../render/<id>/end, .../speech/<id>/end, /show/<show>/end
//
// <seat> is host or guest. Each speech session is pinned to its role on the
// show (scenario, user_name): the page cannot change who an avatar thinks it
// is talking to.
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AppServer } from '../../server/app-server.ts';
import { avatarApi } from '../../server/atmee.ts';
import { avatarFor } from '../../server/hosts.js';
import { endRender, renderConfigured, startRender } from '../../server/render.ts';
import { GUESTS, HOST, guestById, type Guest } from './show/cast.ts';
import { DELIVERY, guestScenario, hostScenario } from './show/script.ts';

const ID = 'tv-show-live';
const MAX_SECONDS = 900;

type Seat = 'host' | 'guest';
interface Show { room: string; guest: Guest; renders: Map<string, Seat>; speech: Map<string, Seat>; at: number }
const shows = new Map<string, Show>();

const guestAvatar = (g: Guest) => process.env[`AVATAR_TV_SHOW_LIVE_GUEST_${g.id.toUpperCase()}`] || g.avatarId;
const avatarOf = (show: Show, seat: Seat) => (seat === 'host' ? avatarFor(ID) : guestAvatar(show.guest));
const maxSeconds = () => Number(process.env.MAX_SECONDS) || MAX_SECONDS;

function showFor(req: { params: Record<string, string> }, res: Response): { show: Show; seat: Seat } | null {
  const show = shows.get(req.params.show);
  const seat = req.params.seat;
  if (!show || (seat !== 'host' && seat !== 'guest')) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return { show, seat };
}

async function endSpeech(id: string) {
  return avatarApi('POST', `/v1/speech_sessions/${id}/end`);
}

async function endShow(show: Show) {
  await Promise.allSettled([...[...show.renders.keys()].map(endRender), ...[...show.speech.keys()].map(endSpeech)]);
  show.renders.clear();
  show.speech.clear();
}

// A rollout or Ctrl-C ends every show's sessions, so nothing is left billing.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { for (const show of shows.values()) void endShow(show); });
}

const app: AppServer = {
  id: ID,
  title: 'The Late Line',
  tagline: 'A talk show on speech-to-speech: Jada and her guest hear each other directly, in one room.',
  brand: { color: '#0d2b2b', ink: '#ffffff' },
  way: 'speech-to-speech',
  maxSeconds: MAX_SECONDS,
  routes(router) {
    router.get('/guests', (_req, res) => {
      res.json(GUESTS.map(({ id, name, billing, from, rundown }) => ({ id, name, billing, from, rundown })));
    });

    router.post('/shows', (req, res) => {
      if (!renderConfigured()) return void res.status(503).json({ error: 'livekit_not_configured', message: 'Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET' });
      const guest = guestById(String(req.body?.guest ?? ''));
      if (!guest) return void res.status(404).json({ error: 'unknown_guest' });
      if (!avatarFor(ID)) return void res.status(500).json({ error: 'no_avatar' });
      const showId = randomUUID();
      shows.set(showId, { room: `late-line-${showId}`, guest, renders: new Map(), speech: new Map(), at: Date.now() });
      // A show nobody ended is forgotten once its sessions can no longer run.
      setTimeout(() => shows.delete(showId), (maxSeconds() + 600) * 1000).unref();
      console.log('[%s] show %s with guest %s', ID, showId.slice(0, 8), guest.id);
      res.status(201).json({ showId });
    });

    router.post('/show/:show/:seat/render', async (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      const { show, seat } = found;
      // A fresh identity per attempt: a start that timed out at the gateway may still join later,
      // and must not take the place of the face that did start.
      const r = await startRender(avatarOf(show, seat), maxSeconds(), { app: 'atmee-usecase-demos', usecase: ID, seat },
        { room: show.room, avatarIdentity: `face-${seat}-${randomUUID().slice(0, 6)}` });
      // The v2 pool can take minutes to start a second worker, longer than the gateway waits:
      // the page retries, as it does while a render warms up (the pool is starting by then).
      if (!r.ok && [502, 504, 524].includes(r.status)) {
        console.warn('[%s] %s render -> %d (gateway timeout); the page retries', ID, seat, r.status);
        return void res.status(503).json({ error: 'avatar_warming', retryAfter: 5 });
      }
      if (!r.ok) {
        console.warn('[%s] %s render -> %d %s %s', ID, seat, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      show.renders.set(r.render.sessionId, seat);
      console.log('[%s] %s face %s in %s', ID, seat, r.render.sessionId.slice(0, 8), show.room);
      res.status(201).json(r.render);
    });
    router.post('/show/:show/:seat/render/:id/end', async (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      if (found.show.renders.get(req.params.id) !== found.seat) return void res.status(404).json({ error: 'not_found' });
      const r = await endRender(req.params.id);
      if (r.status === 200) found.show.renders.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    router.post('/show/:show/:seat/speech', async (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      const { show, seat } = found;
      const settings = seat === 'host'
        ? { scenario: hostScenario(show.guest), user_name: show.guest.name, instructions: DELIVERY }
        : { scenario: guestScenario(show.guest), user_name: HOST.name, instructions: DELIVERY };
      const r = await avatarApi('POST', '/v1/speech_sessions', { avatarId: avatarOf(show, seat), maxDurationSeconds: maxSeconds(), settings });
      if (r.status !== 201) {
        console.warn('[%s] %s speech -> %d %s %s', ID, seat, r.status, r.json?.error ?? '', r.json?.message ?? '');
        return void res.status(r.status).json({ error: r.json?.error || `http_${r.status}`, retryAfter: r.retryAfter });
      }
      const { sessionId, url, token, actualDurationSeconds } = r.json;
      show.speech.set(sessionId, seat);
      console.log('[%s] %s speech %s', ID, seat, String(sessionId).slice(0, 8));
      res.status(201).json({ sessionId, url, token, maxSeconds: actualDurationSeconds ?? null });
    });
    router.post('/show/:show/:seat/speech/:id/end', async (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      if (found.show.speech.get(req.params.id) !== found.seat) return void res.status(404).json({ error: 'not_found' });
      const r = await endSpeech(req.params.id);
      if (r.status === 200) found.show.speech.delete(req.params.id);
      res.status(r.status).json(r.json);
    });

    router.post('/show/:show/end', async (req, res) => {
      const show = shows.get(req.params.show);
      if (!show) return void res.status(404).json({ error: 'not_found' });
      await endShow(show);
      shows.delete(req.params.show);
      res.json({ ended: true });
    });
  },
};

export default app;
