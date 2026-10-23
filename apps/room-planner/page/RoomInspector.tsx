import { useEffect, useMemo, useState } from "react";

import { areaLabel } from "./geometry.ts";
import type { Issue, Level, Room, RoomKindView as RoomKind } from "../engine/types.ts";

/**
 * Everything you can do to the selected room, without saying a word.
 *
 * The verbs here are the negotiation: trade floor with the room next door,
 * grow into what is spare, split, merge, swap, put a door through, cut a
 * window. Each one is the intent the architect's tool sends, so the two paths
 * cannot drift — and each is expressed the way she has to express it, as a
 * NEIGHBOUR and an AMOUNT rather than a position.
 *
 * The neighbour lists come from `level.walls`, which the planner publishes. That
 * matters: a control offering "trade with the kitchen" when the two rooms do
 * not touch is a button whose only outcome is a refusal.
 */
export function RoomInspector({
  room,
  level,
  roomKinds,
  unit,
  issues,
  busy,
  onIntent,
}: {
  room: Room;
  level: Level;
  roomKinds: RoomKind[];
  unit: "m2" | "ft2";
  issues: Issue[];
  busy: boolean;
  onIntent: (intent: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(room.name);
  const [trade, setTrade] = useState("");
  const [amount, setAmount] = useState(1);

  // The selection can change under this component, and a stale name in the box
  // would rename the wrong room the moment anyone pressed enter.
  useEffect(() => {
    setName(room.name);
    setTrade("");
  }, [room.id, room.name]);

  const neighbours = useMemo(() => {
    const ids = new Set<string>();
    for (const wall of level.walls) {
      if (wall.a === room.id) ids.add(wall.b);
      if (wall.b === room.id) ids.add(wall.a);
    }
    return level.rooms.filter((other) => ids.has(other.id));
  }, [level.walls, level.rooms, room.id]);

  const target = trade || neighbours[0]?.id || "";
  const targetName = nameOf(level, target);
  const exteriorWalls = useMemo(() => whichWallsAreOutside(room, level), [room, level]);
  const unitLabel = unit === "ft2" ? "ft²" : "m²";

  return (
    <section className="pw-inspector" aria-label={`${room.name} controls`}>
      <div className="pw-inspector-head">
        <input
          className="pw-input pw-name"
          value={name}
          aria-label="Room name"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name !== room.name && onIntent({ kind: "rename_room", id: room.id, name })}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
        <span className="pw-inspector-area">{areaLabel(room.area_m2, unit)}</span>
      </div>

      <label className="pw-field">
        <span className="pw-label">Used as</span>
        <select
          className="pw-input"
          value={room.kind}
          disabled={busy}
          onChange={(event) => onIntent({ kind: "rename_room", id: room.id, room_kind: event.target.value })}
        >
          {roomKinds.map((entry) => (
            <option key={entry.kind} value={entry.kind}>{entry.label}</option>
          ))}
        </select>
      </label>

      {/* The trade. Square metres, not centimetres — it is the unit a client
          argues in, and the wall movement that delivers it is worked out. */}
      {neighbours.length > 0 && (
        <div className="pw-field pw-trade">
          <span className="pw-label">Trade floor with a neighbour</span>
          <div className="pw-row">
            <input
              type="number" className="pw-input is-num" min={0.5} step={0.5} value={amount}
              aria-label={unit === "ft2" ? "Square feet to move" : "Square metres to move"}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
            <span className="pw-unit">{unitLabel}</span>
            <select
              className="pw-input" aria-label="Which room to trade with" value={target}
              onChange={(event) => setTrade(event.target.value)}
            >
              {neighbours.map((other) => (
                <option key={other.id} value={other.id}>{other.name}</option>
              ))}
            </select>
          </div>
          <div className="pw-row">
            <button
              type="button" className="pw-secondary" disabled={busy || !target || !(amount > 0)}
              onClick={() => onIntent({ kind: "trade_area", from: target, to: room.id, m2: toM2(amount, unit) })}
            >
              Take from the {targetName}
            </button>
            <button
              type="button" className="pw-secondary" disabled={busy || !target || !(amount > 0)}
              onClick={() => onIntent({ kind: "trade_area", from: room.id, to: target, m2: toM2(amount, unit) })}
            >
              Give to the {targetName}
            </button>
          </div>
        </div>
      )}

      <div className="pw-actions">
        <button
          type="button" className="pw-chip" disabled={busy} title="Grow into floor that is in no room"
          onClick={() => onIntent({ kind: "grow_room", id: room.id, m2: toM2(amount, unit) })}
        >
          Grow into spare floor
        </button>
        <button
          type="button" className="pw-chip" disabled={busy} title="Cut this room in two across its long side"
          onClick={() => onIntent({ kind: "split_room", id: room.id, room_kind: "other" })}
        >
          Divide
        </button>
        {neighbours.length > 0 && (
          <>
            <button
              type="button" className="pw-chip" disabled={busy || !target}
              title={`Take the wall out between this and the ${targetName}`}
              onClick={() => onIntent({ kind: "merge_rooms", a: room.id, b: target })}
            >
              Knock through
            </button>
            <button
              type="button" className="pw-chip" disabled={busy || !target}
              title="Swap what the two rooms are, leaving the walls alone"
              onClick={() => onIntent({ kind: "swap_rooms", a: room.id, b: target })}
            >
              Swap over
            </button>
            <button
              type="button" className="pw-chip" disabled={busy || !target}
              onClick={() => onIntent({ kind: "add_door", a: room.id, b: target })}
            >
              Door through
            </button>
            <button
              type="button" className="pw-chip" disabled={busy || !target}
              title="Mark that wall load-bearing so it stops moving"
              onClick={() => onIntent({ kind: "mark_structural", a: room.id, b: target })}
            >
              Wall is load-bearing
            </button>
          </>
        )}
        <button
          type="button" className="pw-chip is-danger" disabled={busy}
          onClick={() => onIntent({ kind: "remove_room", id: room.id })}
        >
          Remove room
        </button>
      </div>

      {/* Only the walls this room actually reaches. Offering a window on a wall
          the room does not touch is a button whose only outcome is a refusal. */}
      {exteriorWalls.length > 0 && (
        <div className="pw-field">
          <span className="pw-label">Window on the outside wall</span>
          <div className="pw-actions">
            {exteriorWalls.map((wall) => (
              <button
                key={wall} type="button" className="pw-chip" disabled={busy}
                onClick={() => onIntent({ kind: "add_window", id: room.id, wall })}
              >
                {wall}
              </button>
            ))}
            <button
              type="button" className="pw-chip" disabled={busy} title="Put the front door in this room"
              onClick={() => onIntent({ kind: "add_front_door", id: room.id, wall: exteriorWalls[0] })}
            >
              Front door here
            </button>
          </div>
        </div>
      )}

      {issues.map((issue) => (
        <p key={`${issue.kind}-${issue.note}`} className="pw-redline-note">{issue.note}</p>
      ))}
    </section>
  );
}

/**
 * The number the client typed, in square metres for the planner.
 *
 * The box used to be labelled m² whatever the schedule said, so a client
 * reading the plan in square feet typed a square-feet number into a metric
 * field and got a trade twelve times the size they meant.
 */
function toM2(value: number, unit: "m2" | "ft2"): number {
  return unit === "ft2" ? Number((value / 10.7639).toFixed(2)) : value;
}

function nameOf(level: Level, id: string): string {
  return level.rooms.find((room) => room.id === id)?.name.toLowerCase() ?? "room";
}

/**
 * Which sides of the building this room actually reaches.
 *
 * Read off the room's own rectangles against the envelope, which is display
 * logic rather than a second opinion: the planner still refuses a window the
 * room cannot have. This only decides which buttons are worth offering.
 */
function whichWallsAreOutside(room: Room, level: Level): string[] {
  const out: string[] = [];
  const touches = (test: (rect: number[]) => boolean) => room.rects.some(test);
  if (touches((r) => r[1] <= 0)) out.push("north");
  if (touches((r) => r[3] >= level.h_cm)) out.push("south");
  if (touches((r) => r[0] <= 0)) out.push("west");
  if (touches((r) => r[2] >= level.w_cm)) out.push("east");
  return out;
}
