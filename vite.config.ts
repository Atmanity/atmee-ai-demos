// One multi-page app: the mini-apps' index (apps/index.html) plus apps/<app>/index.html for every app.
// In development the Express server (server/index.ts) runs Vite as middleware,
// so `npm run dev` is one process serving the pages and the /api routes.
import { existsSync, readdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apps = readdirSync('apps').filter((dir) => existsSync(`apps/${dir}/index.html`));

export default defineConfig({
  plugins: [react()],
  // public/ is the five apps' (server.js serves it); nothing of theirs goes into the build.
  publicDir: false,
  // Every page library, bundled when the server starts. A library first met
  // later (one app opened after another) makes Vite rebundle them all, and a
  // page already open then mixes two copies of React: react-chessboard failed
  // with "Cannot read properties of null (reading 'use')" that way.
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'livekit-client', 'chess.js', 'react-chessboard', 'leaflet'],
  },
  build: {
    rollupOptions: {
      input: { home: 'apps/index.html', ...Object.fromEntries(apps.map((app) => [app, `apps/${app}/index.html`])) },
    },
  },
  test: {
    include: ['{src,apps,server}/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
