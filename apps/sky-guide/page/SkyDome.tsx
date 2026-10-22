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
 * The sky itself, on a canvas: the horizon as a circle, the stars inside it,
 * the lit figure joined up, and a ring around whatever is selected.
 *
 * Canvas rather than SVG because a clear sky is eighty-odd glows and a hundred
 * gradient fills, and eighty DOM nodes with filters on them is where a panel
 * starts dropping frames on a phone.
 *
 * Everything drawn comes from the snapshot. There is no second sky here, no
 * catalogue, and no second opinion about what is up: a tap becomes one
 * `select` intent and the chart (engine/chart.ts) decides. Ported unchanged
 * from the original panel.
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
}: {
  state: SkySnapshot;
  onSelect: (id: string) => void;
  busy: boolean;
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
    draw(ctx, state, dome, size);
  }, [state, dome.cx, dome.cy, dome.radius, size.width, size.height]);

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
        aria-label={`The sky from ${state.where.label} at ${state.when.label}: ${state.visible.length} stars above the horizon`}
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

const SKY_EDGE = "#101a2e";
const SKY_MIDDLE = "#05070f";

function draw(
  ctx: CanvasRenderingContext2D,
  state: SkySnapshot,
  dome: { cx: number; cy: number; radius: number },
  size: { width: number; height: number },
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  if (dome.radius <= 0) return;

  const positions = new Map(
    state.visible.map((star) => [star.id, project(star.alt, star.az, dome)]),
  );

  // the sky, darkest at the zenith
  const wash = ctx.createRadialGradient(dome.cx, dome.cy, 0, dome.cx, dome.cy, dome.radius);
  wash.addColorStop(0, SKY_MIDDLE);
  wash.addColorStop(1, SKY_EDGE);
  ctx.beginPath();
  ctx.arc(dome.cx, dome.cy, dome.radius, 0, Math.PI * 2);
  ctx.fillStyle = wash;
  ctx.fill();

  // the horizon, and the altitude rings at thirty and sixty degrees
  ctx.strokeStyle = "rgba(150, 180, 230, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = "rgba(150, 180, 230, 0.12)";
  ctx.lineWidth = 1;
  for (const alt of [30, 60]) {
    ctx.beginPath();
    ctx.arc(dome.cx, dome.cy, ((90 - alt) / 90) * dome.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // the lit figure, under the stars so the glows sit on top of it
  if (state.figure) {
    ctx.strokeStyle = "rgba(126, 200, 255, 0.55)";
    ctx.lineWidth = 1.2;
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
    glow.addColorStop(0, "rgba(255, 255, 255, 0.85)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * 3.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // the selection ring, and only then the name — a label under every star
  // turns a sky into a spreadsheet
  const selected = state.selected ? positions.get(state.selected) : undefined;
  if (selected && state.selected) {
    const star = state.visible.find((candidate) => candidate.id === state.selected);
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffd479";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (star) {
      ctx.fillStyle = "#ffd479";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(star.name, selected.x, selected.y - 17);
    }
  }

  ctx.fillStyle = "rgba(190, 210, 245, 0.75)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const point of compassLabelPoints(dome)) {
    // Pushed a fixed gap outside the rim so a low star and a compass letter
    // never sit on top of each other — and so N and S stay on the canvas
    // when the box is much wider than it is tall.
    ctx.fillText(point.label, point.x, point.y);
  }
}
