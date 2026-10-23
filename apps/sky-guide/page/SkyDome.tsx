import { useCallback, useEffect, useRef, useState } from "react";

import {
  compassLabelPoints,
  domeFor,
  nearestStar,
  project,
  starRadius,
} from "./projection.ts";
import type { SkySnapshot } from "../engine/types.ts";

/**
 * The sky itself, on a canvas: the horizon as a circle engraved like a
 * planisphere's rim, the stars inside it, the lit figure joined up and named,
 * and a ring around whatever is selected.
 *
 * Canvas rather than SVG because a clear sky is eighty-odd glows and a hundred
 * gradient fills, and eighty DOM nodes with filters on them is where a panel
 * starts dropping frames on a phone.
 *
 * Everything drawn comes from the snapshot. There is no second sky here, no
 * catalogue, and no second opinion about what is up: a tap becomes one
 * `select` intent and the chart (engine/chart.ts) decides. Ported from the
 * original panel; the colours now come from a palette (night or red light).
 *
 * Two things here are pure boilerplate that every canvas panel will rewrite:
 * the devicePixelRatio dance (a canvas whose backing store is not scaled by
 * dPR renders visibly blurry on every retina screen and looks like a font
 * problem), and turning a pointer event into scene coordinates.
 */
export function SkyDome({
  state,
  onSelect,
  busy,
  palette = NIGHT,
  daytime = false,
  label,
}: {
  state: SkySnapshot;
  onSelect: (id: string) => void;
  busy: boolean;
  /** The colours: the night chart, or red light for dark-adapted eyes. */
  palette?: DomePalette;
  /** The place's clock says day: the chart is washed lighter (it has no Sun to draw). */
  daytime?: boolean;
  /** The canvas's description, if not the default. */
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Measure the container, and keep measuring. The canvas cannot size itself
  // from CSS — its backing store is a number of device pixels — so a resize
  // that nobody observed leaves the sky stretched.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const rect = box.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    // ResizeObserver is absent in jsdom, so the fallback is not dead code —
    // it is what makes this component testable at all.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // The canvas draws its labels in the page's fonts; redraw once they arrive.
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => { if (live) setFonts((n) => n + 1); }, () => undefined);
    return () => { live = false; };
  }, []);

  const dome = domeFor(size.width, size.height);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const ctx = canvas.getContext("2d");
    // Null under jsdom, and null on a device that has run out of contexts. The
    // panel must still render its text and stay tappable either way.
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, state, dome, size, palette, daytime);
  }, [state, dome.cx, dome.cy, dome.radius, size.width, size.height, palette, daytime, fonts]);

  const tap = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (busy) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const star = nearestStar(
        event.clientX - rect.left,
        event.clientY - rect.top,
        state.visible,
        domeFor(rect.width || size.width, rect.height || size.height),
      );
      if (star) onSelect(star.id);
    },
    [busy, onSelect, size.height, size.width, state.visible],
  );

  return (
    <div className="sg-dome" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="sg-canvas"
        style={{ width: "100%", height: "100%" }}
        onPointerDown={tap}
        role="img"
        aria-label={label ?? `The sky from ${state.where.label} at ${state.when.label}: ${state.visible.length} stars above the horizon`}
      />
      {/* A tap target list rather than a decoration: a canvas is invisible to a
          screen reader and unreachable by keyboard, and the whole app is one
          gesture on it. */}
      <ul className="sg-reachable" aria-label="Stars above the horizon">
        {state.visible.map((star) => (
          <li key={star.id}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={star.id === state.selected}
              onClick={() => onSelect(star.id)}
            >
              {star.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The chart's colours. Canvas cannot read CSS variables cheaply on every
 *  frame, so the two looks are spelled out here and chosen by the page. */
export interface DomePalette {
  zenith: string;
  edge: string;
  dayZenith: string;
  dayEdge: string;
  rim: string;
  ring: string;
  star: string;
  glow: string;
  /** The glow's colour at nothing: a fade to transparent black would grey the halo. */
  glowFade: string;
  figure: string;
  marked: string;
  label: string;
}

export const NIGHT: DomePalette = {
  zenith: "#050a1f",
  edge: "#16245a",
  dayZenith: "#2c4f93",
  dayEdge: "#5f86c8",
  rim: "rgba(152, 166, 207, 0.55)",
  ring: "rgba(152, 166, 207, 0.14)",
  star: "#f6f1e3",
  glow: "rgba(246, 241, 227, 0.85)",
  glowFade: "rgba(246, 241, 227, 0)",
  figure: "rgba(143, 214, 202, 0.75)",
  marked: "#e3b45c",
  label: "rgba(190, 202, 235, 0.85)",
};

/** Red light: what an observer's torch looks like, so dark-adapted eyes stay adapted. */
export const RED: DomePalette = {
  zenith: "#0b0202",
  edge: "#240707",
  dayZenith: "#3a0c0a",
  dayEdge: "#561410",
  rim: "rgba(214, 72, 58, 0.55)",
  ring: "rgba(214, 72, 58, 0.16)",
  star: "#ff6a55",
  glow: "rgba(255, 106, 85, 0.75)",
  glowFade: "rgba(255, 106, 85, 0)",
  figure: "rgba(214, 72, 58, 0.8)",
  marked: "#ff9a7a",
  label: "rgba(230, 110, 92, 0.9)",
};

const DISPLAY_FONT = "'Instrument Serif', 'Iowan Old Style', Georgia, serif";
const BODY_FONT = "'Hanken Grotesk', 'Avenir Next', system-ui, sans-serif";

function draw(
  ctx: CanvasRenderingContext2D,
  state: SkySnapshot,
  dome: { cx: number; cy: number; radius: number },
  size: { width: number; height: number },
  palette: DomePalette,
  daytime: boolean,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  if (dome.radius <= 0) return;

  const positions = new Map(
    state.visible.map((star) => [star.id, project(star.alt, star.az, dome)]),
  );

  // the sky, darkest at the zenith (lighter by day: the chart has no Sun to draw)
  const wash = ctx.createRadialGradient(dome.cx, dome.cy, 0, dome.cx, dome.cy, dome.radius);
  wash.addColorStop(0, daytime ? palette.dayZenith : palette.zenith);
  wash.addColorStop(1, daytime ? palette.dayEdge : palette.edge);
  ctx.beginPath();
  ctx.arc(dome.cx, dome.cy, dome.radius, 0, Math.PI * 2);
  ctx.fillStyle = wash;
  ctx.fill();

  // the horizon, and the altitude rings at thirty and sixty degrees
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = 1;
  for (const alt of [30, 60]) {
    ctx.beginPath();
    ctx.arc(dome.cx, dome.cy, ((90 - alt) / 90) * dome.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // the rim engraved like a planisphere's: a tick every ten degrees of
  // azimuth, longer every thirty, pointing in from the horizon
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let az = 0; az < 360; az += 10) {
    const inner = project(az % 30 === 0 ? 5 : 2.2, az, dome);
    const outer = project(0, az, dome);
    ctx.moveTo(outer.x, outer.y);
    ctx.lineTo(inner.x, inner.y);
  }
  ctx.stroke();

  // the lit figure, under the stars so the glows sit on top of it
  if (state.figure) {
    ctx.strokeStyle = palette.figure;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [a, b] of state.figure.lines) {
      const from = positions.get(a);
      const to = positions.get(b);
      if (!from || !to) continue;
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }

  for (const star of state.visible) {
    const at = positions.get(star.id);
    if (!at) continue;
    const radius = starRadius(star.mag);
    const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius * 3.2);
    glow.addColorStop(0, palette.glow);
    glow.addColorStop(1, palette.glowFade);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * 3.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = palette.star;
    ctx.fill();
  }

  // the figure's name, in an atlas's italic, beside its lines
  if (state.figure) {
    const points = state.figure.lines.flat().map((id) => positions.get(id)).filter((p): p is { x: number; y: number } => Boolean(p));
    if (points.length) {
      const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const y = Math.max(...points.map((p) => p.y));
      ctx.fillStyle = palette.figure;
      ctx.font = `italic 17px ${DISPLAY_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(state.figure.name, x, y + 12);
    }
  }

  // the selection ring, and only then the name — a label under every star
  // turns a sky into a spreadsheet
  const selected = state.selected ? positions.get(state.selected) : undefined;
  if (selected && state.selected) {
    const star = state.visible.find((candidate) => candidate.id === state.selected);
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = palette.marked;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (star) {
      ctx.fillStyle = palette.marked;
      ctx.font = `600 13px ${BODY_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(star.name, selected.x, selected.y - 17);
    }
  }

  ctx.fillStyle = palette.label;
  ctx.font = `600 11px ${BODY_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const point of compassLabelPoints(dome)) {
    // Pushed a fixed gap outside the rim so a low star and a compass letter
    // never sit on top of each other — and so N and S stay on the canvas
    // when the box is much wider than it is tall.
    ctx.fillText(point.label, point.x, point.y);
  }
}
