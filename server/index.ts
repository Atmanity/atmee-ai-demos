// The server: holds the Avatar API key, starts and ends each app's sessions,
// runs the apps' own server routes (their LLM calls, data, media), and serves
// the pages (through Vite in development, from dist/ in production).
//
//   npm run dev        http://localhost:5190/
//
// Env (.env): ATMEE_API_KEY, ATMEE_BASE_URL, AVATAR_DEFAULT or AVATAR_<APP>,
// GEMINI_API_KEY for apps that interpret speech or images with a model.
import express from 'express';
import { api } from './api.ts';

const PORT = Number(process.env.PORT || 5190);
const production = process.env.NODE_ENV === 'production';

// Only this machine's own pages: the session routes spend the key's credits.
const own = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const app = express();
app.use((req, res, next) => {
  const host = String(req.headers.host).toLowerCase();
  const origin = req.headers.origin;
  if (!own.includes(host) || (origin && !own.some((o) => origin === `http://${o}`))) return void res.status(403).json({ error: 'forbidden' });
  next();
});
app.use('/api', express.json({ limit: '8mb' }), api);

if (production) {
  app.use(express.static('dist', { extensions: ['html'] }));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'mpa' });
  app.use(vite.middlewares);
}

app.listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}/`));
