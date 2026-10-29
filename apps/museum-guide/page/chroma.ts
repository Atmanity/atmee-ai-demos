// Edmund stands in front of a green screen; this takes the green out so he
// stands in the visitor's camera view instead. A WebGL pass per video frame:
// how far each pixel's colour (its CbCr, so shadow and light on the screen
// key alike) is from the screen's, a soft band between "screen" and "him",
// green spill pulled out of his edges, and a fade where the frame cuts him
// off at the bottom and sides. The screen's colour is read from the video's
// own top corners as it plays, since the stream's encoding shifts it a little.

export type Rgb = [number, number, number];

/** The screen in Edmund's portrait (0..255). */
export const DEFAULT_KEY: Rgb = [12, 151, 53];

/** CbCr distance below which a pixel is screen, and above which it is him (0..1 colour). */
export const BAND: [number, number] = [0.07, 0.16];

const greenish = (r: number, g: number, b: number) => g > r + 30 && g > b + 30;

/**
 * The screen's colour from the top corners of a small RGBA copy of a frame
 * (`size` corner pixels square on each side): the median of the green pixels
 * there, or null when too few of them are green to trust (a frame of him
 * leaning into a corner, a black first frame).
 */
export function estimateKey(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, size = 8): Rgb | null {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  let total = 0;
  for (let y = 0; y < Math.min(size, height); y++) {
    for (const x0 of [0, Math.max(0, width - size)]) {
      for (let x = x0; x < Math.min(x0 + size, width); x++) {
        const i = (y * width + x) * 4;
        total++;
        if (!greenish(rgba[i], rgba[i + 1], rgba[i + 2])) continue;
        r.push(rgba[i]); g.push(rgba[i + 1]); b.push(rgba[i + 2]);
      }
    }
  }
  if (!total || r.length < total * 0.5) return null;
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1];
  return [median(r), median(g), median(b)];
}

/** A colour's CbCr (BT.601), from 0..1 RGB: what the shader compares. */
export function cbcr([r, g, b]: Rgb): [number, number] {
  return [-0.1687 * r - 0.3313 * g + 0.5 * b, 0.5 * r - 0.4187 * g - 0.0813 * b];
}

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = vec2(p.x + 1.0, 1.0 - p.y) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D frame;
uniform vec2 key;
uniform vec2 band;
varying vec2 uv;
vec2 cbcr(vec3 c) { return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
void main() {
  vec3 c = texture2D(frame, uv).rgb;
  float a = smoothstep(band.x, band.y, distance(cbcr(c), key));
  c.g = min(c.g, max(c.r, c.b) * 1.05);
  a *= smoothstep(0.0, 0.12, 1.0 - uv.y) * smoothstep(0.0, 0.05, uv.x) * smoothstep(0.0, 0.05, 1.0 - uv.x);
  gl_FragColor = vec4(c * a, a);
}`;

export interface Keyer {
  /** Draws the video's current frame, keyed. False when it has no frame yet. */
  draw(video: HTMLVideoElement): boolean;
  dispose(): void;
}

/** A keyer drawing into `canvas`, or null where WebGL is not available. */
export function createKeyer(canvas: HTMLCanvasElement): Keyer | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) {
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  const keyAt = gl.getUniformLocation(program, 'key');
  gl.uniform2f(gl.getUniformLocation(program, 'band'), ...BAND);
  const setKey = (rgb: Rgb) => gl.uniform2f(keyAt, ...cbcr(rgb.map((v) => v / 255) as Rgb));
  setKey(DEFAULT_KEY);

  // The key follows the video: re-read from its corners about once a second.
  const probe = document.createElement('canvas');
  probe.width = probe.height = 64;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  let probedAt = 0;

  return {
    draw(video) {
      if (video.readyState < 2 || !video.videoWidth) return false;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const now = performance.now();
      if (probeCtx && now - probedAt > 1000) {
        probedAt = now;
        probeCtx.drawImage(video, 0, 0, 64, 64);
        const key = estimateKey(probeCtx.getImageData(0, 0, 64, 64).data, 64, 64, 6);
        if (key) setKey(key);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    },
  };
}
