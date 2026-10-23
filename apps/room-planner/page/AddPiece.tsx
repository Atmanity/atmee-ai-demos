import { useMemo, useState } from "react";

import type { CatalogEntry, Room } from "../engine/types.ts";

/**
 * The furniture picker.
 *
 * Asking out loud is still the nicer way to say "a queen bed by the window". It
 * is a poor way to browse two dozen pieces, or to add a fourth chair.
 *
 * The kit comes from the planner's snapshot rather than living here: two lists
 * of furniture dimensions is two chances for the drawing and the rules to
 * disagree about how big a queen bed is. And the picker sends a TYPE and a
 * ROOM, never a position — where it goes is still the planner's job.
 */

const FAMILY_ORDER = ["Beds", "Seating", "Tables", "Storage", "Soft"];

export function AddPiece({
  catalog,
  rooms,
  activeRoom,
  busy,
  onAdd,
}: {
  catalog: CatalogEntry[];
  rooms: Room[];
  activeRoom: string | null;
  busy: boolean;
  onAdd: (type: string, room: string, near: string) => void;
}) {
  const [family, setFamily] = useState(FAMILY_ORDER[0]);
  const [room, setRoom] = useState<string>("");
  const [near, setNear] = useState("center");

  const families = useMemo(() => {
    const present = new Set(catalog.map((entry) => entry.family));
    return FAMILY_ORDER.filter((name) => present.has(name));
  }, [catalog]);

  // The room the client last touched is almost always the one they mean, so it
  // is the default — but it stays overridable, because "put a chair in the
  // study" while looking at the kitchen is a perfectly ordinary thing to want.
  const target = (rooms.some((r) => r.id === room) ? room : "") || activeRoom || rooms[0]?.id || "";

  if (catalog.length === 0 || rooms.length === 0) {
    return <p className="pw-none">Lay the rooms out first, then you can furnish them.</p>;
  }

  return (
    <section className="pw-add" aria-label="Add furniture">
      <div className="pw-row">
        <select className="pw-input" aria-label="Room" value={target} onChange={(event) => setRoom(event.target.value)}>
          {rooms.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
        <select className="pw-input" aria-label="Where in the room" value={near} onChange={(event) => setNear(event.target.value)}>
          <option value="center">in the middle</option>
          <option value="window">by a window</option>
          <option value="door">by the door</option>
          <option value="north_wall">against the north wall</option>
          <option value="south_wall">against the south wall</option>
          <option value="east_wall">against the east wall</option>
          <option value="west_wall">against the west wall</option>
        </select>
      </div>

      <div className="pw-tabs is-small" role="tablist" aria-label="Kind of furniture">
        {families.map((name) => (
          <button
            key={name} type="button" role="tab" aria-selected={name === family}
            className={`pw-tab${name === family ? " is-on" : ""}`}
            onClick={() => setFamily(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="pw-pieces">
        {catalog
          .filter((entry) => entry.family === family)
          .map((entry) => (
            <button
              key={entry.type} type="button" className="pw-piece-btn" disabled={busy || !target}
              title={`Add a ${entry.label.toLowerCase()} (${entry.w_cm} × ${entry.h_cm} cm)`}
              onClick={() => onAdd(entry.type, target, near)}
            >
              <span className="pw-piece-name">{entry.label}</span>
              <span className="pw-piece-size">{entry.w_cm} × {entry.h_cm}</span>
            </button>
          ))}
      </div>
    </section>
  );
}
