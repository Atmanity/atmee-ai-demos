// Trailmix's server side: nothing of its own. The trail has no secrets, so it
// runs in the page, which answers Mochi's tools.
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';

const app: AppServer = {
  id: 'learning-trail',
  title: 'Trailmix',
  tagline: 'Every subject is an expedition: walk the Volcano Trail with Mochi the red panda.',
  brand: { color: '#2a9d9c', ink: '#fdf3dc' },
  maxSeconds: 900,
  conductor: null,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
};

export default app;
