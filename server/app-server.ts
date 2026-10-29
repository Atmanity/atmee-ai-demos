// What an app gives the server: its id, how it is built, the agenda its avatar
// runs (if any), and its own routes under /api/apps/<id>/ (model calls, data, media).
import type { Router } from 'express';

export interface AppServer {
  id: string;
  title: string;
  tagline: string;
  /** The product's brand colour and the ink that reads on it, for the index page. */
  brand?: { color: string; ink: string };
  /**
   * How the app uses the avatar. `full-stack` (default): Atmee runs the whole conversation
   * (POST /v1/session). `avatar-only`: the app's own agent speaks and the avatar is its face,
   * rendered into the app's own LiveKit room (POST /v1/avatars/{id}/avatar_sessions).
   */
  way?: 'full-stack' | 'avatar-only';
  /**
   * The app also renders its avatar into the site's own LiveKit room on demand (POST
   * /api/apps/<id>/render), as the face of a voice it gets elsewhere (a speech session).
   */
  rendersFace?: boolean;
  /** A conductor graph, or null to make sure the avatar runs none. */
  conductor?: { graph: unknown; speakAfterS?: number } | null;
  /** Longest session to ask for. */
  maxSeconds?: number;
  /**
   * Functions the avatar may call in a session (POST /v1/session `appTools`):
   * each call reaches the page as the `atmee.tool` RPC (useAvatar's onToolCall).
   * Only sessions running on Causeur call them.
   */
  appTools?: AppTools;
  routes?: (router: Router) => void;
}

/** One function tool in the OpenAI function-tool shape, plus how its calls are delivered. */
export interface AppTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** `notify` (default): the avatar goes on. `await`: it waits up to timeoutSeconds (1 to 28, default 8) for the page's answer. */
  'x-atmee'?: { mode?: 'notify' | 'await'; timeoutSeconds?: number };
}

export interface AppTools { instructions?: string; tools: AppTool[] }
