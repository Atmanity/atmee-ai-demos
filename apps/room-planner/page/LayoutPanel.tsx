import { useEffect, useState } from "react";

import type { RoomKindView as RoomKind, TypologyView as Typology } from "../engine/types.ts";

export interface Brief {
  bedrooms: number;
  style: string;
  office: boolean;
  dining: boolean;
  ensuite: boolean;
  wc: boolean;
  utility: boolean;
  /** The size of the place, in centimetres, when it changes with the brief. */
  w?: number;
  h?: number;
}

/**
 * Laying a floor out by hand: the size of the place, the brief, the
 * arrangement, and a room at a time after that.
 *
 * Talking is still the fastest way to say "a two-bed with a study", but it is a
 * poor way to try four arrangements in a row, and no way at all to work for a
 * client who would rather not talk. Everything here is an intent the planner
 * already accepts: the panel gained buttons, not authority.
 *
 * The rule that survives: **no control sends a coordinate.** The layout sends
 * a brief, "add a room" sends a kind and a relation, and where anything lands
 * is worked out by the planner.
 */
export function LayoutPanel({
  typologies,
  roomKinds,
  busy,
  hasFloor,
  canAddLevel,
  upstairs,
  widthCm,
  depthCm,
  onGenerate,
  onAddRoom,
  onAddLevel,
}: {
  typologies: Typology[];
  roomKinds: RoomKind[];
  busy: boolean;
  hasFloor: boolean;
  canAddLevel: boolean;
  upstairs: boolean;
  widthCm: number;
  depthCm: number;
  onGenerate: (brief: Brief) => void;
  onAddRoom: (kind: string, near: string) => void;
  onAddLevel: () => void;
}) {
  const [bedrooms, setBedrooms] = useState(2);
  const [style, setStyle] = useState(typologies[0]?.key ?? "day_night");
  const [extras, setExtras] = useState({ office: false, dining: false, ensuite: false, wc: false, utility: false });
  const [newKind, setNewKind] = useState("bedroom");
  const [newWhere, setNewWhere] = useState("center");
  // Metres, because nobody says "nine hundred centimetres" about a home.
  const [width, setWidth] = useState(widthCm / 100);
  const [depth, setDepth] = useState(depthCm / 100);

  // The floor can be resized by voice too, and a box still showing what the
  // client typed five minutes ago is a box that lies.
  useEffect(() => {
    setWidth(widthCm / 100);
    setDepth(depthCm / 100);
  }, [widthCm, depthCm]);

  const note = typologies.find((entry) => entry.key === style)?.note;
  const w = Math.round(width * 100), h = Math.round(depth * 100);
  const resized = w !== widthCm || h !== depthCm;

  return (
    <div className="pw-layout">
      <form
        className="pw-brief"
        aria-label="Lay out the floor"
        onSubmit={(event) => {
          event.preventDefault();
          // The size travels WITH the brief: resizing first as its own step
          // refused any shrink, and the layout then went ahead at the old size.
          onGenerate({ bedrooms, style, ...extras, ...(resized ? { w, h } : {}) });
        }}
      >
        {/* The first thing a client wants to say is how big the place is.
            With only "Bedrooms" here, a 50 m² flat came out at 63 and could
            not be brought down by clicking. */}
        <div className="pw-field">
          <span className="pw-label" id="pw-size-label">Size of the place</span>
          <span className="pw-size" role="group" aria-labelledby="pw-size-label">
            <input
              type="number" className="pw-input is-num" aria-label="Width in metres"
              min={2} max={20} step={0.5} value={width} disabled={upstairs}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
            <span aria-hidden="true">×</span>
            <input
              type="number" className="pw-input is-num" aria-label="Depth in metres"
              min={2} max={20} step={0.5} value={depth} disabled={upstairs}
              onChange={(event) => setDepth(Number(event.target.value))}
            />
            <span className="pw-unit">m · about {Math.round(width * depth)} m²</span>
          </span>
        </div>

        <label className="pw-field">
          <span className="pw-label">Bedrooms</span>
          <input
            type="number" className="pw-input is-num" min={1} max={5} value={bedrooms}
            onChange={(event) => setBedrooms(Number(event.target.value))}
          />
        </label>

        {!upstairs && (
          <label className="pw-field">
            <span className="pw-label">Arrangement</span>
            <select className="pw-input" value={style} onChange={(event) => setStyle(event.target.value)}>
              {typologies.map((entry) => (
                <option key={entry.key} value={entry.key}>{entry.label}</option>
              ))}
            </select>
          </label>
        )}

        {/* The arrangement's own sentence, shown rather than summarised: it is
            the difference between the four options, and a client choosing
            blind between four names is not choosing. */}
        {note && !upstairs && <p className="pw-note">{note}</p>}

        <fieldset className="pw-extras">
          <legend className="pw-label">Also</legend>
          {(
            [
              ["office", "Study"],
              ["dining", "Dining room"],
              ["ensuite", "En suite"],
              ["wc", "WC"],
              ["utility", "Utility"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="pw-check">
              <input
                type="checkbox" checked={extras[key]}
                onChange={(event) => setExtras((was) => ({ ...was, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div className="pw-row">
          <button type="submit" className="pw-primary" disabled={busy}>
            {hasFloor ? "Redraw the floor" : "Draw it"}
          </button>
          {hasFloor && <span className="pw-hint">Replaces this floor. Undo brings it back.</span>}
        </div>
      </form>

      <div className="pw-layout-more">
        {hasFloor && (
          <div className="pw-field">
            <span className="pw-label">Add a room</span>
            <div className="pw-row">
              <select className="pw-input" aria-label="Room to add" value={newKind} onChange={(event) => setNewKind(event.target.value)}>
                {roomKinds.map((kind) => (
                  <option key={kind.kind} value={kind.kind}>{kind.label}</option>
                ))}
              </select>
              <select className="pw-input" aria-label="Where to put it" value={newWhere} onChange={(event) => setNewWhere(event.target.value)}>
                <option value="center">in the middle</option>
                <option value="north_wall">to the north</option>
                <option value="south_wall">to the south</option>
                <option value="east_wall">to the east</option>
                <option value="west_wall">to the west</option>
              </select>
              <button type="button" className="pw-secondary" disabled={busy} onClick={() => onAddRoom(newKind, newWhere)}>
                Add room
              </button>
            </div>
          </div>
        )}
        {canAddLevel && (
          <div className="pw-field">
            <span className="pw-label">A house?</span>
            <button type="button" className="pw-secondary" disabled={busy || !hasFloor} onClick={onAddLevel}>
              Add an upper floor
            </button>
            <span className="pw-hint">The stairs go in on both floors, lined up.</span>
          </div>
        )}
      </div>
    </div>
  );
}
