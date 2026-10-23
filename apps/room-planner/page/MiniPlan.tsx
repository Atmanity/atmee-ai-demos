import { INK, PAPER, ROOM_FILL } from "./palette.ts";
import type { Thumb } from "../engine/types.ts";

/**
 * A saved scheme drawn small, for holding up beside the live plan.
 *
 * Room shapes and names only. It carries no furniture and no doors because it
 * arrives without them: a saved scheme keeps only room shapes, names and
 * areas, which is all a comparison needs to show which rooms grew. At this
 * size none of the rest would be legible anyway.
 */
export function MiniPlan({ thumb, label }: { thumb: Thumb; label: string }) {
  return (
    <figure className="pw-mini">
      <svg
        className="pw-mini-svg"
        viewBox={`0 0 ${thumb.w_cm} ${thumb.h_cm}`}
        role="img"
        aria-label={`${label}, for comparison`}
      >
        <rect x={0} y={0} width={thumb.w_cm} height={thumb.h_cm} fill={PAPER} />
        {thumb.rooms.map((room) =>
          room.rects.map(([x0, y0, x1, y1], index) => (
            <rect
              key={`${room.id}-${index}`}
              x={x0} y={y0} width={x1 - x0} height={y1 - y0}
              fill={ROOM_FILL[room.kind] ?? ROOM_FILL.other}
              stroke={INK} strokeWidth={6}
            />
          )),
        )}
      </svg>
      <figcaption className="pw-mini-cap">{label}, as saved</figcaption>
    </figure>
  );
}
