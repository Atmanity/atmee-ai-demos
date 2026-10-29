// Signing a Spotify Premium listener in, for the Web Playback SDK: the
// authorization-code flow with PKCE, all in the page (no secret). The token
// is the listener's own, kept in this browser only.
const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state'];
const KEY = 'crate:spotify';
const VERIFIER = 'crate:spotify-verifier';

interface Token { access: string; refresh: string; until: number }

// Storage can throw (private windows, blocked site data): the booth then plays the embed.
const read = (store: Storage, key: string) => { try { return store.getItem(key); } catch { return null; } };
const write = (store: Storage, key: string, value: string | null) => {
  try { if (value === null) store.removeItem(key); else store.setItem(key, value); } catch { /* not kept */ }
};

/** Where Spotify sends the listener back: this page, which must be a Redirect URI of the Spotify app. */
export const redirectUri = () => `${location.origin}${location.pathname}`;

export function authorizeUrl(clientId: string, redirect: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirect,
    code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES.join(' '),
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function challengeOf(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Off to Spotify's consent page; back on this page with ?code=. */
export async function connect(clientId: string): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  write(sessionStorage, VERIFIER, verifier);
  location.assign(authorizeUrl(clientId, redirectUri(), await challengeOf(verifier)));
}

async function tokenRequest(body: Record<string, string>): Promise<Token> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`spotify token ${res.status}`);
  const json = await res.json();
  const token = { access: json.access_token, refresh: json.refresh_token ?? body.refresh_token, until: Date.now() + (Number(json.expires_in) - 60) * 1000 };
  write(localStorage, KEY, JSON.stringify(token));
  return token;
}

/** The code Spotify sent back, traded for a token; the URL is cleaned either way. False when there was none or it failed. */
export async function finishConnect(clientId: string): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code && !params.get('error')) return false;
  history.replaceState(null, '', redirectUri());
  const verifier = read(sessionStorage, VERIFIER);
  write(sessionStorage, VERIFIER, null);
  if (!code || !verifier) return false;
  try {
    await tokenRequest({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
    return true;
  } catch (err) {
    console.warn('[crate] spotify sign-in failed', err);
    return false;
  }
}

export const connected = () => Boolean(read(localStorage, KEY));
export const disconnect = () => write(localStorage, KEY, null);

/** A live access token, refreshed when it has run out. */
export async function accessToken(clientId: string): Promise<string> {
  const saved = read(localStorage, KEY);
  if (!saved) throw new Error('not connected to Spotify');
  const token: Token = JSON.parse(saved);
  if (Date.now() < token.until) return token.access;
  return (await tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: token.refresh })).access;
}
