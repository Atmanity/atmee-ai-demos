// The model calls behind the stylist (server side only): Gemini through the
// shared `structured()` for everything that reads (the style read, the body
// zones, the pieces), and xAI's image API for the two things that draw (the
// try-on and the catalogue shots).
//
// Keys come from the environment. GEMINI_API_KEY is the repo's; XAI_API_KEY
// is optional, and without it try-ons and thumbnails are switched off (Emery
// is not given the try-on tools; the rail shows drawn marks and shop links).
// The original could also draw with Gemini's image model
// (FASHION_IMAGE_PROVIDER=gemini), but `server/llm.ts` only asks Gemini for
// JSON text, so that path is not available here (see README).
import { createHash } from 'node:crypto';
import { structured } from '../../server/llm.ts';
import {
  ANALYSIS_SCHEMA, analysisFrom, analysisPrompt, isTransientError, retryTransient, SUGGESTIONS_SCHEMA, suggestionsFrom, suggestionsPrompt,
  suggestionThumbnailPrompt, ZONES_PROMPT, ZONES_SCHEMA, zonesFrom, type RawAnalysis,
} from './engine/prompts.ts';
import type { Models } from './engine/stylist.ts';
import { ALL_BODY_ZONES } from './engine/items.ts';
import type { Img, Zone } from './engine/types.ts';

const SYSTEM = 'You are a sharp but warm personal stylist. Answer only with the requested fields.';
const XAI_TIMEOUT_MS = 90_000;
const THUMBNAIL_MAX_ATTEMPTS = 4;
const TRY_ON_CACHE_MAX = 32;

const b64 = (img: Img) => Buffer.from(img.bytes).toString('base64');

/** The image type from its first bytes (the APIs do not always say). */
export function sniffMime(bytes: Uint8Array, fallback = 'image/jpeg'): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return fallback;
}

export interface FashionModels extends Models {
  renderThumbnail(item: string): Promise<Img | null>;
}

export function createModels(env: NodeJS.ProcessEnv = process.env): FashionModels {
  const xaiKey = (env.XAI_API_KEY || '').trim();
  const provider = (env.FASHION_IMAGE_PROVIDER || '').trim().toLowerCase();
  const imageModel = (env.FASHION_IMAGE_MODEL || '').trim() || 'grok-imagine-image';
  if (provider === 'gemini') console.warn('[fashion-advisor] FASHION_IMAGE_PROVIDER=gemini is not supported in this port (server/llm.ts returns JSON only); try-ons need XAI_API_KEY');
  const tryOnAvailable = Boolean(xaiKey) && provider !== 'gemini';
  const tryOnCache = new Map<string, Img>();

  const onRetry = (label: string) => (attempt: number, err: unknown) => console.warn('[fashion-advisor] %s failed (attempt %d), retrying: %s', label, attempt, (err as Error).message);

  async function xai(path: 'edits' | 'generations', payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const res = await fetch(`https://api.x.ai/v1/images/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xaiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(XAI_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  const decode = (encoded: unknown): Img | null => {
    const text = String(encoded ?? '').trim();
    if (!text) return null;
    const bytes = Uint8Array.from(Buffer.from(text, 'base64'));
    return bytes.length > 100 ? { mime: sniffMime(bytes), bytes } : null;
  };

  return {
    tryOnAvailable,

    async analyze(image, input) {
      try {
        const raw = await retryTransient(
          () => structured<RawAnalysis>({ system: SYSTEM, user: analysisPrompt(input), schema: ANALYSIS_SCHEMA, images: [{ mimeType: image.mime, base64: b64(image) }], temperature: 0 }),
          { onRetry: onRetry('style read') },
        );
        return analysisFrom(raw, input.target);
      } catch (err) {
        console.warn('[fashion-advisor] style read failed: %s', (err as Error).message);
        return null;
      }
    },

    async zones(image) {
      try {
        const raw = await retryTransient(
          () => structured({ system: SYSTEM, user: ZONES_PROMPT, schema: ZONES_SCHEMA, images: [{ mimeType: image.mime, base64: b64(image) }], temperature: 0 }),
          { onRetry: onRetry('body zones') },
        );
        return zonesFrom(raw);
      } catch (err) {
        console.warn('[fashion-advisor] body zones failed: %s', (err as Error).message);
        return new Set<Zone>(ALL_BODY_ZONES);
      }
    },

    async suggest({ image, zones, target, recent }) {
      try {
        const raw = await retryTransient(
          () => structured({ system: SYSTEM, user: suggestionsPrompt({ zones, target, recent }), schema: SUGGESTIONS_SCHEMA, images: image ? [{ mimeType: image.mime, base64: b64(image) }] : [], temperature: 0.8 }),
          { onRetry: onRetry('suggestions') },
        );
        return suggestionsFrom(raw);
      } catch (err) {
        console.warn('[fashion-advisor] suggestions failed: %s', (err as Error).message);
        return [];
      }
    },

    async tryOn(image, prompt) {
      if (!tryOnAvailable) return null;
      // The same image and prompt give the same paid render: double taps and
      // retries of an unchanged look are served from here.
      const key = createHash('sha256').update(image.bytes).update('\0').update(imageModel).update('\0').update(prompt).digest('hex');
      const cached = tryOnCache.get(key);
      if (cached) {
        tryOnCache.delete(key);
        tryOnCache.set(key, cached);
        return cached;
      }
      const payload = { model: imageModel, prompt, image: { type: 'image_url', url: `data:${image.mime};base64,${b64(image)}` }, response_format: 'b64_json' };
      const { status, body } = await retryTransient(async () => {
        const r = await xai('edits', payload);
        if (r.status === 429 || r.status >= 500) throw new Error(`xAI image edit ${r.status}`);
        return r;
      }, { onRetry: onRetry('try-on') });
      if (status !== 200 && status !== 201) throw new Error(`xAI image edit failed (${status}): ${JSON.stringify(body).slice(0, 300)}`);
      const result = decode(body?.data?.[0]?.b64_json);
      if (result) {
        tryOnCache.set(key, result);
        while (tryOnCache.size > TRY_ON_CACHE_MAX) tryOnCache.delete(tryOnCache.keys().next().value!);
      }
      return result;
    },

    async renderThumbnail(item) {
      if (!xaiKey) return null;
      const payload = { model: imageModel, prompt: suggestionThumbnailPrompt(item), n: 1, aspect_ratio: '1:1', response_format: 'b64_json' };
      for (let attempt = 1; attempt <= THUMBNAIL_MAX_ATTEMPTS; attempt++) {
        let r: { status: number; body: any };
        try {
          r = await xai('generations', payload);
        } catch (err) {
          if (attempt < THUMBNAIL_MAX_ATTEMPTS && isTransientError(err)) continue;
          return null;   // a thumbnail never fails a session
        }
        // Rate limited: back off with jitter, so a pool of renders does not retry in lockstep.
        if (r.status === 429 && attempt < THUMBNAIL_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1) + Math.random() * 250));
          continue;
        }
        if (r.status !== 200 && r.status !== 201) return null;
        return decode(r.body?.data?.[0]?.b64_json);
      }
      return null;
    },
  };
}
