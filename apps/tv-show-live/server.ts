// The Gilded Reel's server side. A show is one LiveKit room of this site's own
// with three faces in it: the host's two cameras and the guest's, each an avatar-only render
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import type { AppServer } from '../../server/app-server.ts';
import { avatarApi } from '../../server/atmee.ts';
import { avatarFor } from '../../server/hosts.js';
import { endRender, renderConfigured, startRender } from '../../server/render.ts';
import { GUESTS, HOST, guestById, type Guest } from './show/cast.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { invent, invention } from './invent.ts';
import { BOOKER_SYSTEM, DELIVERY, HOST_USER, INTENT_SYSTEM, JUDGE_SYSTEM, bookerUser, guestScenario, hostScenario, judgeUser } from './show/script.ts';

const ID = 'tv-show-live';
const MAX_SECONDS = 900;

/**
 * A seat is the host (`host`) or a guest by id (`g-<guestId>`: a guest of the cast, or one
 * invented and built during the show), so two guests can each have a face and a line at
 * once: the next one warming up while the one on air talks.
 */
type Seat = string;
interface Show { room: string; renders: Map<string, Seat>; speech: Map<string, Seat>; at: number }
const shows = new Map<string, Show>();

const guestAvatar = (g: Guest) => process.env[`AVATAR_TV_SHOW_LIVE_GUEST_${g.id.toUpperCase()}`] || g.avatarId;
/** A guest of the cast, or an invented one once it is built. */
const guestOf = (id: string): Guest | undefined => {
  const cast = guestById(id);
  if (cast) return cast;
  const inv = invention(id);
  return inv?.ready ? inv.guest : undefined;
};
const maxSeconds = () => Number(process.env.MAX_SECONDS) || MAX_SECONDS;

function showFor(req: { params: Record<string, string> }, res: Response): { show: Show; seat: Seat; guest?: Guest } | null {
  const show = shows.get(req.params.show);
  const seat = req.params.seat;
  const guest = seat.startsWith('g-') ? guestOf(seat.slice(2)) : undefined;
  if (!show || (seat !== 'host' && !guest)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return { show, seat, guest };
}
const avatarOf = (seat: Seat, guest?: Guest) => (seat === 'host' ? avatarFor(ID) : guestAvatar(guest!));

// Each avatar's filler clips, by their fingerprints (show/clips.ts): those shipped with the app
// (fillers/<avatar>.json), and those the page has heard replayed since, kept for later shows.
const CLIP_SEEDS = fileURLToPath(new URL('./fillers/', import.meta.url));
const CLIP_LEARNED = join(tmpdir(), 'gilded-reel-fillers');
const CLIP_KEY = /^-?\d{1,9}:\d{1,10}$/;
const MAX_CLIP_KEYS = 60_000;
const clipKeys = new Map<string, Set<string>>();
const readKeys = (file: string): string[] => {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as string[]).filter((k) => CLIP_KEY.test(k)) : []; } catch { return []; }
};
function clipsOf(avatar: string): Set<string> {
  let keys = clipKeys.get(avatar);
  if (!keys) {
    keys = new Set([...readKeys(join(CLIP_SEEDS, `${avatar}.json`)), ...readKeys(join(CLIP_LEARNED, `${avatar}.json`))]);
    clipKeys.set(avatar, keys);
  }
  return keys;
}
function learnClips(avatar: string, keys: string[]): number {
  const known = clipsOf(avatar);
  const before = known.size;
  for (const k of keys) if (known.size < MAX_CLIP_KEYS && CLIP_KEY.test(k)) known.add(k);
  if (known.size > before) {
    mkdirSync(CLIP_LEARNED, { recursive: true });
    writeFileSync(join(CLIP_LEARNED, `${avatar}.json`), JSON.stringify([...known]));
  }
  return known.size - before;
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
  title: 'The Gilded Reel',
  tagline: 'A late-night show on the art of film: a trailer, then the designer on the studio screen, live on speech-to-speech.',
  brand: { color: '#14110b', ink: '#e7c873' },
  way: 'speech-to-speech',
  maxSeconds: MAX_SECONDS,
  routes(router) {
    router.get('/guests', (_req, res) => {
      res.json(GUESTS.map(({ id, name, billing, from, rundown }) => ({ id, name, billing, from, rundown })));
    });

    // Invent a guest: it is written, drawn, voiced and built in the background (invent.ts);
    // the page follows its steps, and seats it (g-<id>) once it is ready.
    router.post('/guests/invent', (req, res) => {
      const description = String(req.body?.description ?? '').trim().slice(0, 400);
      if (description.length < 3) return void res.status(400).json({ error: 'bad_request', message: 'Describe the guest.' });
      if (!llmAvailable()) return void res.status(503).json({ error: 'no_model', message: 'Set GEMINI_API_KEY' });
      const inv = invent(description);
      console.log('[%s] inventing %s: %s', ID, inv.id, description);
      res.status(202).json({ id: inv.id });
    });
    router.get('/guests/invent/:id', (req, res) => {
      const inv = invention(req.params.id);
      if (!inv) return void res.status(404).json({ error: 'not_found' });
      const { id, steps, guest, portrait, ready, error, startedAt } = inv;
      res.json({ id, steps, guest: guest && { id: guest.id, name: guest.name, billing: guest.billing, from: guest.from, rundown: guest.rundown }, portrait, ready, error, seconds: Math.round((Date.now() - startedAt) / 1000) });
    });

    router.post('/shows', (_req, res) => {
      if (!renderConfigured()) return void res.status(503).json({ error: 'livekit_not_configured', message: 'Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET' });
      if (!avatarFor(ID)) return void res.status(500).json({ error: 'no_avatar' });
      const showId = randomUUID();
      shows.set(showId, { room: `gilded-reel-${showId}`, renders: new Map(), speech: new Map(), at: Date.now() });
      // A show nobody ended is forgotten once its sessions can no longer run.
      setTimeout(() => shows.delete(showId), (maxSeconds() + 600) * 1000).unref();
      console.log('[%s] show %s', ID, showId.slice(0, 8));
      res.status(201).json({ showId });
    });

    router.post('/show/:show/:seat/render', async (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      const { show, seat, guest } = found;
      // A fresh identity per attempt: a start that timed out at the gateway may still join later,
      // and must not take the place of the face that did start.
      const r = await startRender(avatarOf(seat, guest), maxSeconds(), { app: 'atmee-usecase-demos', usecase: ID, seat },
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
      const { show, seat, guest } = found;
      const settings = seat === 'host'
        // The session opens by greeting its user by name: the host's user is the viewers until her
        // guest is on (her scenario says who speaks after that), or she welcomes a guest not yet there.
        ? { scenario: hostScenario(), user_name: HOST_USER, instructions: DELIVERY }
        : { scenario: guestScenario(guest!), user_name: HOST.name, instructions: DELIVERY };
      const r = await avatarApi('POST', '/v1/speech_sessions', { avatarId: avatarOf(seat, guest), maxDurationSeconds: maxSeconds(), settings });
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

    // A voice's filler clips: the page silences them, and reports the ones it has heard replayed.
    router.get('/show/:show/:seat/fillers', (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      const avatar = avatarOf(found.seat, found.guest);
      res.json({ keys: avatar ? [...clipsOf(avatar)] : [] });
    });
    router.post('/show/:show/:seat/fillers', (req, res) => {
      const found = showFor(req, res);
      if (!found) return;
      const avatar = avatarOf(found.seat, found.guest);
      const keys = Array.isArray(req.body?.keys) ? (req.body.keys as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 5_000) : [];
      if (!avatar || !keys.length) return void res.status(400).json({ error: 'no_keys' });
      const added = learnClips(avatar, keys);
      if (added) console.log('[%s] %s fillers: %d new fingerprints', ID, found.seat, added);
      res.json({ added });
    });

    // Auto-advance's judge: has the current topic run its course? { done, reason }
    router.post('/show/:show/judge', async (req, res) => {
      const show = shows.get(req.params.show);
      if (!show) return void res.status(404).json({ error: 'not_found' });
      const topic = String(req.body?.topic ?? '').slice(0, 300);
      const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(-12)
        .map((l: { who?: unknown; text?: unknown }) => ({ who: l?.who === 'guest' ? 'guest' as const : 'host' as const, text: String(l?.text ?? '').slice(0, 1200) }));
      if (!topic || !lines.length) return void res.status(400).json({ error: 'bad_request' });
      try {
        const verdict = await structured<{ done: boolean; reason: string }>({
          system: JUDGE_SYSTEM,
          user: judgeUser(String(req.body?.guest ?? 'the guest').slice(0, 100), topic, lines),
          schema: { type: 'object', properties: { done: { type: 'boolean' }, reason: { type: 'string' } }, required: ['done', 'reason'] },
          temperature: 0,
        });
        console.log('[%s] judge %s: %s (%s)', ID, req.params.show.slice(0, 8), verdict.done ? 'move on' : 'stay', verdict.reason);
        res.json({ done: verdict.done === true, reason: String(verdict.reason ?? '').slice(0, 120) });
      } catch (err) {
        console.warn('[%s] judge failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'judge_failed' });
      }
    });

    // Auto-booking's booker: is there a natural reason to bring on another of the film's makers? { book, description, reason }
    router.post('/show/:show/book', async (req, res) => {
      if (!shows.get(req.params.show)) return void res.status(404).json({ error: 'not_found' });
      const guests = (Array.isArray(req.body?.guests) ? req.body.guests : []).slice(0, 6).map((g: unknown) => String(g).slice(0, 200));
      const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(-12)
        .map((l: { who?: unknown; text?: unknown }) => ({ who: l?.who === 'guest' ? 'guest' as const : 'host' as const, text: String(l?.text ?? '').slice(0, 1200) }));
      if (!lines.length) return void res.status(400).json({ error: 'bad_request' });
      try {
        const b = await structured<{ book: boolean; description: string; reason: string }>({
          system: BOOKER_SYSTEM,
          user: bookerUser(guests, lines, String(req.body?.guest ?? 'the guest').slice(0, 100)),
          schema: { type: 'object', properties: { book: { type: 'boolean' }, description: { type: 'string' }, reason: { type: 'string' } }, required: ['book', 'description', 'reason'] },
          temperature: 0.2,
        });
        console.log('[%s] booker %s: %s%s', ID, req.params.show.slice(0, 8), b.book ? 'book ' : 'no one', b.book ? `${b.description} (${b.reason})` : '');
        res.json({ book: b.book === true, description: String(b.description ?? '').slice(0, 300), reason: String(b.reason ?? '').slice(0, 120) });
      } catch (err) {
        console.warn('[%s] booker failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'booker_failed' });
      }
    });

    // The booth's command box, read for what the producer means: { kind: invite | topic | note, description, topic }
    router.post('/show/:show/intent', async (req, res) => {
      if (!shows.get(req.params.show)) return void res.status(404).json({ error: 'not_found' });
      const text = String(req.body?.text ?? '').trim().slice(0, 500);
      if (!text) return void res.status(400).json({ error: 'bad_request' });
      try {
        const r = await structured<{ kind: string; description: string; topic: string }>({
          system: INTENT_SYSTEM,
          user: text,
          schema: { type: 'object', properties: { kind: { type: 'string', enum: ['invite', 'topic', 'note'] }, description: { type: 'string' }, topic: { type: 'string' } }, required: ['kind', 'description', 'topic'] },
          temperature: 0,
        });
        const kind = ['invite', 'topic', 'note'].includes(r.kind) ? r.kind : 'note';
        res.json({ kind, description: String(r.description ?? '').slice(0, 300), topic: String(r.topic ?? '').slice(0, 120) });
      } catch (err) {
        console.warn('[%s] intent failed: %s', ID, (err as Error).message);
        res.status(502).json({ error: 'intent_failed' });
      }
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
