// Five sample apps on the Atmee Avatar API, one small server.
//
// The server is the only place that holds the API key. Per use case it starts
// the avatar's session (POST /v1/session), sets the avatar's conductor (the
// conversation agenda, PUT /v1/avatars/{id}/conductor) when the use case has
// one, hands the room's LiveKit token to ONE host page, and runs whatever the
// use case needs around the room: a chatroom, a screen observer, a game log.
// The host page is the session's user participant: it relays what the server
// decides into the room (lk.chat = a user turn the avatar answers, atmee.app
// state/note/event/mute = context the avatar reads without a turn) and sends
// the avatar's captions (lk.transcription) back. When the use case declares
// app tools, the session is started with them (appTools); the avatar's calls
// reach the host page, which answers them and passes each one back here.
//
//   ATMEE_BASE_URL     https://staging.atmanity.us
//   ATMEE_API_KEY      an Avatar API key
//   AVATAR_<USECASE>   the avatar each use case runs (LIVESTREAM, RECRUITER, TRAINING, PRESENCE, GAME)
//   GEMINI_API_KEY     the presence use case's eyes (optional: without it the observer only diffs frames)
//   DEMO_PASSWORD      optional: when set, every page, /api route and WebSocket asks for it (HTTP basic auth)
//   PORT               default 3333
//
// Settings come from the environment: `node --env-file=.env server.js` locally,
// the pod's env in a container.
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { WebSocketServer } from "ws";
import { USECASES } from "./usecases/index.js";
import { describeFrame } from "./usecases/observer.js";

const BASE = process.env.ATMEE_BASE_URL || "https://staging.atmanity.us";
const PORT = Number(process.env.PORT || 3333);
const KEY = process.env.ATMEE_API_KEY;
if (!KEY) throw new Error("ATMEE_API_KEY is required");
const headers = { "X-Api-Key": KEY, "Content-Type": "application/json" };

// A network error before any answer (staging showed "fetch failed" on a cold
// connection) is retried once for the calls that are safe to repeat (setting
// or clearing a conductor, ending a session); a session start is not
// repeated, since it may have gone through.
async function api(method, path, body) {
  const send = () => fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let res;
  try { res = await send(); } catch (err) {
    const why = err.cause ? `${err.message}: ${err.cause.code || err.cause.message}` : err.message;
    if (method === "POST" && !path.endsWith("/end")) throw new Error(`${method} ${path} -> ${why}`);
    console.log(`${method} ${path} -> ${why}; retrying once`);
    await new Promise((r) => setTimeout(r, 1000));
    res = await send();
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, retryAfter: Number(res.headers.get("retry-after") || 0) };
}

// ---------------------------------------------------------------------------
// One hub per use case: its session, its host page, its audience, its state.
// ---------------------------------------------------------------------------
const hubs = new Map();
function hub(name) {
  const def = USECASES[name];
  if (!def) return null;
  if (!hubs.has(name)) {
    hubs.set(name, {
      name, def, avatarId: process.env[`AVATAR_${name.toUpperCase()}`] || process.env.AVATAR_ID,
      session: null, host: null, viewers: new Set(), transcript: [], pending: [],
      streamer: null, watchers: new Map(), // the video relay: the studio's socket, and viewer id -> socket
      memo: {}, // the use case's own scratch state (scores, scene, last observation)
    });
  }
  return hubs.get(name);
}

function toHost(h, msg) { if (h.host && h.host.readyState === h.host.OPEN) h.host.send(JSON.stringify(msg)); }
function broadcast(h, msg) {
  const data = JSON.stringify(msg);
  for (const ws of h.viewers) if (ws.readyState === ws.OPEN) ws.send(data);
  toHost(h, msg);
}
function toViewers(h, msg) { const data = JSON.stringify(msg); for (const ws of h.viewers) if (ws.readyState === ws.OPEN) ws.send(data); }
// A policy returns relay messages for the host page: say (lk.chat) or app (atmee.app).
function relay(h, messages) { for (const m of messages || []) toHost(h, m); }

// The conductor is the avatar's, not the session's. Each app has its own
// avatar, so this sets the agenda once per avatar per server run; it still
// clears one that another app left, for a setup that points two apps at the
// same avatar (one avatar for all five apps, as on a local test stack).
const conductorOf = new Map(); // avatarId -> the use case whose conductor it has
async function ensureConductor(h) {
  const owner = conductorOf.get(h.avatarId);
  if (owner === h.name || (!h.def.conductor && owner === undefined)) return;
  const r = h.def.conductor
    ? await api("PUT", `/v1/avatars/${h.avatarId}/conductor`, { graph: h.def.conductor, speakAfterS: h.def.speakAfterS || 0.8 })
    : await api("DELETE", `/v1/avatars/${h.avatarId}/conductor`);
  console.log(`[${h.name}] conductor ${h.def.conductor ? "set" : "cleared"} -> ${r.status} ${r.json.nodes ? r.json.nodes + " nodes" : JSON.stringify(r.json).slice(0, 200)}`);
  if (r.status < 300 || r.status === 404) conductorOf.set(h.avatarId, h.name);
}

async function startSession(h) {
  if (!h.avatarId) throw Object.assign(new Error(`AVATAR_${h.name.toUpperCase()} is not set`), { status: 500 });
  await ensureConductor(h);
  const r = await api("POST", "/v1/session", {
    avatarId: h.avatarId, maxDurationSeconds: Number(process.env.MAX_SECONDS || 900),
    language: h.def.language, metadata: { app: "atmee-usecase-demos", usecase: h.name },
    ...(h.def.appTools ? { appTools: h.def.appTools } : {}),
  });
  if (r.status !== 201) {
    const err = new Error(`POST /v1/session -> ${r.status} ${r.json.error || ""} ${r.json.message || ""}`.trim());
    err.status = r.status; err.retryAfter = r.retryAfter; throw err;
  }
  h.session = { sessionId: r.json.sessionId, roomName: r.json.roomName, serverUrl: r.json.serverUrl, userToken: r.json.userToken, maxSeconds: r.json.actualDurationSeconds, startedAt: Date.now() };
  h.transcript = []; h.pending = []; h.memo = {};
  console.log(`[${h.name}] session ${h.session.sessionId} room=${h.session.roomName} max=${h.session.maxSeconds}s tools=${h.def.appTools ? h.def.appTools.tools.map((t) => t.name).join(",") : "none"}`);
  return h.session;
}
async function endSession(h) {
  if (!h.session) return;
  const id = h.session.sessionId; h.session = null;
  if (h.def.onEnd) h.def.onEnd(h, (m) => broadcast(h, m)); // e.g. close the stream's open poll
  if (h.streamer) h.streamer.close(); // the video relay ends with the session
  h.memo = {}; // nothing of this session is shown to whoever connects next
  try {
    const r = await api("POST", `/v1/session/${id}/end`);
    console.log(`[${h.name}] end ${id} -> ${r.status}`);
  } catch (err) {
    // The session still ends on its own (the user left the room); the server stays up.
    console.log(`[${h.name}] end ${id} failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Access: one shared password for a public deployment, off when unset.
// ---------------------------------------------------------------------------
// The browser asks for it once (HTTP basic auth, any user name); the server
// then sets a cookie, because a browser does not reliably send basic
// credentials with a WebSocket handshake, and every page here opens one.
const PASSWORD = process.env.DEMO_PASSWORD || "";
const COOKIE = "atmee_demo";
const ticket = PASSWORD ? createHmac("sha256", PASSWORD).update("atmee-ai-demos").digest("hex") : "";
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
function hasTicket(req) {
  const m = /(?:^|;\s*)atmee_demo=([0-9a-f]+)/.exec(req.headers.cookie || "");
  return !!m && same(m[1], ticket);
}
function hasPassword(req) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return false;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  return same(decoded.slice(decoded.indexOf(":") + 1), PASSWORD);
}
export function requirePassword(req, res, next) {
  if (!PASSWORD || hasTicket(req)) return next();
  if (hasPassword(req)) {
    res.setHeader("Set-Cookie", `${COOKIE}=${ticket}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
    return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="atmee demos", charset="UTF-8"');
  res.status(401).send("Password required");
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use(requirePassword);
app.use(express.json({ limit: "6mb" }));
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));
app.get("/api/usecases", (_req, res) => res.json(Object.fromEntries(Object.entries(USECASES).map(([k, v]) => [k, { title: v.title, page: v.page, avatarId: process.env[`AVATAR_${k.toUpperCase()}`] || null, conductor: !!v.conductor, tools: v.appTools ? v.appTools.tools.map((t) => t.name) : [] }]))));

// Each app's avatar face for the home page cards. The API hands out the
// portrait (thumbnailUrl) as a presigned link that expires within the hour, so
// the page never sees it: the server fetches the image right away, shrinks it
// to a 192 px WebP (the card draws a 96 px circle; every current browser takes
// WebP), keeps those bytes and serves them from here. A kept image is checked
// again after PORTRAIT_TTL_MS (a replaced portrait shows up then); when that
// check fails the old image is served on. No avatar, or one without a portrait, is a 404
// and the card keeps its emoji.
const PORTRAIT_TTL_MS = 30 * 60 * 1000;
const PORTRAIT_PX = 192;
const portraits = new Map(); // usecase -> { at, avatarId, image?: { bytes, type, etag } }
const portraitLoads = new Map(); // usecase -> the fetch in flight
async function loadPortrait(avatarId) {
  const r = await fetch(`${BASE}/v1/avatars/${encodeURIComponent(avatarId)}`, { headers: { "X-Api-Key": KEY }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET /v1/avatars -> ${r.status}`);
  const url = (await r.json()).thumbnailUrl;
  if (!url) return null;
  const img = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const type = img.headers.get("content-type") || "";
  if (!img.ok || !type.startsWith("image/")) throw new Error(`portrait -> ${img.status} ${type}`);
  // The portraits are square head-and-shoulders shots; a taller one keeps its top, where the face is.
  const bytes = await sharp(Buffer.from(await img.arrayBuffer()))
    .resize(PORTRAIT_PX, PORTRAIT_PX, { fit: "cover", position: "top" })
    .webp({ quality: 80 })
    .toBuffer();
  // The storage object's name changes when the portrait is replaced.
  const etag = `"${createHmac("sha256", `portrait-webp-${PORTRAIT_PX}`).update(new URL(url).pathname).digest("hex").slice(0, 16)}"`;
  return { bytes, type: "image/webp", etag };
}
app.get("/api/avatars/:usecase/portrait", async (req, res) => {
  const name = req.params.usecase;
  const avatarId = USECASES[name] ? hub(name).avatarId : null;
  if (!avatarId) return res.status(404).set("Cache-Control", "no-store").json({ error: "no avatar for this use case" });
  let entry = portraits.get(name);
  if (!entry || entry.avatarId !== avatarId || Date.now() - entry.at > PORTRAIT_TTL_MS) {
    if (!portraitLoads.has(name)) {
      portraitLoads.set(name, loadPortrait(avatarId)
        .then((image) => portraits.set(name, { at: Date.now(), avatarId, image }))
        .catch((err) => {
          console.log(`[${name}] portrait failed: ${err.message}`);
          // Keep serving the image we have; without one, ask again next time.
          const kept = portraits.get(name);
          if (kept && kept.avatarId === avatarId && kept.image) kept.at = Date.now() - PORTRAIT_TTL_MS + 60_000;
        })
        .finally(() => portraitLoads.delete(name)));
    }
    await portraitLoads.get(name);
    entry = portraits.get(name);
  }
  const image = entry && entry.avatarId === avatarId ? entry.image : null;
  if (!image) return res.status(404).set("Cache-Control", "no-store").json({ error: "no portrait" });
  res.set({ "Cache-Control": "private, max-age=1800, stale-while-revalidate=86400", ETag: image.etag, "Content-Type": image.type });
  if (req.headers["if-none-match"] === image.etag) return res.status(304).end();
  res.send(image.bytes);
});

app.post("/api/:usecase/session", async (req, res) => {
  const h = hub(req.params.usecase);
  if (!h) return res.status(404).json({ error: "unknown use case" });
  console.log(`[${h.name}] session requested`);
  try {
    if (!h.session) await startSession(h);
    const { sessionId, serverUrl, userToken, roomName, maxSeconds } = h.session;
    res.json({ sessionId, serverUrl, userToken, roomName, maxSeconds, avatarId: h.avatarId });
  } catch (err) {
    console.log(`[${h.name}] start failed: ${err.message}${err.retryAfter ? ` (retry after ${err.retryAfter} s)` : ""}`);
    res.status(err.status === 503 || err.status === 409 ? err.status : 502).json({ error: String(err.message), retryAfter: err.retryAfter || 0 });
  }
});
app.post("/api/:usecase/session/end", async (req, res) => { const h = hub(req.params.usecase); if (h) await endSession(h); res.json({ ok: true }); });

// The presence use case's eyes: the page posts a JPEG when the screen changed;
// the observer describes it and the policy turns that into state and events.
app.post("/api/presence/frame", async (req, res) => {
  const h = hub("presence");
  try {
    const seen = await describeFrame(req.body.image, h.memo.lastDescription, req.body.hint);
    h.memo.lastDescription = seen.description;
    relay(h, h.def.onObservation(h, seen));
    broadcast(h, { type: "observation", ...seen, ts: Date.now() });
    res.json(seen);
  } catch (err) { res.status(502).json({ error: String(err.message) }); }
});

// ---------------------------------------------------------------------------
// The video relay (livestream): the studio page forwards the avatar to each
// viewer over its own RTCPeerConnection, and this server only passes the
// offer, answer and ICE candidates between them, keyed by the viewer's
// connection id. The studio connects as role=streamer once it is live; a
// viewer asks to watch, and is turned away when MAX_WATCHERS already do
// (each one costs the studio its upload).
// ---------------------------------------------------------------------------
const MAX_WATCHERS = Number(process.env.LIVESTREAM_MAX_WATCHERS || 8);
let nextViewerId = 1;
const sendTo = (ws, msg) => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };

function onStreamer(h, ws) {
  if (!h.session) return ws.close(4000, "no live session");
  if (h.streamer && h.streamer !== ws) h.streamer.close(4001, "replaced");
  h.streamer = ws;
  console.log(`[${h.name}] streamer connected, ${h.watchers.size} watcher(s) waiting`);
  sendTo(ws, { type: "watchers", ids: [...h.watchers.keys()], max: MAX_WATCHERS });
  toViewers(h, { type: "stream", live: true });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === "rtc" && h.watchers.has(msg.to)) sendTo(h.watchers.get(msg.to), { type: "rtc", data: msg.data });
  });
  ws.on("close", () => {
    if (h.streamer !== ws) return;
    h.streamer = null;
    console.log(`[${h.name}] streamer left`);
    toViewers(h, { type: "stream", live: false });
  });
}
// A viewer's relay messages; true when the message was one.
function onWatcherMessage(h, ws, msg) {
  if (msg.type === "watch") {
    if (!h.watchers.has(ws.viewerId) && h.watchers.size >= MAX_WATCHERS) { sendTo(ws, { type: "watch-full", max: MAX_WATCHERS }); return true; }
    h.watchers.set(ws.viewerId, ws);
    sendTo(ws, { type: "watching", live: !!h.streamer });
    sendTo(h.streamer, { type: "watcher", id: ws.viewerId }); // again on a repeat: the studio makes a fresh offer
    return true;
  }
  if (msg.type === "rtc") { if (h.watchers.has(ws.viewerId)) sendTo(h.streamer, { type: "rtc", from: ws.viewerId, data: msg.data }); return true; }
  return false;
}
function onWatcherClose(h, ws) {
  if (!h.watchers.delete(ws.viewerId)) return;
  sendTo(h.streamer, { type: "watcher-left", id: ws.viewerId });
}

// ---------------------------------------------------------------------------
// WebSocket: /?usecase=<name>&role=host|viewer|streamer
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({
  noServer: true,
  verifyClient: ({ req }) => !PASSWORD || hasTicket(req) || hasPassword(req),
});
wss.on("connection", (ws, req) => {
  const q = new URL(req.url, "http://x").searchParams;
  const h = hub(q.get("usecase") || "livestream");
  if (!h) return ws.close();
  const role = q.get("role") || "viewer";
  if (role === "host") {
    h.host = ws;
    ws.send(JSON.stringify({ type: "history", transcript: h.transcript.slice(-50) }));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "caption") {
        const entry = { role: "avatar", text: msg.text, final: msg.final, id: msg.id, ts: Date.now() };
        if (msg.final) h.transcript.push(entry);
        broadcast(h, { type: "caption", ...entry });
      } else if (msg.type === "tool") {
        // An app tool call the host page answered: the use case may react too.
        console.log(`[${h.name}] tool ${msg.name} ${JSON.stringify(msg.arguments)} -> ${msg.error ? "error: " + msg.error : String(msg.result).slice(0, 120)}`);
        if (h.def.onTool) relay(h, h.def.onTool(h, msg, (m) => broadcast(h, m)));
      } else if (msg.type === "linked") {
        relay(h, h.def.onLinked ? h.def.onLinked(h) : []);
      } else if (msg.type === "user") {
        // Something the host page's own user did: typed, clicked a tile, changed a slide.
        const entry = { role: "user", text: msg.text, kind: msg.kind, ts: Date.now() };
        h.transcript.push(entry);
        broadcast(h, { type: "user", ...entry });
        if (h.def.onUser) relay(h, h.def.onUser(h, msg));
      }
    });
    ws.on("close", () => { if (h.host === ws) h.host = null; });
    return;
  }
  if (role === "streamer") return onStreamer(h, ws);
  ws.viewerId = nextViewerId++;
  h.viewers.add(ws);
  ws.send(JSON.stringify({ type: "history", transcript: h.transcript.slice(-50) }));
  for (const m of h.def.snapshot ? h.def.snapshot(h) : []) ws.send(JSON.stringify(m)); // what is on screen now (a pin, a poll)
  ws.send(JSON.stringify({ type: "stream", live: !!h.streamer }));
  broadcast(h, { type: "viewers", count: h.viewers.size });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (onWatcherMessage(h, ws, msg)) return;
    if (msg.type === "vote") { if (h.def.onVote) h.def.onVote(h, String(msg.name || "viewer").slice(0, 24), Number(msg.option), (m) => broadcast(h, m)); return; }
    if (msg.type !== "chat") return;
    const text = String(msg.text || "").slice(0, 300).trim();
    const name = String(msg.name || "viewer").slice(0, 24);
    if (!text) return;
    const entry = { role: "viewer", name, text, ts: Date.now() };
    h.transcript.push(entry);
    broadcast(h, { type: "chat", ...entry });
    if (h.def.onViewerChat) relay(h, h.def.onViewerChat(h, entry));
  });
  ws.on("close", () => { onWatcherClose(h, ws); h.viewers.delete(ws); broadcast(h, { type: "viewers", count: h.viewers.size }); });
});

setInterval(() => { for (const h of hubs.values()) if (h.session && h.def.tick) relay(h, h.def.tick(h, (m) => broadcast(h, m))); }, 5000);

// Ctrl-C locally, SIGTERM from Kubernetes on a rollout: end the live sessions first.
export async function shutdown() {
  for (const h of hubs.values()) await endSession(h).catch(() => {});
}
// Run on its own (`node server.js`) it listens and handles the signals itself;
// the site's server (server/index.ts) mounts the same app and WebSocket beside
// the mini-apps, and its shutdown calls this one.
export { app };
export function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(app);
  server.on("upgrade", handleUpgrade);
  server.listen(PORT, () => console.log(`http://localhost:${PORT}/  (use cases: ${Object.keys(USECASES).join(", ")}; password ${PASSWORD ? "on" : "off"})`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown().then(() => process.exit(0)));
}
