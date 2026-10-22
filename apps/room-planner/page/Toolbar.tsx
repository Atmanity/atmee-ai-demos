import { useEffect, useState } from "react";

import type { RoomKindView as RoomKind, TypologyView as Typology } from "../engine/types.ts";

/**
 * The floor-level controls.
 *
 * Voice is still the fastest way to say "a two-bed with a study", but it is a
 * poor way to try four typologies in a row, and it is no way at all to work if
 * the client would rather not talk. Everything here is an intent the reducer
 * already accepts: the panel gained buttons, not authority.
 *
 * The rule that survives: **no control sends a coordinate.** The layout picker
 * sends a brief, "add room" sends a kind and a relation, and where anything
 * lands is still worked out by the solver. A drag is the only exception, and
 * only because a hand is pointing at a spot.
 */
export function Toolbar({
  typologies,
  roomKinds,
  busy,
  hasFloor,
  canAddLevel,
  widthCm,
  depthCm,
  onGenerate,
  onAddRoom,
  onResize,
  onAddLevel,
  onSaveScheme,
  onSheet,
}: {
  typologies: Typology[];
  roomKinds: RoomKind[];
  busy: boolean;
  hasFloor: boolean;
  canAddLevel: boolean;
  widthCm: number;
  depthCm: number;
  onGenerate: (brief: {
    bedrooms: number;
    style: string;
    office: boolean;
    dining: boolean;
    ensuite: boolean;
    wc: boolean;
    utility: boolean;
  }) => void;
  onAddRoom: (kind: string, near: string) => void;
  onResize: (widthCm: number, depthCm: number) => void;
  onAddLevel: () => void;
  onSaveScheme: (name: string) => void;
  onSheet: () => void;
}) {
  const [open, setOpen] = useState(!hasFloor);
  const [bedrooms, setBedrooms] = useState(2);
  const [style, setStyle] = useState(typologies[0]?.key ?? "day_night");
  const [extras, setExtras] = useState({
    office: false, dining: false, ensuite: false, wc: false, utility: false,
  });
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

  return (
    <section className="rp-tools" aria-label="Floor controls">
      <div className="rp-tools__row">
        <button
          type="button"
          className={`rp-btn${open ? " rp-btn--on" : ""}`}
          onClick={() => setOpen((was) => !was)}
        >
          {hasFloor ? "Redraw the floor" : "Lay out the floor"}
        </button>
        <button
          type="button"
          className="rp-btn rp-btn--ghost"
          disabled={busy || !hasFloor}
          onClick={() => onSaveScheme("")}
          title="Keep this plan as an alternative to compare against"
        >
          Save scheme
        </button>
        <button
          type="button"
          className="rp-btn rp-btn--ghost"
          disabled={busy || !canAddLevel}
          onClick={onAddLevel}
          title="Add a second storey"
        >
          + Floor
        </button>
        <button
          type="button"
          className="rp-btn rp-btn--ghost"
          disabled={busy || !hasFloor}
          onClick={onSheet}
          title="Draw up the sheet: the plan, areas and notes, ready to download"
        >
          Sheet
        </button>
      </div>

      {open && (
        <div className="rp-wizard">
          {/* The first thing a client wants to say is how big the place is.
              With only "Bedrooms" here, the avatar asked the question out loud
              and the panel gave nowhere to answer it — so a 50 m² flat came
              out at 63 and could not be brought down by clicking. */}
          <label className="rp-field">
            <span>Size (m)</span>
            <span className="rp-size">
              <input
                type="number"
                className="rp-num rp-num--slim"
                aria-label="Width in metres"
                min={2}
                max={20}
                step={0.5}
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
              />
              <span className="rp-size__by">×</span>
              <input
                type="number"
                className="rp-num rp-num--slim"
                aria-label="Depth in metres"
                min={2}
                max={20}
                step={0.5}
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
              />
            </span>
          </label>
          <p className="rp-wizard__note">
            About {Math.round(width * depth)} m² in total.
          </p>

          <label className="rp-field">
            <span>Bedrooms</span>
            <input
              type="number"
              className="rp-num"
              min={0}
              max={5}
              value={bedrooms}
              onChange={(event) => setBedrooms(Number(event.target.value))}
            />
          </label>

          <label className="rp-field">
            <span>Arrangement</span>
            <select
              className="rp-select"
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              {typologies.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {/* The typology's own sentence, shown rather than summarised: it is
              the difference between the four options, and a client choosing
              blind between four names is not choosing. */}
          {note && <p className="rp-wizard__note">{note}</p>}

          <div className="rp-wizard__extras">
            {(
              [
                ["office", "Study"],
                ["dining", "Dining room"],
                ["ensuite", "En suite"],
                ["wc", "WC"],
                ["utility", "Utility"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="rp-check">
                <input
                  type="checkbox"
                  checked={extras[key]}
                  onChange={(event) =>
                    setExtras((was) => ({ ...was, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </div>

          <button
            type="button"
            className="rp-btn rp-btn--primary"
            disabled={busy}
            onClick={() => {
              // Size first: generating into the old envelope and resizing
              // afterwards would refuse, because shrinking cuts into rooms.
              if (
                Math.round(width * 100) !== widthCm ||
                Math.round(depth * 100) !== depthCm
              ) {
                onResize(Math.round(width * 100), Math.round(depth * 100));
              }
              onGenerate({ bedrooms, style, ...extras });
              setOpen(false);
            }}
          >
            {hasFloor ? "Redraw" : "Draw it"}
          </button>
          {hasFloor && (
            <p className="rp-wizard__warn">
              This replaces everything on this floor. Undo brings it back.
            </p>
          )}
        </div>
      )}

      {hasFloor && (
        <div className="rp-tools__row">
          <select
            className="rp-select"
            aria-label="Room to add"
            value={newKind}
            onChange={(event) => setNewKind(event.target.value)}
          >
            {roomKinds.map((kind) => (
              <option key={kind.kind} value={kind.kind}>
                {kind.label}
              </option>
            ))}
          </select>
          <select
            className="rp-select"
            aria-label="Where to put it"
            value={newWhere}
            onChange={(event) => setNewWhere(event.target.value)}
          >
            <option value="center">middle</option>
            <option value="north_wall">north</option>
            <option value="south_wall">south</option>
            <option value="east_wall">east</option>
            <option value="west_wall">west</option>
          </select>
          <button
            type="button"
            className="rp-btn"
            disabled={busy}
            onClick={() => onAddRoom(newKind, newWhere)}
          >
            Add room
          </button>
        </div>
      )}
    </section>
  );
}
