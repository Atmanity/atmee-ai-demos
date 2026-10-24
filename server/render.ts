// The avatar-only way: the avatar is rendered into the app's OWN LiveKit room,
// as the face of the app's own agent. The app holds its own LiveKit project
// (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) and mints both tokens
// here: one for its agent, one for the avatar, which publishes on the agent's
// behalf. The Avatar API is only told where to render
// (POST /v1/avatars/{id}/avatar_sessions); it never sees the secret.
//
// In these sample apps the agent is the visitor's page: it joins as the agent,
// streams its audio to the avatar (16 kHz PCM on lk.audio_stream) and plays the
// avatar's synced video and voice. A LiveKit Agents worker does the same with
// livekit-plugins-atmee.
import { randomUUID } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { avatarApi } from './atmee.ts';

const URL = process.env.LIVEKIT_URL;
const KEY = process.env.LIVEKIT_API_KEY;
const SECRET = process.env.LIVEKIT_API_SECRET;

/** The avatar's participant identity in the room (the one livekit-plugins-atmee uses). */
export const AVATAR_IDENTITY = 'atmee-avatar-agent';

export const renderConfigured = () => Boolean(URL && KEY && SECRET);

export interface StartedRender {
  sessionId: string;
  serverUrl: string;
  /** The page's token: it joins as the agent. */
  token: string;
  agentIdentity: string;
  avatarIdentity: string;
  maxSeconds: number;
}

export async function startRender(avatarId: string, maxSeconds: number, metadata: Record<string, unknown>) {
  const room = `atmee-demos-${randomUUID()}`;
  const agentIdentity = `agent-${randomUUID().slice(0, 8)}`;
  // Both outlive the session a little: the page reconnects after a network blip with the same token.
  const ttl = maxSeconds + 600;

  // The agent: sends its audio as a data stream and answers the avatar's RPCs, publishes no track of
  // its own (the avatar publishes the voice, in sync with the face), and watches the avatar.
  const agent = new AccessToken(KEY, SECRET, { identity: agentIdentity, name: 'Agent', ttl });
  agent.addGrant({ room, roomJoin: true, canPublish: false, canPublishData: true, canSubscribe: true });

  // The avatar: an agent participant that publishes on behalf of ours.
  const avatar = new AccessToken(KEY, SECRET, { identity: AVATAR_IDENTITY, name: 'Avatar', ttl, attributes: { 'lk.publish_on_behalf': agentIdentity } });
  avatar.kind = 'agent';
  avatar.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true });

  const r = await avatarApi('POST', `/v1/avatars/${avatarId}/avatar_sessions`, {
    livekitUrl: URL, livekitToken: await avatar.toJwt(), agentIdentity, maxDurationSeconds: maxSeconds, metadata,
  });
  if (r.status !== 202 && r.status !== 201) return { ok: false as const, ...r };
  const render: StartedRender = {
    sessionId: r.json.sessionId, serverUrl: URL!, token: await agent.toJwt(), agentIdentity, avatarIdentity: AVATAR_IDENTITY,
    maxSeconds: r.json.maxDurationSeconds ?? maxSeconds,
  };
  return { ok: true as const, render };
}

// Ending twice is safe (alreadyEnded), so 503 and 500 finalize_failed are retried.
export async function endRender(sessionId: string) {
  for (let attempt = 1; ; attempt++) {
    const r = await avatarApi('POST', `/v1/avatar_sessions/${sessionId}/end`);
    if ((r.status === 503 || r.status === 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(r.retryAfter || 2, 10) * 1000));
      continue;
    }
    return r;
  }
}
