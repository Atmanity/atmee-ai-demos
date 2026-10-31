// One server for every app: the mini-apps answer their own paths, and the five
// apps' server.js (mounted in the same process) answers everything else.

/** Whether a path belongs to the mini-apps (served here) rather than to the five apps (passed on). */
export function isMiniAppPath(path: string, production: boolean): boolean {
  if (path === '/apps' || path.startsWith('/apps/') || path === '/api/apps' || path.startsWith('/api/apps/')) return true;
  // The pages' own files: the build's in production, Vite's while developing.
  if (production) return path.startsWith('/assets/');
  return ['/@vite/', '/@react-refresh', '/@fs/', '/@id/', '/node_modules/', '/src/', '/__vite'].some((p) => path.startsWith(p));
}

/** The app an upgrade is for, when its path is an app's socket (/api/apps/<id>/socket). */
export const appSocketId = (path: string) => /^\/api\/apps\/([a-z0-9-]+)\/socket$/.exec(path)?.[1] ?? null;

/**
 * Whether a socket may open: from this site's own pages only. Browsers always send a WebSocket's
 * Origin, and cookies ride along from any site, so a missing or foreign Origin is refused.
 * `own`: the hosts allowed on this machine; null when deployed, where the Host is whatever it is.
 */
export function socketAllowed(host: string | undefined, origin: string | undefined, own: string[] | null): boolean {
  if (!host || !origin) return false;
  let from: string;
  try { from = new URL(origin).host; } catch { return false; }
  const wanted = host.toLowerCase();
  if (own) return own.includes(wanted) && own.includes(from.toLowerCase());
  return from.toLowerCase() === wanted;
}
