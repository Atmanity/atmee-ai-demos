// The QR code on a work's label. It is a link to the tour opened at that work
// (`/apps/museum-guide/?exhibit=<id>`), so a phone's own camera app opens the
// tour there, and the tour's scanner reads the same code as "you are at this work".
import { exhibitById, type Exhibit } from './catalogue.ts';

export const TOUR_PATH = '/apps/museum-guide/';

/** The link a work's label carries. */
export function labelUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, '')}${TOUR_PATH}?exhibit=${encodeURIComponent(id)}`;
}

/**
 * The work a scanned code names, or null: a label link (from any host, since
 * a printed sheet outlives the server it was printed from) or `meridian:<id>`.
 * Anything else (a ticket, a poster's link) is not a label.
 */
export function parseLabel(text: string): Exhibit | null {
  const raw = text.trim();
  const short = /^meridian:([a-z0-9-]+)$/i.exec(raw);
  if (short) return exhibitById(short[1].toLowerCase());
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !url.pathname.replace(/\/?$/, '/').endsWith(TOUR_PATH)) return null;
  return exhibitById(url.searchParams.get('exhibit'));
}
