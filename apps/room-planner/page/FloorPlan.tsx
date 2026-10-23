import { useCallback, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  areaLabel,
  centre,
  dropPosition,
  metres,
  openingLine,
  swingPath,
  wallDelta,
} from "./geometry.ts";
import { BLUE, GLASS, INK, PAPER, REDLINE, ROOM_FILL, TRACE, WOOD, WOOD_EDGE } from "./palette.ts";
import type { Item, Level, Wall } from "../engine/types.ts";

/**
 * The drawing. Rooms, the walls between them, doors, windows and furniture,
 * over a one-metre grid (each square is a square metre, which is how the
 * client argues about size).
 *
 * Two things can be dragged, and they are the two things a human points at: a
 * piece of furniture, and the wall between two rooms. Both send real
 * centimetres, which is the app's one exception to "the architect never picks
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
  readOnly = false,
  label,
}: {
  level: Level;
  selected: string | null;
  unit: "m2" | "ft2";
  onSelectItem: (id: string) => void;
  onSelectRoom: (id: string) => void;
  onMoveItem: (id: string, x: number, y: number) => void;
  onMoveWall: (a: string, b: string, delta: number) => void;
  busy: boolean;
  /** A drawing to look at (the front door's sample): no grips, no selection. */
  readOnly?: boolean;
  label?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const ids = useId().replace(/:/g, "");
  const gridId = `pw-grid-${ids}`;
  const deadId = `pw-dead-${ids}`;
  const still = busy || readOnly;

  // The plan is drawn in centimetres and scaled by the viewBox, so the pointer
  // has to be converted the same way. The screen transform is read each time,
  // which keeps it right through a resize and a letterboxed drawing (a plan
  // fitted by its height is not scaled by its width).
  const pxToCm = useCallback((px: number) => {
    const svg = svgRef.current;
    const scale = typeof svg?.getScreenCTM === "function" ? svg.getScreenCTM()?.a : undefined;
    if (scale) return px / scale;
    const box = svg?.getBoundingClientRect();
    if (!box || box.width === 0) return px;
    return px * ((level.w_cm + 60) / box.width);
  }, [level.w_cm]);

  const startItem = (event: ReactPointerEvent, item: Item) => {
    if (still) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    setDrag({ sort: "item", id: item.id, dx: 0, dy: 0 });
    onSelectItem(item.id);
  };

  const startWall = (event: ReactPointerEvent, index: number) => {
    if (still) return;
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
      className={`pw-plan${readOnly ? " is-readonly" : ""}`}
      viewBox={`-30 -30 ${level.w_cm + 60} ${level.h_cm + 60}`}
      role="img"
      aria-label={label ?? `Floor plan of the ${level.name} floor`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <defs>
        <pattern id={gridId} width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M100 0 H0 V100" fill="none" stroke={BLUE} strokeWidth="1.5" opacity="0.32" />
        </pattern>
        <pattern id={deadId} width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 16 L16 0" stroke={REDLINE} strokeWidth="2" opacity="0.4" />
        </pattern>
      </defs>

      <rect x={0} y={0} width={level.w_cm} height={level.h_cm} fill={PAPER} />

      {/* Floor in no room at all. Hatched rather than left blank: a gap is a
          design fact the client should be able to point at, and blank paper
          reads as "not drawn yet". */}
      {level.unassigned.map(([x0, y0, x1, y1], index) => (
        <rect
          key={`dead-${index}`}
          className="pw-dead"
          x={x0} y={y0} width={x1 - x0} height={y1 - y0}
          fill={`url(#${deadId})`}
        />
      ))}

      {level.rooms.map((room) => (
        <g
          key={room.id}
          className="pw-room"
          onPointerDown={() => !still && onSelectRoom(room.id)}
        >
          {room.rects.map(([x0, y0, x1, y1], index) => (
            <rect
              key={index}
              x={x0} y={y0} width={x1 - x0} height={y1 - y0}
              fill={room.id === selected ? TRACE : ROOM_FILL[room.kind] ?? ROOM_FILL.other}
            />
          ))}
        </g>
      ))}

      {/* The metre grid over the rooms: each square is a square metre. */}
      <rect x={0} y={0} width={level.w_cm} height={level.h_cm} fill={`url(#${gridId})`} pointerEvents="none" />

      {level.rooms.map((room) => {
        const isSelected = room.id === selected;
        return (
          <g key={room.id} pointerEvents="none">
            {room.edges.map(([x0, y0, x1, y1], index) => (
              <line
                key={index}
                x1={x0} y1={y0} x2={x1} y2={y1}
                stroke={INK} strokeWidth={isSelected ? 10 : 6}
                strokeLinecap="square"
              />
            ))}
            {/* The label sits at the TOP of the room, not its centre. Centred,
                it disappeared under the first piece of furniture placed — and
                the middle of the floor is exactly where furniture goes. */}
            <text
              x={centre(room.bbox).x} y={room.bbox[1] + 42}
              className="pw-room-name" textAnchor="middle"
            >
              {room.name}
            </text>
            <text
              x={centre(room.bbox).x} y={room.bbox[1] + 74}
              className="pw-room-area" textAnchor="middle"
            >
              {areaLabel(room.area_m2, unit)}
            </text>
          </g>
        );
      })}

      {/* Openings sit on top of the wall they cut. A door is a gap plus the
          arc it sweeps — without the arc the drawing hides the one thing a
          door costs, which is floor. */}
      {level.openings.map((opening) => {
        const { x1, y1, x2, y2 } = openingLine(opening);
        const arc = swingPath(opening);
        return (
          <g key={opening.id} pointerEvents="none">
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={opening.kind === "door" ? PAPER : GLASS}
              strokeWidth={opening.kind === "door" ? 12 : 10}
            />
            {opening.kind === "window" && (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={2} />
            )}
            {arc && (
              <path d={arc} fill="none" stroke={INK} strokeWidth={2}
                    strokeDasharray="10 8" opacity={0.55} />
            )}
          </g>
        );
      })}

      {/* Every piece carries its name on the drawing. Unlabelled, a double bed
          and a three-seat sofa are the same rectangle, and the one question a
          client asks of a furnished plan — "which one is the bed?" — had no
          answer. A hover title is not an answer on a touchscreen. */}
      {level.items.map((item) => {
        const offset = itemOffset(item);
        const x = item.x_cm + offset.x;
        const y = item.y_cm + offset.y;
        const roomy = item.w_cm >= 90 && item.h_cm >= 45;
        const isSelected = item.id === selected;
        return (
          <g key={item.id}>
            <rect
              className={`pw-piece${isSelected ? " is-selected" : ""}`}
              x={x} y={y} width={item.w_cm} height={item.h_cm}
              rx={4}
              fill={isSelected ? TRACE : WOOD} stroke={isSelected ? INK : WOOD_EDGE}
              strokeWidth={isSelected ? 5 : 2}
              onPointerDown={(event) => startItem(event, item)}
            >
              <title>{`${item.label} — ${item.w_cm} × ${item.h_cm} cm`}</title>
            </rect>
            {roomy && (
              <text
                x={x + item.w_cm / 2} y={y + item.h_cm / 2 + 7}
                className="pw-piece-label" textAnchor="middle"
              >
                {item.label}
              </text>
            )}
          </g>
        );
      })}

      {/* The grips. Wide and invisible: a wall is a few pixels of ink and
          nobody can hit a few pixels, so the handle is thirty centimetres of
          transparent hit area sitting on top of it. */}
      {!readOnly && level.walls.map((wall, index) => {
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
                stroke={BLUE} strokeWidth={8} strokeDasharray="14 10"
              />
            )}
            <line
              className={wall.structural ? "pw-wall is-fixed" : "pw-wall is-grip"}
              x1={x} y1={y} x2={x + w} y2={y + h}
              stroke="transparent" strokeWidth={34}
              style={{
                cursor: wall.structural ? "not-allowed" : vertical ? "ew-resize" : "ns-resize",
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (!wall.structural) startWall(event, index);
              }}
            >
              <title>
                {wall.structural ? "Load-bearing — this wall doesn't move" : "Drag to move this wall"}
              </title>
            </line>
            {wall.structural && (
              <line
                x1={x} y1={y} x2={x + w} y2={y + h}
                stroke={INK} strokeWidth={14} pointerEvents="none"
              />
            )}
          </g>
        );
      })}

      {/* Overall dimensions, outside the envelope. */}
      <text x={level.w_cm / 2} y={-9} className="pw-dim" textAnchor="middle">
        {metres(level.w_cm)}
      </text>
      <text
        x={-11} y={level.h_cm / 2} className="pw-dim" textAnchor="middle"
        transform={`rotate(-90 ${-11} ${level.h_cm / 2})`}
      >
        {metres(level.h_cm)}
      </text>
    </svg>
  );
}
