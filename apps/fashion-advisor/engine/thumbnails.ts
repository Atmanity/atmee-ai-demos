// Catalogue shots for the suggestion cards, rendered in the background and
// shared by every session. Ported from the original worker's thumbnail pool:
// three at a time (the image API is rate limited per second), each garment
// paid for once however its name is cased or spaced, one failure never stops
// the rest, and no image model means no thumbnails rather than broken cards.
//
// The original pushed each finished shot to the panel and also wrote it into
// the stored analysis, because data packets were not replayed when the panel
// remounted. Here the view is built from this rack every time the page asks
// (it polls while `pending` is above zero), so a finished shot is never lost.
import type { Img } from './types.ts';

export const THUMBNAIL_CONCURRENCY = 3;

export const thumbnailKey = (item: string) => item.trim().toLowerCase();

export class ThumbnailRack {
  private ready = new Map<string, Img>();
  private rendering = new Set<string>();
  private failed = new Set<string>();
  private waiting: string[] = [];
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private render: (item: string) => Promise<Img | null>,
    private opts: { enabled: boolean; urlFor: (key: string) => string; concurrency?: number; max?: number },
  ) {}

  /** Start rendering the items that have no shot yet (and are not already rendering or failed). */
  ensure(items: string[]): void {
    if (!this.opts.enabled) return;
    for (const item of items) {
      const key = thumbnailKey(item);
      if (!key || this.ready.has(key) || this.rendering.has(key) || this.failed.has(key)) continue;
      this.rendering.add(key);
      this.waiting.push(item.trim());
    }
    this.pump();
  }

  url(key: string): string | undefined {
    return this.ready.has(key) ? this.opts.urlFor(key) : undefined;
  }

  image(key: string): Img | undefined {
    return this.ready.get(key);
  }

  pending(items: string[]): number {
    return items.filter((item) => this.rendering.has(thumbnailKey(item))).length;
  }

  /** Resolves once nothing is rendering. */
  idle(): Promise<void> {
    if (!this.active && !this.waiting.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump() {
    const limit = this.opts.concurrency ?? THUMBNAIL_CONCURRENCY;
    while (this.active < limit && this.waiting.length) {
      const item = this.waiting.shift()!;
      this.active += 1;
      void this.renderOne(item).finally(() => {
        this.active -= 1;
        this.pump();
        if (!this.active && !this.waiting.length) this.idleWaiters.splice(0).forEach((resolve) => resolve());
      });
    }
  }

  private async renderOne(item: string) {
    const key = thumbnailKey(item);
    try {
      const img = await this.render(item);
      if (!img) {
        this.failed.add(key);
        return;
      }
      this.ready.set(key, img);
      const max = this.opts.max ?? 96;
      while (this.ready.size > max) this.ready.delete(this.ready.keys().next().value!);
    } catch (err) {
      console.warn('[fashion-advisor] thumbnail failed for %s: %s', item, (err as Error).message);
      this.failed.add(key);
    } finally {
      this.rendering.delete(key);
    }
  }
}
