// Requisition's server side. The stores have no secrets (the whole ledger is on
// the visitor's screen), so the ledger, the rules and every slip run in the
// page (engine/*), which answers Hester's tool calls itself. The server only
// declares those tools for the session.
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';

const app: AppServer = {
  id: 'supply-window',
  title: 'Requisition',
  tagline: 'Silo 18\'s supply window: ask Hester for what you need, and leave with a stamped slip or a reason why not.',
  brand: { color: '#2b3330', ink: '#f2e7c9' },
  maxSeconds: 600,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
};

export default app;
