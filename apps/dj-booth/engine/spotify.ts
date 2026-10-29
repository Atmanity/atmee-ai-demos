// Spotify's Web API, as the booth uses it: track search only, signed in as the
// app (client credentials), so no listener ever logs in to search. The
// secret stays in this process; the page gets tracks, never the token.
import type { Track } from './types.ts';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The search response's tracks, as the booth shows and plays them. */
export function tracksFrom(json: any): Track[] {
  const items: any[] = json?.tracks?.items ?? [];
  return items.filter((t) => t && typeof t.id === 'string' && t.name).map((t) => ({
    id: t.id,
    title: String(t.name),
    artist: (t.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', ') || 'Unknown artist',
    album: String(t.album?.name ?? ''),
    year: String(t.album?.release_date ?? '').slice(0, 4),
    durationMs: Number(t.duration_ms) || 0,
    art: t.album?.images?.at(-2)?.url ?? t.album?.images?.[0]?.url ?? null,
  }));
}

export class Spotify {
  private token: { value: string; until: number } | null = null;

  constructor(private clientId = '', private clientSecret = '', private fetchFn: Fetch = fetch) {}

  get configured() { return Boolean(this.clientId && this.clientSecret); }

  private async bearer(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    const res = await this.fetchFn('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`spotify token ${res.status}`);
    const json: any = await res.json();
    // A minute early, so a token never runs out mid-request.
    this.token = { value: json.access_token, until: Date.now() + (Number(json.expires_in) - 60) * 1000 };
    return this.token.value;
  }

  async search(query: string, limit = 8): Promise<Track[]> {
    const url = `https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`;
    let res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.bearer()}` } });
    if (res.status === 401) {
      // Revoked or expired early: one fresh token, once.
      this.token = null;
      res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.bearer()}` } });
    }
    if (!res.ok) throw new Error(`spotify search ${res.status}`);
    return tracksFrom(await res.json());
  }
}
