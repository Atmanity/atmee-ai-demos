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
//   PORT               default 3333
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { USECASES } from "./usecases/index.js";
import { describeFrame } from "./usecases/observer.js";

const BASE = process.env.ATMEE_BASE_URL || "https://staging.atmanity.us";
const PORT = Number(process.env.PORT || 3333);
const KEY = process.env.ATMEE_API_KEY;
if (!KEY) throw new Error("ATMEE_API_KEY is required");
const headers = { "X-Api-Key": KEY, "Content-Type": "application/json" };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
// A policy returns relay messages for the host page: say (lk.chat) or app (atmee.app).
function relay(h, messages) { for (const m of messages || []) toHost(h, m); }

// The conductor is the avatar's, not the session's: when two use cases share
// one avatar, each start sets its own agenda, or clears the other's.
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
  h.memo = {}; // nothing of this session is shown to whoever connects next
  const r = await api("POST", `/v1/session/${id}/end`);
  console.log(`[${h.name}] end ${id} -> ${r.status}`);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "6mb" }));
app.use(express.static("public"));
app.get("/api/usecases", (_req, res) => res.json(Object.fromEntries(Object.entries(USECASES).map(([k, v]) => [k, { title: v.title, page: v.page, avatarId: process.env[`AVATAR_${k.toUpperCase()}`] || null, conductor: !!v.conductor, tools: v.appTools ? v.appTools.tools.map((t) => t.name) : [] }]))));

app.post("/api/:usecase/session", async (req, res) => {
  const h = hub(req.params.usecase);
  if (!h) return res.status(404).json({ error: "unknown use case" });
  try {
    if (!h.session) await startSession(h);
    const { sessionId, serverUrl, userToken, roomName, maxSeconds } = h.session;
    res.json({ sessionId, serverUrl, userToken, roomName, maxSeconds, avatarId: h.avatarId });
  } catch (err) {
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
// WebSocket: /?usecase=<name>&role=host|viewer
// ---------------------------------------------------------------------------
const server = createServer(app);
const wss = new WebSocketServer({ server });
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
        if (msg.final && h.def.onAvatarSaid) relay(h, h.def.onAvatarSaid(h, msg.text));
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
  h.viewers.add(ws);
  ws.send(JSON.stringify({ type: "history", transcript: h.transcript.slice(-50) }));
  for (const m of h.def.snapshot ? h.def.snapshot(h) : []) ws.send(JSON.stringify(m)); // what is on screen now (a pin, a poll)
  broadcast(h, { type: "viewers", count: h.viewers.size });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
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
  ws.on("close", () => { h.viewers.delete(ws); broadcast(h, { type: "viewers", count: h.viewers.size }); });
});

setInterval(() => { for (const h of hubs.values()) if (h.session && h.def.tick) relay(h, h.def.tick(h, (m) => broadcast(h, m))); }, 5000);

process.on("SIGINT", async () => { for (const h of hubs.values()) await endSession(h).catch(() => {}); process.exit(0); });
server.listen(PORT, () => console.log(`http://localhost:${PORT}/  (use cases: ${Object.keys(USECASES).join(", ")})`));
