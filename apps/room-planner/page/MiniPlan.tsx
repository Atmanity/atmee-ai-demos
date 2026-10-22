import { ROOM_FILL } from "./palette.ts";
import type { Thumb } from "../engine/types.ts";

/**
 * A saved scheme drawn small, for holding up beside the live plan.
 *
 * Room shapes and names only. It carries no furniture and no doors because it
 * arrives without them: a saved scheme keeps only room shapes, names and
 * areas (in the original, to stay far under the in-call platform's 32 KiB
 * message cap), which is all a comparison needs to show which rooms grew.
 *
 * At this size none of the rest would be legible anyway, which is what makes
 * the trade a good one rather than merely a necessary one.
 */
export function MiniPlan({ thumb, label }: { thumb: Thumb; label: string }) {
  return (
    <figure className="rp-mini">
      <svg
        className="rp-mini__svg"
        viewBox={`0 0 ${thumb.w_cm} ${thumb.h_cm}`}
        role="img"
        aria-label={`${label}, for comparison`}
      >
        <rect x={0} y={0} width={thumb.w_cm} height={thumb.h_cm} fill="#fbfaf6" />
        {thumb.rooms.map((room) =>
          room.rects.map(([x0, y0, x1, y1], index) => (
            <rect
              key={`${room.id}-${index}`}
              x={x0} y={y0} width={x1 - x0} height={y1 - y0}
              fill={ROOM_FILL[room.kind] ?? ROOM_FILL.other}
              stroke="#1c3d5a" strokeWidth={6}
            />
          )),
        )}
      </svg>
      <figcaption className="rp-mini__cap">{label}</figcaption>
    </figure>
  );
}
