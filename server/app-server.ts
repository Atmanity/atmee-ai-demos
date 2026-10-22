// What an app gives the server: its id, the agenda its avatar runs (if any),
// and its own routes under /api/apps/<id>/ (model calls, data, media).
import type { Router } from 'express';

export interface AppServer {
  id: string;
  title: string;
  tagline: string;
  /** A conductor graph, or null to make sure the avatar runs none. */
  conductor?: { graph: unknown; speakAfterS?: number } | null;
  /** Longest session to ask for. */
  maxSeconds?: number;
  routes?: (router: Router) => void;
}
