// The speech-to-speech way: the app's own conversation on Atmee's realtime
// voice. This server reserves each call (POST /v1/speech_sessions) with the
// avatar, whose voice it speaks in, and the settings the app pins: the
// instructions, the character, the tools. The speech server applies them
// over whatever the page sends and refuses a page that tries to change one.
// The page gets only the WebSocket address and a token for one connection
// within a minute; the API key never leaves this process.
import { avatarApi } from './atmee.ts';

/** One function the model may call; the page runs it (OpenAI's function-tool shape). */
export interface SpeechTool { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }

/** The `session.start` fields a server may pin for a session (SpeechSessionPinnedSettings). */
export interface SpeechSettings {
  instructions?: string;
  persona?: string;
  facts?: string;
  scenario?: string;
  agenda?: string;
  directive?: string;
  avatar_name?: string;
  user_name?: string;
  self_introduction?: string;
  input?: { role: 'user' | 'assistant' | 'developer'; content: { type: 'input_text' | 'output_text'; text: string }[] }[];
  delegation?: {
    type: 'responses';
    responses?: { instructions?: string; tools?: SpeechTool[]; tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string } };
  };
  avatar_timezone?: string;
  user_timezone?: string;
}

/** What the page needs to connect, and nothing else. */
export interface StartedSpeech { sessionId: string; url: string; token: string; tokenExpiresAt: string; maxSeconds: number }

/** The API takes 60 s to an hour. */
export const speechSeconds = (seconds: number) => Math.min(3600, Math.max(60, Math.round(seconds)));

export async function startSpeechSession(avatarId: string, maxSeconds: number, settings?: SpeechSettings, language?: string) {
  const r = await avatarApi('POST', '/v1/speech_sessions', {
    avatarId, maxDurationSeconds: speechSeconds(maxSeconds), ...(language ? { language } : {}), ...(settings ? { settings } : {}),
  });
  if (r.status !== 201) return { ok: false as const, ...r };
  const { sessionId, url, token, tokenExpiresAt, actualDurationSeconds } = r.json;
  const session: StartedSpeech = { sessionId, url, token, tokenExpiresAt, maxSeconds: actualDurationSeconds ?? speechSeconds(maxSeconds) };
  return { ok: true as const, session };
}

/** The session's state, and once it ended why and what it cost; never its token. */
export async function readSpeechSession(sessionId: string) {
  const r = await avatarApi('GET', `/v1/speech_sessions/${sessionId}`);
  const { status, endReason, failureCode, connectedAt, endedAt, endRequestedAt, endsAt, billedSeconds, chargedMicrocredits } = r.json ?? {};
  return { status: r.status, json: { status, endReason, failureCode, connectedAt, endedAt, endRequestedAt, endsAt, billedSeconds, chargedMicrocredits } };
}

// Ending twice is safe (alreadyEnded), so 503 and 500 finalize_failed are retried.
// With the page's connection open it is recorded and settles as that connection closes.
export async function endSpeechSession(sessionId: string) {
  for (let attempt = 1; ; attempt++) {
    const r = await avatarApi('POST', `/v1/speech_sessions/${sessionId}/end`);
    if ((r.status === 503 || r.status === 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(r.retryAfter || 2, 10) * 1000));
      continue;
    }
    return r;
  }
}
