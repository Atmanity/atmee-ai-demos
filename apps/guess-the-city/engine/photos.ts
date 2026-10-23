// The postcards' photos: each behind an opaque token (the page never sees the
// source, which would name the city), with its bytes fetched once and kept a
// while. A round's photo is fetched before the round starts, so it is on the
// card when Marco says it is, not seconds later when the page first asks.
export interface PhotoBytes { type: string; body: Buffer }
export type Fetcher = (url: string) => Promise<Response>;

/** The token in a photo URL the page is given (`/api/apps/<id>/photo/<token>`). */
export const tokenOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

export class PhotoStore {
  private sources = new Map<string, string>();
  private bytes = new Map<string, PhotoBytes>();
  private pending = new Map<string, Promise<PhotoBytes | null>>();

  constructor(private fetcher: Fetcher, private limits = { sources: 600, bytes: 64 }) {}

  add(token: string, source: string) {
    this.sources.set(token, source);
    // The oldest go first: a game 200 decks back loses its photos.
    if (this.sources.size > this.limits.sources) this.sources.delete(this.sources.keys().next().value!);
  }

  /** Known, or still kept: bytes outlive their source's entry. */
  has(token: string) { return this.sources.has(token) || this.bytes.has(token) || this.pending.has(token); }

  /** The photo's bytes, from the cache, a fetch already under way, or a new one; null when it cannot be had. */
  get(token: string): Promise<PhotoBytes | null> {
    const kept = this.bytes.get(token);
    if (kept) return Promise.resolve(kept);
    const pending = this.pending.get(token);
    if (pending) return pending;
    const source = this.sources.get(token);
    if (!source) return Promise.resolve(null);
    const fetching = this.fetch(token, source).finally(() => this.pending.delete(token));
    this.pending.set(token, fetching);
    return fetching;
  }

  private async fetch(token: string, source: string): Promise<PhotoBytes | null> {
    try {
      const res = await this.fetcher(source);
      if (!res.ok) return null;
      const got = { type: res.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await res.arrayBuffer()) };
      this.bytes.set(token, got);
      if (this.bytes.size > this.limits.bytes) this.bytes.delete(this.bytes.keys().next().value!);
      return got;
    } catch {
      return null;
    }
  }
}
