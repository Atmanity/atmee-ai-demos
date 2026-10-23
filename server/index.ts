// The server for every app, on one port. It runs the mini-apps (their
// sessions, their own routes, their pages: through Vite in development, from
// dist/ in production) and mounts the five apps' server.js in the same
// process: their pages, /api routes and WebSocket. server.js's home page lists
// all of them.
//
//   npm run dev        http://localhost:5190/
//
// Env (.env): ATMEE_API_KEY (one key, the account of every app's avatar),
// ATMEE_BASE_URL, GEMINI_API_KEY, the five apps' AVATAR_*; SITE_PORT (5190),
// HOST (127.0.0.1; 0.0.0.0 when deployed), DEMO_PASSWORD (deployed: one
// password for every app).
import { createServer } from 'node:http';
import express from 'express';
import { app as fiveApps, handleUpgrade, requirePassword } from '../server.js';
import { api } from './api.ts';
import { isMiniAppPath } from './site.ts';

// Its own variable: PORT is what server.js reads when it runs on its own (3333).
const PORT = Number(process.env.SITE_PORT || 5190);
const HOST = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const local = HOST === '127.0.0.1' || HOST === 'localhost';
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return null; } };

const miniapps = express.Router();
if (local) {
  // On this machine: only its own pages (the session routes spend the key's credits).
  const own = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  miniapps.use((req, res, next) => {
    const host = String(req.headers.host).toLowerCase();
    const origin = req.headers.origin;
    if (!own.includes(host) || (origin && !own.some((o) => origin === `http://${o}`))) return void res.status(403).json({ error: 'forbidden' });
    next();
  });
} else {
  // Deployed: the five apps' own password gate (one sign-in for every app), and same-origin calls only.
  miniapps.use(requirePassword);
  miniapps.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && hostOf(origin) !== req.headers.host) return void res.status(403).json({ error: 'forbidden' });
    next();
  });
}
miniapps.use('/api', express.json({ limit: '8mb' }), api);
if (production) {
  miniapps.use(express.static('dist', { extensions: ['html'] }));
} else {
  const { createServer: createVite } = await import('vite');
  // HMR=0: no reloads pushed to open pages (a live session survives edits elsewhere).
  const vite = await createVite({ server: { middlewareMode: true, hmr: process.env.HMR !== '0' }, appType: 'mpa' });
  miniapps.use(vite.middlewares);
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => (isMiniAppPath(req.path, production) ? miniapps(req, res, next) : fiveApps(req, res, next)));

const server = createServer(app);
server.on('upgrade', handleUpgrade);
server.listen(PORT, HOST, () => console.log(`http://localhost:${PORT}/  (every app: the five and the fourteen)`));
