import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  areaLabel,
  centre,
  dropPosition,
  metres,
  openingLine,
  swingPath,
  wallDelta,
} from "./geometry.ts";
import { ROOM_FILL } from "./palette.ts";
import type { Item, Level, Wall } from "../engine/types.ts";

/**
 * The drawing. Rooms, the walls between them, doors, windows and furniture.
 *
 * Two things can be dragged, and they are the two things a human points at: a
 * piece of furniture, and the wall between two rooms. Both send real
 * centimetres, which is the app's one exception to "the model never picks
 * coordinates" — a hand on a wall is not a model guessing.
 *
 * Nothing here decides whether a drag is allowed. The drop is one intent and
 * the planner answers; a refusal comes back as a sentence to show. The preview
 * offset is local view state and never reaches the planner.
 */


type Drag =
  | { sort: "item"; id: string; dx: number; dy: number }
  | { sort: "wall"; index: number; dx: number; dy: number };

export function FloorPlan({
  level,
  selected,
  unit,
  onSelectItem,
  onSelectRoom,
  onMoveItem,
  onMoveWall,
  busy,
}: {
  level: Level;
  selected: string | null;
  unit: "m2" | "ft2";
  onSelectItem: (id: string) => void;
  onSelectRoom: (id: string) => void;
  onMoveItem: (id: string, x: number, y: number) => void;
  onMoveWall: (a: string, b: string, delta: number) => void;
  busy: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  // The plan is drawn in centimetres and scaled by the viewBox, so the pointer
  // has to be converted the same way. Reading the rendered box each time keeps
  // it right through a resize without a listener.
  const pxToCm = useCallback((px: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return px;
    return px * (level.w_cm / box.width);
  }, [level.w_cm]);

  const startItem = (event: ReactPointerEvent, item: Item) => {
    if (busy) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    setDrag({ sort: "item", id: item.id, dx: 0, dy: 0 });
    onSelectItem(item.id);
  };

  const startWall = (event: ReactPointerEvent, index: number) => {
    if (busy) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    setDrag({ sort: "wall", index, dx: 0, dy: 0 });
  };

  const onMove = (event: ReactPointerEvent) => {
    if (!drag || !origin.current) return;
    setDrag({
      ...drag,
      dx: event.clientX - origin.current.x,
      dy: event.clientY - origin.current.y,
    });
  };

  // The delta comes from THIS event rather than from the last move we saw.
  // Reading the accumulated move state instead loses any drag that ends
  // without an intermediate pointermove — a flick, a tap-and-release on a
  // trackpad, or an automated drag — and "nothing happened" is the worst
  // possible answer to a hand that clearly moved something.
  const onUp = (event: ReactPointerEvent) => {
    if (!drag) return;
    const dx = origin.current ? event.clientX - origin.current.x : drag.dx;
    const dy = origin.current ? event.clientY - origin.current.y : drag.dy;
    if (drag.sort === "item") {
      const item = level.items.find((candidate) => candidate.id === drag.id);
      if (item) {
        const at = dropPosition(item, pxToCm(dx), pxToCm(dy), 1, level);
        if (at.x !== item.x_cm || at.y !== item.y_cm) onMoveItem(item.id, at.x, at.y);
      }
    } else {
      const wall = level.walls[drag.index];
      if (wall) {
        const delta = wallDelta(wall, pxToCm(dx), pxToCm(dy), 1);
        if (delta !== 0) onMoveWall(wall.a, wall.b, delta);
      }
    }
    setDrag(null);
    origin.current = null;
  };

  const itemOffset = (item: Item) =>
    drag?.sort === "item" && drag.id === item.id
      ? { x: pxToCm(drag.dx), y: pxToCm(drag.dy) }
      : { x: 0, y: 0 };

  const wallOffset = (index: number, wall: Wall) => {
    if (drag?.sort !== "wall" || drag.index !== index) return 0;
    return wall.axis === "v" ? pxToCm(drag.dx) : pxToCm(drag.dy);
  };

  return (
    <svg
      ref={svgRef}
      className="rp-plan"
      viewBox={`-30 -30 ${level.w_cm + 60} ${level.h_cm + 60}`}
      role="img"
      aria-label={`Floor plan of the ${level.name} floor`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <defs>
        <pattern id="rp-dead" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 16 L16 0" stroke="#c0392b" strokeWidth="2" opacity="0.28" />
        </pattern>
      </defs>

      <rect x={0} y={0} width={level.w_cm} height={level.h_cm} fill="#fbfaf6" />

      {/* Floor in no room at all. Hatched rather than left blank: a gap is a
          design fact the client should be able to point at, and blank paper
          reads as "not drawn yet". */}
      {level.unassigned.map(([x0, y0, x1, y1], index) => (
        <rect
          key={`dead-${index}`}
          x={x0} y={y0} width={x1 - x0} height={y1 - y0}
          fill="url(#rp-dead)"
        />
      ))}

      {level.rooms.map((room) => {
        const isSelected = room.id === selected;
        return (
          <g
            key={room.id}
            className="rp-room"
            onPointerDown={() => !busy && onSelectRoom(room.id)}
          >
            {room.rects.map(([x0, y0, x1, y1], index) => (
              <rect
                key={index}
                x={x0} y={y0} width={x1 - x0} height={y1 - y0}
                fill={ROOM_FILL[room.kind] ?? ROOM_FILL.other}
              />
            ))}
            {room.edges.map(([x0, y0, x1, y1], index) => (
              <line
                key={index}
                x1={x0} y1={y0} x2={x1} y2={y1}
                stroke="#1c3d5a" strokeWidth={isSelected ? 9 : 5}
                strokeLinecap="square"
              />
            ))}
            {/* The label sits at the TOP of the room, not its centre. Centred,
                it disappeared under the first piece of furniture placed — and
                the middle of the floor is exactly where furniture goes. */}
            <text
              x={centre(room.bbox).x} y={room.bbox[1] + 40}
              className="rp-room__name" textAnchor="middle"
            >
              {room.name}
            </text>
            <text
              x={centre(room.bbox).x} y={room.bbox[1] + 72}
              className="rp-room__area" textAnchor="middle"
            >
              {areaLabel(room.area_m2, unit)}
            </text>
          </g>
        );
      })}

      {/* Openings sit on top of the wall they cut. A door is a white gap plus
          the arc it sweeps — without the arc the drawing hides the one thing a
          door costs, which is floor. */}
      {level.openings.map((opening) => {
        const { x1, y1, x2, y2 } = openingLine(opening);
        const arc = swingPath(opening);
        return (
          <g key={opening.id}>
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={opening.kind === "door" ? "#fbfaf6" : "#7fb2d9"}
              strokeWidth={opening.kind === "door" ? 11 : 9}
            />
            {arc && (
              <path d={arc} fill="none" stroke="#1c3d5a" strokeWidth={2}
                    strokeDasharray="10 8" opacity={0.45} />
            )}
          </g>
        );
      })}

      {/* Every piece carries its name on the drawing. Unlabelled, a double bed
          and a three-seat sofa are the same brown rectangle, and the one
          question a client asks of a furnished plan — "which one is the bed?" —
          had no answer. A hover title is not an answer on a touchscreen. */}
      {level.items.map((item) => {
        const offset = itemOffset(item);
        const x = item.x_cm + offset.x;
        const y = item.y_cm + offset.y;
        const roomy = item.w_cm >= 90 && item.h_cm >= 45;
        return (
          <g key={item.id}>
            <rect
              className={`rp-piece${item.id === selected ? " rp-piece--selected" : ""}`}
              x={x} y={y} width={item.w_cm} height={item.h_cm}
              rx={4}
              fill="#c9a06b" stroke={item.id === selected ? "#1c3d5a" : "#8a6239"}
              strokeWidth={item.id === selected ? 5 : 2}
              onPointerDown={(event) => startItem(event, item)}
            >
              <title>{`${item.label} — ${item.w_cm} × ${item.h_cm} cm`}</title>
            </rect>
            {roomy && (
              <text
                x={x + item.w_cm / 2} y={y + item.h_cm / 2 + 7}
                className="rp-piece__label" textAnchor="middle"
              >
                {item.label}
              </text>
            )}
          </g>
        );
      })}

      {/* The grips. Wide and invisible: a wall is five pixels of ink and
          nobody can hit five pixels, so the handle is thirty centimetres of
          transparent hit area sitting on top of it. */}
      {level.walls.map((wall, index) => {
        const shift = wallOffset(index, wall);
        const vertical = wall.axis === "v";
        const x = vertical ? wall.line_cm + shift : wall.start_cm;
        const y = vertical ? wall.start_cm : wall.line_cm + shift;
        const w = vertical ? 0 : wall.end_cm - wall.start_cm;
        const h = vertical ? wall.end_cm - wall.start_cm : 0;
        return (
          <g key={`${wall.a}-${wall.b}-${index}`}>
            {shift !== 0 && (
              <line
                x1={x} y1={y} x2={x + w} y2={y + h}
                stroke="#2f7d4f" strokeWidth={7} strokeDasharray="14 10"
              />
            )}
            <line
              className={
                wall.structural ? "rp-wall rp-wall--fixed" : "rp-wall rp-wall--grip"
              }
              x1={x} y1={y} x2={x + w} y2={y + h}
              stroke="transparent" strokeWidth={34}
              style={{
                cursor: wall.structural
                  ? "not-allowed"
                  : vertical
                    ? "ew-resize"
                    : "ns-resize",
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (!wall.structural) startWall(event, index);
              }}
            >
              <title>
                {wall.structural
                  ? "Load-bearing — this wall doesn't move"
                  : "Drag to move this wall"}
              </title>
            </line>
            {wall.structural && (
              <line
                x1={x} y1={y} x2={x + w} y2={y + h}
                stroke="#1c3d5a" strokeWidth={11} opacity={0.85}
              />
            )}
          </g>
        );
      })}

      {/* Overall dimensions, outside the envelope. */}
      <text x={level.w_cm / 2} y={-8} className="rp-dim" textAnchor="middle">
        {metres(level.w_cm)}
      </text>
      <text
        x={-10} y={level.h_cm / 2} className="rp-dim" textAnchor="middle"
        transform={`rotate(-90 ${-10} ${level.h_cm / 2})`}
      >
        {metres(level.h_cm)}
      </text>
    </svg>
  );
}
