// Mochi without the green: the host's video (or portrait, until it plays) drawn
// through a small WebGL key, so Mochi stands inside the game world.
import { useEffect, useRef, type RefObject } from 'react';

const SIZE = 1024;
const VERTEX = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2((p.x + 1.) / 2., (1. - p.y) / 2.); gl_Position = vec4(p, 0., 1.); }`;
const FRAGMENT = `precision mediump float; varying vec2 uv; uniform sampler2D t; uniform vec2 px;
float solid(vec2 at) { vec4 c = texture2D(t, at); return 1. - smoothstep(.2, .32, c.g - max(c.r, c.b)); }
void main() {
  // Pulled in by a pixel of the source, then softened: compression smears green into the edge.
  float inner = min(min(solid(uv + vec2(px.x, 0.)), solid(uv - vec2(px.x, 0.))), min(solid(uv + vec2(0., px.y)), solid(uv - vec2(0., px.y))));
  float a = smoothstep(.15, .85, min(solid(uv), inner));
  vec4 c = texture2D(t, uv);
  float other = max(c.r, c.b);
  // Green light bounces onto the skin; teal keeps its blue, so only green-without-blue is pulled back.
  float clean = min(c.g, max(c.r * .9, c.b));
  gl_FragColor = vec4(c.r, min(clean, other * mix(.82, 1., a)), c.b, a);
}`;

export function Cutout({ video, image, className = '' }: { video?: RefObject<HTMLVideoElement | null>; image: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!el || !gl) return;
    const shader = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); return s; };
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
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // A fixed drawing size: the video can arrive small, and the texture's filtering smooths it up.
    el.width = SIZE;
    el.height = SIZE;
    gl.viewport(0, 0, SIZE, SIZE);
    const px = gl.getUniformLocation(program, 'px');
    const still = new Image();
    still.src = image;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const v = video?.current;
      const source = v && v.readyState >= 2 && v.videoWidth ? v : still.complete && still.naturalWidth ? still : null;
      if (!source) return;
      const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      gl.uniform2f(px, 1.4 / width, 1.4 / width);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [image, video]);
  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
