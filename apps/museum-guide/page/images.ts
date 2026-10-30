// Each work's picture, from exhibits/<id>.webp (public-domain images, 900 px).
import type { Exhibit } from '../engine/catalogue.ts';

export const exhibitImage = (e: Exhibit) => new URL(`../exhibits/${e.id}.webp`, import.meta.url).href;

/** A guest's portrait (host/guests/<id>.jpg), shown while they are on the way. */
export const guestImage = (id: string) => new URL(`../host/guests/${id}.jpg`, import.meta.url).href;
