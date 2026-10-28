// Holding the host's frame still. The v2 renderer moves its own camera (it zooms
// in by up to about 1.3x and drifts during a show) and has no setting to lock
// it. Her render starts from her still, so the page measures, a few times a
// second, how far the render's background (the wall, the fan, the window: what
// she never covers) has zoomed and shifted against the still, and applies the
// opposite to her video. She still moves; the set around her does not.
//
// Images are N x N grey levels; the comparison is on gradients (edges), which
// the renderer's softer, slightly re-lit background keeps.
export const N = 96;

export interface Warp { s: number; tx: number; ty: number }   // frame = c + s (still - c) + t, in pixels of N
export const IDENTITY: Warp = { s: 1, tx: 0, ty: 0 };

/** Grey levels (0..1) to edge strength. */
export function edges(grey: Float32Array): Float32Array {
  const out = new Float32Array(N * N);
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      out[i] = Math.abs(grey[i + 1] - grey[i - 1]) + Math.abs(grey[i + N] - grey[i - N]);
    }
  }
  return out;
}

/** The background of her still: where she never is (her seat is the middle; she leans and gestures there). */
export function backgroundMask(): Uint8Array {
  const m = new Uint8Array(N * N);
  for (let y = 2; y < N - 2; y++) {
    for (let x = 2; x < N - 2; x++) {
      const u = x / N, v = y / N;
      if (u < 0.2 || u > 0.8 || v < 0.12) m[y * N + x] = 1;
    }
  }
  return m;
}

/** How far the frame differs from the still under a warp: mean edge difference over the background. */
export function cost(still: Float32Array, frame: Float32Array, mask: Uint8Array, w: Warp, step = 2): number {
  const c = (N - 1) / 2;
  let sum = 0, n = 0;
  for (let y = 0; y < N; y += step) {
    for (let x = 0; x < N; x += step) {
      const i = y * N + x;
      if (!mask[i]) continue;
      const px = Math.round(c + w.s * (x - c) + w.tx), py = Math.round(c + w.s * (y - c) + w.ty);
      if (px < 1 || py < 1 || px >= N - 1 || py >= N - 1) continue;
      sum += Math.abs(frame[py * N + px] - still[i]);
      n++;
    }
  }
  return n > 50 ? sum / n : Infinity;
}

/** The warp from the still to the frame: a coarse search, then a fine one around the best. */
export function estimate(still: Float32Array, frame: Float32Array, mask: Uint8Array): { warp: Warp; cost: number; identity: number } {
  let best = { warp: IDENTITY, cost: cost(still, frame, mask, IDENTITY) };
  const identity = best.cost;
  const search = (s0: number, s1: number, ds: number, t0: number, dt: number, around: Warp, sub: number) => {
    for (let s = s0; s <= s1 + 1e-9; s += ds) {
      for (let tx = around.tx - t0; tx <= around.tx + t0 + 1e-9; tx += dt) {
        for (let ty = around.ty - t0; ty <= around.ty + t0 + 1e-9; ty += dt) {
          const w = { s, tx, ty };
          const k = cost(still, frame, mask, w, sub);
          if (k < best.cost) best = { warp: w, cost: k };
        }
      }
    }
  };
  search(0.9, 1.4, 0.025, 10, 2, IDENTITY, 3);
  const b = best.warp;
  search(b.s - 0.02, b.s + 0.02, 0.005, 2, 0.5, b, 2);
  return { ...best, identity };
}

/** The CSS that undoes a warp on an element showing the frame (translate in % of the element). */
export function undo(w: Warp): string {
  return `scale(${(1 / w.s).toFixed(4)}) translate(${(-w.tx / N * 100).toFixed(2)}%, ${(-w.ty / N * 100).toFixed(2)}%)`;
}

/**
 * Hold a video still against its first frame (the still it was made from): a few times a second,
 * measure the warp and ease the opposite onto the video. A measurement no better than "not moved"
 * eases it back towards no warp.
 */
export function startStabilizer(video: HTMLVideoElement, stillSrc: string): () => void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => {};
  const grey = (src: CanvasImageSource) => {
    ctx.drawImage(src, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    const g = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    return edges(g);
  };
  const mask = backgroundMask();
  let still: Float32Array | null = null;
  const img = new Image();
  img.onload = () => { still = grey(img); };
  img.src = stillSrc;
  let cur: Warp = IDENTITY;
  video.style.transformOrigin = '50% 50%';
  video.style.transition = 'transform .45s linear';
  const id = setInterval(() => {
    if (!still || video.readyState < 2 || !video.videoWidth) return;
    const r = estimate(still, grey(video), mask);
    // Only a clear match moves her: noise in a still frame read as a small shift.
    const target = r.cost < r.identity * 0.85 ? r.warp : IDENTITY;
    const k = 0.4;
    cur = { s: cur.s + (target.s - cur.s) * k, tx: cur.tx + (target.tx - cur.tx) * k, ty: cur.ty + (target.ty - cur.ty) * k };
    video.style.transform = undo(cur);
    (window as unknown as { __stabilizer?: Warp }).__stabilizer = cur;   // for checking it live
  }, 400);
  return () => { clearInterval(id); video.style.transform = ''; };
}
