import { useEffect } from "react";

import type { EquationView, FactsView } from "../engine/types.ts";
import { useCanvas2D } from "./canvas.ts";
import { PAD, curvePoints, project, tickLabel, ticks } from "./graph.ts";
import { maths } from "./notes.ts";

/**
 * The parabola, drawn from the three coefficients and the engine's framing.
 * Ported from the original panel (the canvas hook is vendored), in chalk.
 *
 * Everything annotated here — the roots, the vertex, the axis of symmetry —
 * arrived in the snapshot as exact values. The panel positions them; it does
 * not work out where they are. A curve that crosses at 1 and 3 while the
 * algebra beside it says 1 and 3 is a curve nobody has to trust separately.
 *
 * There is no interaction: no drag, no zoom, no sliders. This is a board for a
 * class to look at while somebody talks, and every control here would be a
 * second way to change what they are looking at.
 *
 * Drawn in Chalkline's chalk (chalkline.css): blue for the curve, yellow for
 * the roots, pink for the vertex, on the board's own green.
 */

const COLOURS = {
  paper: "#1b342b",
  grid: "rgba(244, 241, 230, 0.07)",
  axis: "rgba(244, 241, 230, 0.55)",
  ink: "rgba(244, 241, 230, 0.66)",
  curve: "#93cbe9",
  root: "#f3d36b",
  vertex: "#f4a0b5",
  symmetry: "rgba(244, 241, 230, 0.3)",
};
const LABEL_FONT = '600 12px "Atkinson Hyperlegible", system-ui, sans-serif';

export function Parabola({
  equation,
  facts,
}: {
  equation: EquationView;
  facts: FactsView;
}) {
  const { ref, ctx, box } = useCanvas2D();

  useEffect(() => {
    if (!ctx || box.width < 2 || box.height < 2) return;
    const projection = project(equation, facts, box.width, box.height);

    ctx.clearRect(0, 0, box.width, box.height);
    ctx.fillStyle = COLOURS.paper;
    ctx.fillRect(0, 0, box.width, box.height);

    drawGrid(ctx, projection, box);
    drawSymmetry(ctx, projection, facts, box);
    drawCurve(ctx, equation, projection, box);
    drawMarks(ctx, projection, facts);
  }, [ctx, box, equation, facts]);

  return (
    <figure className="cl-graph">
      <div className="cl-graph-canvas">
        <canvas
          ref={ref}
          style={{ width: "100%", height: "100%", display: "block" }}
          role="img"
          aria-label={describe(equation, facts)}
        />
      </div>
      <figcaption className="cl-legend" aria-hidden="true">
        <span className="is-root">{facts.crossings.length ? "roots" : "no real roots"}</span>
        <span className="is-vertex">vertex {maths(facts.vertex_display)}</span>
        <span className="is-axis">axis x = {maths(facts.axis_display)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * The graph in words, for anyone not looking at it.
 *
 * Built from the same exact strings the algebra uses, so a screen reader is
 * told "2 + √3" and not a rounded decimal.
 */
export function describe(equation: EquationView, facts: FactsView): string {
  const roots =
    facts.crossings.length === 0
      ? "It does not cross the x-axis."
      : `It crosses the x-axis at ${facts.roots.join(" and ")}.`;
  return (
    `Graph of ${equation.display}. A parabola opening ${facts.opens}, ` +
    `with its vertex at ${facts.vertex_display}. ${roots}`
  );
}

type Ctx = CanvasRenderingContext2D;
type Box = { width: number; height: number };
type Projection = ReturnType<typeof project>;

function drawGrid(ctx: Ctx, projection: Projection, box: Box) {
  ctx.font = LABEL_FONT;
  ctx.lineWidth = 1;

  ctx.strokeStyle = COLOURS.grid;
  ctx.fillStyle = COLOURS.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const x of ticks(projection.xMin, projection.xMax)) {
    const [sx] = projection.toScreen(x, 0);
    line(ctx, sx, PAD.top, sx, box.height - PAD.bottom);
    ctx.fillText(maths(tickLabel(x)), sx, box.height - PAD.bottom + 6);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const y of ticks(projection.yMin, projection.yMax, 6)) {
    const [, sy] = projection.toScreen(0, y);
    line(ctx, PAD.left, sy, box.width - PAD.right, sy);
    ctx.fillText(maths(tickLabel(y)), PAD.left - 8, sy);
  }

  // The axes on top of the grid, so they read as axes.
  ctx.strokeStyle = COLOURS.axis;
  ctx.lineWidth = 1.5;
  const [, zeroY] = projection.toScreen(0, 0);
  if (zeroY >= PAD.top && zeroY <= box.height - PAD.bottom) {
    line(ctx, PAD.left, zeroY, box.width - PAD.right, zeroY);
  }
  const [zeroX] = projection.toScreen(0, 0);
  if (zeroX >= PAD.left && zeroX <= box.width - PAD.right) {
    line(ctx, zeroX, PAD.top, zeroX, box.height - PAD.bottom);
  }
}

function drawSymmetry(ctx: Ctx, projection: Projection, facts: FactsView, box: Box) {
  const [x] = projection.toScreen(facts.axis, 0);
  ctx.strokeStyle = COLOURS.symmetry;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  line(ctx, x, PAD.top, x, box.height - PAD.bottom);
  ctx.setLineDash([]);
}

function drawCurve(ctx: Ctx, equation: EquationView, projection: Projection, box: Box) {
  const points = curvePoints(equation, projection, box.width);
  // Clipped to the plot area: a steep parabola runs far off the top, and a
  // stroke over the axis labels reads as a rendering bug.
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    PAD.left,
    PAD.top,
    box.width - PAD.left - PAD.right,
    box.height - PAD.top - PAD.bottom,
  );
  ctx.clip();

  ctx.strokeStyle = COLOURS.curve;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawMarks(ctx: Ctx, projection: Projection, facts: FactsView) {
  for (const crossing of facts.crossings) {
    const [x, y] = projection.toScreen(crossing, 0);
    dot(ctx, x, y, 6, COLOURS.root);
  }
  const [vx, vy] = projection.toScreen(facts.vertex[0], facts.vertex[1]);
  dot(ctx, vx, vy, 6, COLOURS.vertex);

  ctx.fillStyle = COLOURS.vertex;
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = facts.opens === "upward" ? "top" : "bottom";
  ctx.fillText(maths(facts.vertex_display), vx, vy + (facts.opens === "upward" ? 10 : -10));
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx: Ctx, x: number, y: number, radius: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
