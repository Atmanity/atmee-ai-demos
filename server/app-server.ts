// What an app gives the server: its id, how it is built, the agenda its avatar
// runs (if any), and its own routes under /api/apps/<id>/ (model calls, data, media).
import type { Router } from 'express';
import type { SpeechSettings } from './speech-sessions.ts';

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
   * `speech-to-speech`: Atmee's realtime speech hears and answers over a WebSocket
   * (POST /v1/speech_sessions); the face, if any, is an avatar-only render of that voice.
   */
  way?: 'full-stack' | 'avatar-only' | 'speech-to-speech';
  /**
   * The app also renders its avatar into the site's own LiveKit room on demand (POST
   * /api/apps/<id>/render), as the face of a voice it gets elsewhere (a speech session).
   */
  rendersFace?: boolean;
  /**
   * A speech-to-speech app whose page holds the call with the speech kit (src/speech/): the
   * settings its server pins for each one, which the page cannot change, and the conversation's
   * language. The site's /api/apps/<id>/speech routes reserve and end its calls; the voice is
   * always the avatar's. An app that reserves its own sessions in its routes leaves it out.
   */
  speech?: { language?: string; settings: () => SpeechSettings };
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
  /** Ends whatever the app's own routes started that still bills (on shutdown, before the process exits). */
  shutdown?: () => Promise<unknown>;
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
