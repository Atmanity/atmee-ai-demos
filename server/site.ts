// One server for every app: the mini-apps answer their own paths, and the five
// apps' server.js (mounted in the same process) answers everything else.

/** Whether a path belongs to the mini-apps (served here) rather than to the five apps (passed on). */
export function isMiniAppPath(path: string, production: boolean): boolean {
  if (path === '/apps' || path.startsWith('/apps/') || path === '/api/apps' || path.startsWith('/api/apps/')) return true;
  // The pages' own files: the build's in production, Vite's while developing.
  if (production) return path.startsWith('/assets/');
  return ['/@vite/', '/@react-refresh', '/@fs/', '/@id/', '/node_modules/', '/src/', '/__vite'].some((p) => path.startsWith(p));
}
