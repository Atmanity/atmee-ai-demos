// One multi-page app: the home page plus apps/<app>/index.html for every app.
// In development the Express server (server/index.ts) runs Vite as middleware,
// so `npm run dev` is one process serving the pages and the /api routes.
import { existsSync, readdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apps = readdirSync('apps').filter((dir) => existsSync(`apps/${dir}/index.html`));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { home: 'index.html', ...Object.fromEntries(apps.map((app) => [app, `apps/${app}/index.html`])) },
    },
  },
  test: {
    include: ['{src,apps,server}/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
