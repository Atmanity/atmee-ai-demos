import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Intent, PlanSnapshot } from "../engine/types.ts";
import { AddPiece } from "./AddPiece.tsx";
import { FloorPlan } from "./FloorPlan.tsx";
import { RoomInspector } from "./RoomInspector.tsx";
import { Compare, Schedule } from "./Schedule.tsx";
import { Toolbar } from "./Toolbar.tsx";

/** One `send()` outcome: the planner applied the intent, or refused it with a sentence. */
export type SendResult = { applied: true } | { applied: false; reason: string };

export type Purpose = "room" | "piece";

/** The photo side of the panel: two uploads and a sample, read by the app's server. */
export interface Photos {
  onFile: (purpose: Purpose, file: File) => void;
  onSample: () => void;
  reading: Purpose | "sample" | null;
  error?: string | null;
  /** What the app saw in the last photo, and the photo itself. */
  last?: { seen: string; url: string; added: string[] } | null;
}

/**
 * The drawing board: the whole floor, what it adds up to, what is wrong with
 * it, and the edits a hand can make. Ported from the in-call panel; only the
 * data layer changed (props instead of the platform bridge).
 *
 * Everything rendered is the planner's snapshot. The panel decides nothing: it
 * cannot say whether a room may shrink, and it does not try; a drop is one
 * intent and a refusal comes back as a sentence to show.
 *
 * Every operation the architect can perform by voice is also a control here,
 * because a client who would rather not talk (or who wants to try four
 * arrangements in a row) should not be locked out of their own plan. What did
 * NOT change is the contract: a control sends a BRIEF or a RELATION (which
 * neighbour, which wall, how many square metres), never a coordinate. The two
 * drags are the only exception, and only because a hand is pointing at a spot.
 */
export function RoomPlanner({
  state,
  send,
  pending = false,
  photos,
  notice,
}: {
  state: PlanSnapshot | null;
  send: (intent: Intent) => SendResult | Promise<SendResult>;
  pending?: boolean;
  photos?: Photos;
  /** A refusal heard by voice, shown like a refused click. */
  notice?: { text: string; at: number } | null;
}) {
  const [message, setMessage] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => { if (notice) setMessage(notice.text); }, [notice]);

  const intend = useCallback(
    async (intent: Intent) => {
      const result = await send(intent);
      setMessage(result.applied ? "" : result.reason);
      return result.applied;
    },
    [send],
  );

  const select = useCallback((id: string) => void intend({ kind: "select", id }), [intend]);
  const moveItem = useCallback(
    (id: string, x: number, y: number) => void intend({ kind: "move_item", id, x, y }),
    [intend],
  );
  const moveWall = useCallback(
    (a: string, b: string, delta: number) => void intend({ kind: "move_wall", a, b, delta }),
    [intend],
  );

  // Two controls, two purposes: without the label the reader cannot tell the
  // room from the armchair.
  const roomPhoto = useUpload("room", photos);
  const piecePhoto = useUpload("piece", photos);

  // The sheet as a file the client can keep: the one thing the sandboxed
  // in-call panel could never do.
  const sheetUrl = useMemo(
    () => (state?.sheet?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.sheet.svg)}` : null),
    [state?.sheet?.svg],
  );
  useEffect(() => { if (sheetUrl) setSheetOpen(true); }, [sheetUrl]);

  if (!state) {
    return (
      <div className="rp-lobby" aria-live="polite">
        <span className="rp-spinner" />
        <span>Rolling out the plan…</span>
      </div>
    );
  }

  const { level, schedule, issues } = state;
  const selectedRoom = level.rooms.find((room) => room.id === state.selected) ?? null;
  const selectedItem = level.items.find((item) => item.id === state.selected) ?? null;
  const selectedIssues = issues.filter(
    (issue) => issue.room === state.selected || issue.item === state.selected,
  );

  return (
    <div className="rp-panel">
      {roomPhoto.input}
      {piecePhoto.input}

      <header className="rp-header">
        <span className="rp-title">Home planner</span>

        {/* A second storey is two drawings of one home, and the only way to be
            sure they are one home is the stairs. So the switcher says whether
            they line up: the one multi-level error a 2D plan hides completely. */}
        {state.levels.length > 1 && (
          <div className="rp-levels" role="tablist" aria-label="Floor">
            {state.levels.map((name, index) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={index === state.active}
                className={`rp-level${index === state.active ? " rp-level--on" : ""}`}
                disabled={pending}
                onClick={() => void intend({ kind: "go_to_level", id: name })}
              >
                {name === "ground" ? "Ground" : "Upstairs"}
              </button>
            ))}
            {!state.stairs_aligned && (
              <span className="rp-warn" title="The stairs don't line up">
                stairs ✕
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          className="rp-btn rp-btn--ghost"
          disabled={pending}
          title="Show areas in square metres or square feet"
          onClick={() => void intend({ kind: "set_unit", unit: state.unit === "m2" ? "ft2" : "m2" })}
        >
          {state.unit === "m2" ? "m²" : "ft²"}
        </button>

        {/* A wall dragged somewhere wrong, a room merged by mistake: without
            this all of it would be permanent. */}
        <button
          type="button"
          className="rp-btn rp-undo"
          disabled={pending || !state.can_undo}
          title={state.can_undo ? `Undo: ${state.last_change ?? "the last change"}` : "Nothing to undo yet"}
          onClick={() => void intend({ kind: "undo" })}
        >
          Undo
        </button>
      </header>

      <div className="rp-body">
        <div className="rp-stage">
          <FloorPlan
            level={level}
            selected={state.selected}
            unit={state.unit}
            onSelectItem={select}
            onSelectRoom={select}
            onMoveItem={moveItem}
            onMoveWall={moveWall}
            busy={pending}
          />
          <p className="rp-stage__hint">Drag a wall to move it. Tap a room to work on it.</p>
        </div>

        <div className="rp-side">
          <Toolbar
            typologies={state.typologies ?? []}
            roomKinds={state.room_kinds ?? []}
            busy={pending}
            hasFloor={level.rooms.length > 0}
            canAddLevel={state.levels.length < 2}
            widthCm={level.w_cm}
            depthCm={level.h_cm}
            onGenerate={(brief) => void intend({ kind: "generate", ...brief })}
            onAddRoom={(room_kind, near) => void intend({ kind: "add_room", room_kind, near })}
            onResize={(w, h) => void intend({ kind: "set_envelope", w, h })}
            onAddLevel={() => void intend({ kind: "add_level" })}
            onSaveScheme={(name) => void intend({ kind: "save_scheme", name })}
            onSheet={() => void intend({ kind: "draw_sheet" })}
          />

          {state.comparing ? (
            <Compare
              comparing={state.comparing}
              schedule={schedule}
              unit={state.unit}
              onClose={() => void intend({ kind: "compare_scheme", name: "off" })}
            />
          ) : (
            <Schedule schedule={schedule} selected={state.selected} onSelect={select} />
          )}

          {state.schemes.length > 0 && (
            <section className="rp-schemes" aria-label="Saved schemes">
              <h2 className="rp-side__title">Schemes</h2>
              <div className="rp-schemes__list">
                {state.schemes.map((scheme) => (
                  <div key={scheme.name} className="rp-scheme">
                    <span className="rp-scheme__name">{scheme.name}</span>
                    <span className="rp-scheme__meta">
                      {scheme.rooms} rooms · {scheme.total_m2} m² · {scheme.circulation_pct ?? 0}% hall
                    </span>
                    <span className="rp-scheme__actions">
                      <button
                        type="button"
                        className="rp-btn rp-btn--ghost rp-btn--tiny"
                        disabled={pending}
                        onClick={() => void intend({ kind: "compare_scheme", name: scheme.name })}
                      >
                        Compare
                      </button>
                      <button
                        type="button"
                        className="rp-btn rp-btn--ghost rp-btn--tiny"
                        disabled={pending}
                        title="Go back to this scheme (the plan on screen is replaced; undo brings it back)"
                        onClick={() => void intend({ kind: "load_scheme", name: scheme.name })}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="rp-btn rp-btn--ghost rp-btn--tiny"
                        disabled={pending}
                        title="Drop this scheme"
                        aria-label={`Drop ${scheme.name}`}
                        onClick={() => void intend({ kind: "drop_scheme", name: scheme.name })}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedRoom ? (
            <RoomInspector
              room={selectedRoom}
              level={level}
              roomKinds={state.room_kinds ?? []}
              unit={state.unit}
              issues={selectedIssues}
              busy={pending}
              onIntent={(intent) => void intend(intent as Intent)}
            />
          ) : (
            <section className="rp-selected">
              {selectedItem ? (
                <>
                  <div className="rp-selected__name">{selectedItem.label}</div>
                  <div className="rp-selected__size">
                    {selectedItem.w_cm} × {selectedItem.h_cm} cm
                  </div>
                  <div className="rp-actions">
                    <button
                      type="button"
                      className="rp-btn"
                      disabled={pending}
                      onClick={() => void intend({ kind: "rotate_item", id: selectedItem.id, deg: 90 })}
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      className="rp-btn rp-btn--danger"
                      disabled={pending}
                      onClick={() => void intend({ kind: "remove_item", id: selectedItem.id })}
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <div className="rp-selected__empty">Tap a room to work on it, or a piece to move it.</div>
              )}
              {selectedIssues.map((issue) => (
                <div key={`${issue.kind}-${issue.note}`} className="rp-selected__issue">
                  {issue.note}
                </div>
              ))}
            </section>
          )}

          <AddPiece
            catalog={state.catalog ?? []}
            rooms={level.rooms}
            activeRoom={selectedRoom?.id ?? null}
            busy={pending}
            onAdd={(type, room, near) => void intend({ kind: "add_item", type, room, near })}
          />

          <section className="rp-issues" aria-label="Worth knowing">
            <h2 className="rp-side__title">Worth knowing</h2>
            {issues.length === 0 ? (
              <p className="rp-side__none">Nothing outstanding.</p>
            ) : (
              <ul className="rp-issues__list">
                {issues.map((issue) => (
                  <li key={`${issue.room}-${issue.item}-${issue.kind}-${issue.note}`} className="rp-issue">
                    {issue.note}
                  </li>
                ))}
              </ul>
            )}
            {/* Said here as well as on the sheet, because the sheet can be
                shared and this list cannot, and the claim matters in both. */}
            <p className="rp-issues__note">Design guidance, not a building-regulations check.</p>
          </section>

          {photos && (
            <div className="rp-uploads">
              <button
                type="button"
                className="rp-btn"
                disabled={photos.reading !== null || !level.rooms.length}
                title="A photo of a room, so the pieces you already own go into the plan"
                onClick={roomPhoto.choose}
              >
                {photos.reading === "room" ? "Reading the room…" : "Photo of a room"}
              </button>
              {/* Having no photo to hand is the normal state of someone deciding
                  whether this is worth using; a sample lets them see it work, and
                  it is the one way in a test can open. */}
              <button
                type="button"
                className="rp-btn rp-btn--ghost"
                disabled={photos.reading !== null || !level.rooms.length}
                title="See it work with an example room"
                onClick={photos.onSample}
              >
                {photos.reading === "sample" ? "Reading the sample…" : "Try a sample"}
              </button>
              <button
                type="button"
                className="rp-btn"
                disabled={photos.reading !== null || !level.rooms.length}
                title="A photo of one piece of furniture you own"
                onClick={piecePhoto.choose}
              >
                {photos.reading === "piece" ? "Reading it…" : "Photo of a piece"}
              </button>
              {photos.error ? (
                <span className="rp-uploads__error" role="status">{photos.error}</span>
              ) : null}
              {photos.last ? (
                <figure className="rp-photo">
                  <img src={photos.last.url} alt="The photo the app read" />
                  <figcaption>
                    {photos.last.seen ? `Saw: ${photos.last.seen}. ` : ""}
                    {photos.last.added.length ? `Added: ${photos.last.added.join(", ")}.` : "Nothing from the kit to add."}
                  </figcaption>
                </figure>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* The drawing sheet, rendered by the page from the plan: shown here and
          offered as a file. */}
      {state.sheet && (
        <div className="rp-sheet">
          {state.sheet.status === "failed" && (
            <span className="rp-sheet__status rp-sheet__status--bad" role="status">
              {state.sheet.error}
            </span>
          )}
          {state.sheet.status === "ready" && sheetUrl && (
            <>
              <div className="rp-sheet__bar">
                <button type="button" className="rp-btn" onClick={() => setSheetOpen((open) => !open)}>
                  {sheetOpen ? "Hide the sheet" : "Show the drawing sheet"}
                </button>
                <a className="rp-btn rp-btn--ghost" href={sheetUrl} download={`home-plan-${state.sheet.floor ?? "floor"}.svg`}>
                  Download (SVG)
                </a>
              </div>
              {sheetOpen && <img className="rp-sheet__img" src={sheetUrl} alt="Drawing sheet" />}
            </>
          )}
        </div>
      )}

      {message && <div className="rp-message">{message}</div>}

      <p className="rp-hint">
        Just say it out loud: <em>"a two-bed with a study"</em>,{" "}
        <em>"give the living room two metres off the hall"</em>,{" "}
        <em>"save this one and try it open-plan"</em>.
      </p>
    </div>
  );
}

/** A hidden file input for one purpose, opened by a button. Uploads only: no camera. */
function useUpload(purpose: Purpose, photos?: Photos) {
  const ref = useRef<HTMLInputElement | null>(null);
  const input = photos ? (
    <input
      ref={ref}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      aria-label={purpose === "room" ? "Photo of a room" : "Photo of a piece"}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) photos.onFile(purpose, file);
      }}
    />
  ) : null;
  return { input, choose: () => ref.current?.click() };
}
