// Rendering the demo clip, on the app's server.
//
// Ported from the original `video.py`: xAI generations -> poll -> download the
// mp4 -> store it -> publish a URL the page can play. Here the clip is kept by
// this app's own server and served from its own route, so the page plays a
// same-origin URL and the provider's URL never reaches it.
//
// Degrading is deliberate and total. `XAI_API_KEY` is not guaranteed anywhere,
// and a coaching session without a demo clip is still a coaching session: with
// no key, `available()` is false, nothing is called, and the coach says plainly
// that demos are off. Nothing in here throws into a session.
//
// The original's DemoNarrator (holding, claiming and re-arming the spoken
// "your demo is up" line across task handovers) is gone: a status change is an
// outcome, and the app sends it to the avatar as an event.
import type { VideoPayload } from './types.ts';

export const XAI_GENERATIONS_URL = 'https://api.x.ai/v1/videos/generations';
export const XAI_VIDEO_URL = 'https://api.x.ai/v1/videos';
export const DEFAULT_MODEL = 'grok-imagine-video';
export const ALLOWED_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
export const ALLOWED_RESOLUTIONS = new Set(['480p', '720p']);

/** grok-imagine-video takes 90-180 s with reference images: a 2 s poll, up to four minutes. */
export const POLL_INTERVAL_MS = 2_000;
export const MAX_POLL_ATTEMPTS = 120;
/**
 * Per-HTTP-call ceiling. The original declared it and passed it to nothing, so
 * a provider that accepted a connection and went quiet held the board on
 * "rendering" for five minutes an attempt, with nothing in the log.
 */
export const REQUEST_TIMEOUT_MS = 90_000;

type Env = Record<string, string | undefined>;

/** Read at call time, not import time: a module-scope read makes an absent key permanent. */
export const apiKey = (env: Env = process.env) => (env.XAI_API_KEY ?? '').trim();
export const videoModel = (env: Env = process.env) => (env.XAI_VIDEO_MODEL ?? '').trim() || DEFAULT_MODEL;

/**
 * Whether xAI could fetch this reference image. It fetches from its own
 * network, so a localhost or tailnet address fails the whole generation with
 * an error that reads like a bad prompt.
 */
export function isUsableReferenceUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) return false;
  if (host.endsWith('.ts.net') || host.endsWith('.svc.cluster.local')) return false;
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** Reference images for the trainer's look, if an operator configured any (comma-separated). */
export function referenceImageUrls(env: Env = process.env): string[] {
  return (env.FITNESS_VIDEO_REFERENCE_IMAGE_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u && isUsableReferenceUrl(u));
}

export const normalizeAspectRatio = (value: unknown) => {
  const raw = String(value ?? '').trim();
  return ALLOWED_ASPECT_RATIOS.has(raw) ? raw : '9:16';
};

export const normalizeResolution = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase();
  return ALLOWED_RESOLUTIONS.has(raw) ? raw : '480p';
};

/** Seconds, inside what the provider accepts: 15, or 10 with reference images (a rejected generation, not a shorter clip). */
export function clampDuration(value: unknown, hasReferences: boolean): number {
  const ceiling = hasReferences ? 10 : 15;
  const parsed = typeof value === 'number' ? Math.trunc(value) : typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? parseInt(value, 10) : NaN;
  const seconds = Number.isFinite(parsed) ? parsed : 6;
  return Math.max(1, Math.min(ceiling, seconds));
}

export interface GenerationRequest {
  prompt: string;
  duration?: unknown;
  aspectRatio?: string;
  resolution?: string;
  references?: string[];
  model?: string;
}

/** The body xAI is sent. `reference_images` is omitted when empty: the provider treats its presence as a mode. */
export function buildGenerationRequest({ prompt, duration = 6, aspectRatio = '9:16', resolution = '480p', references = [], model }: GenerationRequest) {
  const body: Record<string, unknown> = {
    model: model || videoModel(),
    prompt: prompt.trim(),
    duration: clampDuration(duration, references.length > 0),
    aspect_ratio: normalizeAspectRatio(aspectRatio),
    resolution: normalizeResolution(resolution),
  };
  if (references.length) body.reference_images = references.map((url) => ({ url }));
  return body;
}

/**
 * A poll response as [status, url]. Anything unrecognised is `pending`: the
 * loop has its own timeout, and treating a surprise as failure would abandon
 * a clip that was about to arrive.
 */
export function readPoll(data: unknown): [string, string | null] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ['pending', null];
  const body = data as Record<string, unknown>;
  const status = String(body.status || 'pending');
  const video = body.video;
  const url = typeof video === 'object' && video !== null && (video as Record<string, unknown>).url
    ? String((video as Record<string, unknown>).url)
    : null;
  return [status, url];
}

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

export interface RendererOptions {
  /** Keeps the clip and returns the URL the page plays it from. */
  store: (bytes: Uint8Array, contentType: string) => Promise<string> | string;
  /** Every status after the first (the first is returned by `start`). */
  onStatus?: (payload: VideoPayload) => void;
  /**
   * Asked before EVERY publish, and again after it: "may a clip be shown at
   * all right now?". A safety hold stops the render, but a clip can land in
   * the gap; the last word belongs here.
   */
  suppressed?: () => boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  env?: Env;
  newId?: () => string;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

const log = (message: string, ...args: unknown[]) => console.warn(`[fitness-coach] [Video] ${message}`, ...args);

/**
 * Renders one demo clip at a time. Only the newest request matters: naming a
 * second move while the first renders must not end with the first clip on
 * screen, so a superseded request publishes nothing and stops polling.
 */
export class DemoRenderer {
  private seq = 0;
  private controller: AbortController | null = null;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly env: Env;

  constructor(private readonly opts: RendererOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.env = opts.env ?? process.env;
  }

  /** Whether a clip could be rendered at all, answerable without waiting: a missing key is knowable up front. */
  available(): boolean {
    return Boolean(apiKey(this.env));
  }

  /**
   * Start a render without making the caller wait (the caller answers a tap or
   * a line). Returns the first status at once: `generating`, or `unavailable`
   * with no key. Later statuses go to `onStatus`.
   */
  start(request: { prompt: string; duration?: number }): VideoPayload {
    this.controller?.abort();
    const seq = ++this.seq;
    const id = this.opts.newId?.() ?? crypto.randomUUID();
    const prompt = request.prompt.trim();
    const key = apiKey(this.env);
    if (!key) {
      // A normal state for a local run or an environment that never bought one.
      return { status: 'unavailable', request_id: id, prompt, message: 'Video demos are not switched on for this session.' };
    }
    const controller = new AbortController();
    this.controller = controller;
    void this.pipeline(seq, id, prompt, key, request.duration ?? 6, controller.signal).catch((err) => {
      // A failed clip must never end a session.
      if (!controller.signal.aborted) log('render failed: %s', (err as Error).message);
    });
    return { status: 'generating', request_id: id, prompt };
  }

  /** Abandon whatever is rendering: nothing it produces will be published. */
  stop(): void {
    this.seq += 1;
    this.controller?.abort();
    this.controller = null;
  }

  private isSuppressed(): boolean {
    try {
      return Boolean(this.opts.suppressed?.());
    } catch {
      // A broken predicate must not decide a safety question by accident.
      return true;
    }
  }

  /** Publish unless a newer request has taken over or clips are suppressed. */
  private publish(seq: number, payload: VideoPayload): void {
    if (seq !== this.seq) return;
    if (this.isSuppressed()) {
      // Neither shown nor announced: a clip commissioned before a safety
      // disclosure is still a workout demo for someone the app just refused.
      log('dropping %s; clips are suppressed', payload.status);
      return;
    }
    this.opts.onStatus?.(payload);
  }

  private call(url: string, init: RequestInit, signal: AbortSignal) {
    return this.fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
  }

  private async pipeline(seq: number, id: string, prompt: string, key: string, duration: number, signal: AbortSignal) {
    const fail = (message: string) => this.publish(seq, { status: 'error', request_id: id, prompt, message });
    if (!prompt) return;
    const body = buildGenerationRequest({ prompt, duration, references: referenceImageUrls(this.env), model: videoModel(this.env) });
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

    const providerId = await this.create(body, headers, signal);
    if (signal.aborted) return;
    if (!providerId) return fail('Could not start the demo render. Try a simpler move.');

    const url = await this.poll(providerId, headers, signal);
    if (signal.aborted) return;
    if (!url) return fail('The demo did not finish rendering in time.');

    const stored = await this.download(url, signal);
    if (signal.aborted) return;
    if (!stored) return fail('The demo rendered but could not be saved.');
    this.publish(seq, { status: 'ready', request_id: id, prompt, video_url: stored });
  }

  private async create(body: Record<string, unknown>, headers: Record<string, string>, signal: AbortSignal): Promise<string | null> {
    let text: string;
    try {
      const res = await this.call(XAI_GENERATIONS_URL, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
      text = await res.text();
      if (![200, 201, 202].includes(res.status)) {
        log('generation refused (%d): %s', res.status, text.slice(0, 200));
        return null;
      }
    } catch (err) {
      log('could not reach the provider: %s', (err as Error).message);
      return null;
    }
    const providerId = String((parseBody(text) as Record<string, unknown>)?.request_id ?? '').trim();
    if (!providerId) log('generation response carried no request_id');
    return providerId || null;
  }

  private async poll(providerId: string, headers: Record<string, string>, signal: AbortSignal): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await this.sleep(POLL_INTERVAL_MS, signal);
      if (signal.aborted) return null;
      let text: string;
      try {
        const res = await this.call(`${XAI_VIDEO_URL}/${providerId}`, { method: 'GET', headers }, signal);
        text = await res.text();
        // 429s and 5xxs are transient: keep waiting rather than throw away a clip that is coming.
        if (res.status !== 200) continue;
      } catch {
        if (signal.aborted) return null;
        continue;
      }
      const [status, url] = readPoll(parseBody(text));
      if (status === 'done' && url) return url;
      if (status === 'failed' || status === 'expired') {
        log('provider reported %s', status);
        return null;
      }
    }
    log('gave up after %d polls', MAX_POLL_ATTEMPTS);
    return null;
  }

  /** Download the clip and keep it where the page can play it (never the provider's URL). */
  private async download(providerUrl: string, signal: AbortSignal): Promise<string | null> {
    let bytes: Uint8Array;
    try {
      const res = await this.call(providerUrl, { method: 'GET' }, signal);
      if (res.status !== 200) {
        log('clip download returned %d', res.status);
        return null;
      }
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      log('clip download failed: %s', (err as Error).message);
      return null;
    }
    try {
      return await this.opts.store(bytes, 'video/mp4');
    } catch (err) {
      log('could not store the clip: %s', (err as Error).message);
      return null;
    }
  }
}
