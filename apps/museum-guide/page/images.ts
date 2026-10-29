// Each work's picture, from exhibits/<id>.webp (public-domain images, 900 px).
import type { Exhibit } from '../engine/catalogue.ts';

export const exhibitImage = (e: Exhibit) => new URL(`../exhibits/${e.id}.webp`, import.meta.url).href;
