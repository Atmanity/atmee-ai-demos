// The Avatar API, as the server uses it: the key never leaves this process.
const BASE = process.env.ATMEE_BASE_URL || 'https://staging.atmanity.us';
const KEY = process.env.ATMEE_API_KEY;
if (!KEY) throw new Error('Set ATMEE_API_KEY (an Avatar API key) in .env');

export interface ApiResult<T = any> { status: number; json: T; retryAfter: number }

export async function avatarApi<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Api-Key': KEY!, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as T, retryAfter: Number(res.headers.get('retry-after')) || 0 };
}

export interface StartedSession { sessionId: string; serverUrl: string; userToken: string; maxSeconds: number | null }

export async function startSession(avatarId: string, maxSeconds: number, metadata: Record<string, unknown>, appTools?: unknown) {
  const r = await avatarApi('POST', '/v1/session', { avatarId, maxDurationSeconds: maxSeconds, metadata, ...(appTools ? { appTools } : {}) });
  if (r.status !== 201) return { ok: false as const, ...r };
  const { sessionId, serverUrl, userToken, actualDurationSeconds } = r.json;
  return { ok: true as const, session: { sessionId, serverUrl, userToken, maxSeconds: actualDurationSeconds ?? null } as StartedSession };
}

// Ending twice is safe, so 503 session_unavailable and 500 finalize_failed are retried.
export async function endSession(sessionId: string) {
  for (let attempt = 1; ; attempt++) {
    const r = await avatarApi('POST', `/v1/session/${sessionId}/end`);
    if ((r.status === 503 || r.status === 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(r.retryAfter || 2, 10) * 1000));
      continue;
    }
    return r;
  }
}

// The conductor belongs to the avatar, not the session: an app that shares
// its avatar with others puts its own agenda back before each session.
export async function setConductor(avatarId: string, graph: unknown | null, speakAfterS?: number) {
  if (graph === null) return avatarApi('DELETE', `/v1/avatars/${avatarId}/conductor`);
  return avatarApi('PUT', `/v1/avatars/${avatarId}/conductor`, { graph, ...(speakAfterS ? { speakAfterS } : {}) });
}
