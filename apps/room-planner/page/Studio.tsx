import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { noteIn } from "../engine/director.ts";
import type { Intent, PlanSnapshot } from "../engine/types.ts";
import { AddPiece } from "./AddPiece.tsx";
import { FloorPlan } from "./FloorPlan.tsx";
import { areaLabel, metres } from "./geometry.ts";
import { LayoutPanel } from "./LayoutPanel.tsx";
import { RoomInspector } from "./RoomInspector.tsx";
import { Compare, Schedule } from "./Schedule.tsx";

/** One `send()` outcome: the planner applied the intent, or refused it with a sentence. */
export type SendResult = { applied: true } | { applied: false; reason: string };

export type Purpose = "room" | "piece";

/** Bringing your own furniture: two uploads and a sample, read by the app's server. */
export interface Photos {
  onFile: (purpose: Purpose, file: File) => void;
  onSample: () => void;
  reading: Purpose | "sample" | null;
  error?: string | null;
  /** What the last photo showed, and what went in. */
  last?: { seen: string; url: string; added: string[] } | null;
}

type Tab = "layout" | "selected" | "furniture";

/**
 * The studio: the drawing sheet, the tools a hand can use on it, and what it
 * adds up to, with the architect beside it (`host`, `chat`).
 *
 * Everything rendered is the planner's snapshot. The studio decides nothing:
 * it cannot say whether a room may shrink, and it does not try; a drop is one
 * intent and a refusal comes back as a sentence to show.
 *
 * Every change the architect can make by voice is also a control here, because
 * a client who would rather not talk (or who wants to try four arrangements in
 * a row) should not be locked out of their own plan. A control sends a BRIEF
 * or a RELATION (which neighbour, which wall, how many square metres), never a
 * coordinate; the two drags are the only exception, because a hand is
 * pointing at a spot.
 */
export function Studio({
  state,
  send,
  photos,
  notice,
  sheetSignal = 0,
  host,
  chat,
  hostName = "Iris",
}: {
  state: PlanSnapshot | null;
  send: (intent: Intent) => SendResult | Promise<SendResult>;
  photos?: Photos;
  /** A refusal from the architect's tool, shown like a refused click. */
  notice?: { text: string; at: number } | null;
  /** Changes whenever the drawing sheet was drawn, so it opens. */
  sheetSignal?: number;
  host?: ReactNode;
  chat?: ReactNode;
  hostName?: string;
}) {
  const [message, setMessage] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<Tab>("layout");
  const trayRef = useRef<HTMLElement | null>(null);

  useEffect(() => { if (notice) setMessage(notice.text); }, [notice]);
  useEffect(() => {
    if (!sheetSignal) return;
    setSheetOpen(true);
    setPage(0);
  }, [sheetSignal]);
  // A redline note fades once it has been read.
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 12_000);
    return () => clearTimeout(id);
  }, [message]);
  // Tapping a room or a piece brings up what can be done to it.
  useEffect(() => { if (state?.selected) setTab("selected"); }, [state?.selected]);

  const intend = useCallback(
    async (intent: Intent) => {
      const result = await send(intent);
      setMessage(result.applied ? "" : result.reason);
      if (result.applied && intent.kind === "draw_sheet") {
        setSheetOpen(true);
        setPage(0);
      }
      return result.applied;
    },
    [send],
  );

  const select = useCallback((id: string) => void intend({ kind: "select", id }), [intend]);
  const moveItem = useCallback((id: string, x: number, y: number) => void intend({ kind: "move_item", id, x, y }), [intend]);
  const moveWall = useCallback((a: string, b: string, delta: number) => void intend({ kind: "move_wall", a, b, delta }), [intend]);

  // The sheet as a file the client can keep.
  // One page per floor that has rooms, the floor on screen first.
  const pages = useMemo(() => {
    const sheet = state?.sheet;
    if (!sheet || sheet.status !== "ready") return [];
    return sheet.pages?.length ? sheet.pages : sheet.svg ? [{ floor: sheet.floor ?? "ground", svg: sheet.svg }] : [];
  }, [state?.sheet]);
  const shown = pages[Math.min(page, pages.length - 1)] ?? null;
  const sheetUrl = useMemo(
    () => (shown ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown.svg)}` : null),
    [shown],
  );

  if (!state) {
    return (
      <div className="pw-loading" role="status">
        <span className="pw-spinner" aria-hidden="true" />
        <span>Pinning a fresh sheet to the board…</span>
      </div>
    );
  }

  const { level, schedule, issues } = state;
  const empty = level.rooms.length === 0;
  const upstairs = state.active > 0;
  const selectedRoom = level.rooms.find((room) => room.id === state.selected) ?? null;
  const selectedItem = level.items.find((item) => item.id === state.selected) ?? null;
  const selectedIssues = issues.filter((issue) => issue.room === state.selected || issue.item === state.selected);
  const floorName = level.name === "ground" ? "Ground floor" : "Upper floor";

  const openLayout = () => {
    setTab("layout");
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    trayRef.current?.scrollIntoView?.({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  };

  return (
    <div className="pw-studio">
      <div className="pw-bar">
        {/* A second storey is two drawings of one home, and the only way to be
            sure they are one home is the stairs. So the switcher says whether
            they line up: the one error a 2D plan hides completely. */}
        {state.levels.length > 1 ? (
          <div className="pw-segment" role="group" aria-label="Floor">
            {state.levels.map((name, index) => (
              <button
                key={name} type="button" aria-pressed={index === state.active}
                className={index === state.active ? "is-on" : undefined}
                onClick={() => void intend({ kind: "go_to_level", id: name })}
              >
                {name === "ground" ? "Ground" : "Upstairs"}
              </button>
            ))}
          </div>
        ) : (
          <span className="pw-bar-floor">{floorName}</span>
        )}
        {!state.stairs_aligned && <span className="pw-flag">The stairs don't line up</span>}
        <span className="pw-bar-meta">
          {metres(level.w_cm)} × {metres(level.h_cm)}
          {!empty && <> · {areaLabel(schedule.total_m2, state.unit)}</>}
        </span>
        <span className="pw-bar-tools">
          <span className="pw-segment" role="group" aria-label="Units">
            {(["m2", "ft2"] as const).map((unit) => (
              <button
                key={unit} type="button" aria-pressed={state.unit === unit}
                className={state.unit === unit ? "is-on" : undefined}
                onClick={() => state.unit !== unit && void intend({ kind: "set_unit", unit })}
              >
                {unit === "m2" ? "m²" : "ft²"}
              </button>
            ))}
          </span>
          {/* A wall dragged somewhere wrong, a room merged by mistake: without
              this all of it would be permanent. */}
          <button
            type="button" className="pw-secondary is-small" disabled={!state.can_undo}
            title={state.can_undo ? `Undo: ${state.last_change ?? "the last change"}` : "Nothing to undo yet"}
            onClick={() => void intend({ kind: "undo" })}
          >
            <UndoIcon /> Undo
          </button>
          <button
            type="button" className="pw-secondary is-small" disabled={empty}
            title="The plan, the area schedule and the notes, ready to download"
            onClick={() => void intend({ kind: "draw_sheet" })}
          >
            <SheetIcon /> Drawing sheet
          </button>
        </span>
      </div>

      <section className="pw-sheet" aria-label="The plan">
        <div className="pw-sheet-frame">
          <FloorPlan
            level={level} selected={state.selected} unit={state.unit}
            onSelectItem={select} onSelectRoom={select} onMoveItem={moveItem} onMoveWall={moveWall} busy={false}
          />
          {empty && (
            <div className="pw-empty">
              <p className="pw-eyebrow">{upstairs ? "The upper floor" : "A blank sheet"}</p>
              <h2>{metres(level.w_cm)} × {metres(level.h_cm)}, nothing drawn yet</h2>
              <p>
                {upstairs
                  ? `Tell ${hostName} how many bedrooms go up here, or lay it out yourself.`
                  : `Tell ${hostName} roughly how big your place is and how many bedrooms, and she'll sketch a whole floor to argue with. Or lay it out yourself.`}
              </p>
              <button type="button" className="pw-secondary" onClick={openLayout}>Lay it out by hand</button>
            </div>
          )}
          {message && (
            <div className="pw-redline" role="status">
              <span className="pw-redline-mark" aria-hidden="true">✕</span>
              <span>{message}</span>
              <button type="button" className="pw-quiet" onClick={() => setMessage("")} aria-label="Dismiss">OK</button>
            </div>
          )}
          {state.sheet && sheetOpen && (
            <div className="pw-sheetview" role="dialog" aria-label="Drawing sheet">
              {state.sheet.status === "failed" ? (
                <p className="pw-redline-note" role="status">{state.sheet.error}</p>
              ) : sheetUrl ? (
                <>
                  <div className="pw-sheetview-bar">
                    <strong>Drawing sheet · {shown?.floor === "upper" ? "Upper floor" : "Ground floor"}</strong>
                    {pages.length > 1 && (
                      <span className="pw-segment" role="group" aria-label="Sheet for">
                        {pages.map((p, index) => (
                          <button
                            key={p.floor} type="button" aria-pressed={p === shown} className={p === shown ? "is-on" : undefined}
                            onClick={() => setPage(index)}
                          >
                            {p.floor === "upper" ? "Upstairs" : "Ground"}
                          </button>
                        ))}
                      </span>
                    )}
                    <a className="pw-primary is-small" href={sheetUrl} download={`planwright-${shown?.floor ?? "floor"}.svg`}>
                      Download (SVG)
                    </a>
                    <button type="button" className="pw-secondary is-small" onClick={() => setSheetOpen(false)}>
                      Back to the plan
                    </button>
                  </div>
                  <img className="pw-sheetview-img" src={sheetUrl} alt="Drawing sheet" />
                </>
              ) : null}
            </div>
          )}
        </div>
        <footer className="pw-titleblock">
          <span><b>Planwright</b></span>
          <span>{floorName}</span>
          <span>1 square = 1 m²{state.unit === "ft2" ? " (10.8 ft²)" : ""}</span>
          <span className="pw-titleblock-change">
            {state.can_undo && state.last_change ? <>Last change: {state.last_change}</> : "Drag a wall or a piece to move it. Tap a room to work on it."}
          </span>
        </footer>
      </section>

      {(host || chat) && <aside className="pw-side" aria-label={`${hostName}, your architect`}>{host}{chat}</aside>}

      <section className="pw-tray" ref={trayRef} aria-label="Work on the plan">
        <div className="pw-tabs" role="tablist" aria-label="Ways to change the plan">
          <button type="button" role="tab" aria-selected={tab === "layout"} className={`pw-tab${tab === "layout" ? " is-on" : ""}`} onClick={() => setTab("layout")}>
            Lay out
          </button>
          <button type="button" role="tab" aria-selected={tab === "selected"} className={`pw-tab${tab === "selected" ? " is-on" : ""}`} onClick={() => setTab("selected")}>
            {selectedRoom?.name ?? selectedItem?.label ?? "Selected"}
          </button>
          <button type="button" role="tab" aria-selected={tab === "furniture"} className={`pw-tab${tab === "furniture" ? " is-on" : ""}`} onClick={() => setTab("furniture")}>
            Furniture
          </button>
        </div>

        <div className="pw-tray-body" role="tabpanel">
          {tab === "layout" && (
            <LayoutPanel
              typologies={state.typologies ?? []} roomKinds={state.room_kinds ?? []} busy={false}
              hasFloor={!empty} canAddLevel={state.levels.length < 2} upstairs={upstairs}
              widthCm={level.w_cm} depthCm={level.h_cm}
              onGenerate={(brief) => void intend({ kind: "generate", ...brief })}
              onAddRoom={(room_kind, near) => void intend({ kind: "add_room", room_kind, near })}
              onAddLevel={() => void intend({ kind: "add_level" })}
            />
          )}

          {tab === "selected" && (selectedRoom ? (
            <RoomInspector
              room={selectedRoom} level={level} roomKinds={state.room_kinds ?? []} unit={state.unit}
              issues={selectedIssues} busy={false} onIntent={(intent) => void intend(intent as Intent)}
            />
          ) : selectedItem ? (
            <section className="pw-inspector" aria-label={`${selectedItem.label} controls`}>
              <div className="pw-inspector-head">
                <strong className="pw-name">{selectedItem.label}</strong>
                <span className="pw-inspector-area">{selectedItem.w_cm} × {selectedItem.h_cm} cm</span>
              </div>
              <p className="pw-hint">Drag it on the plan to move it; it snaps to the 10 cm grid.</p>
              <div className="pw-actions">
                <button type="button" className="pw-chip" onClick={() => void intend({ kind: "rotate_item", id: selectedItem.id, deg: 90 })}>
                  Rotate
                </button>
                <button type="button" className="pw-chip is-danger" onClick={() => void intend({ kind: "remove_item", id: selectedItem.id })}>
                  Remove
                </button>
              </div>
              {selectedIssues.map((issue) => (
                <p key={`${issue.kind}-${issue.note}`} className="pw-redline-note">{issue.note}</p>
              ))}
            </section>
          ) : (
            <p className="pw-none">Tap a room or a piece on the plan to work on it.</p>
          ))}

          {tab === "furniture" && (
            <>
              <AddPiece
                catalog={state.catalog ?? []} rooms={level.rooms} activeRoom={selectedRoom?.id ?? null} busy={false}
                onAdd={(type, room, near) => void intend({ kind: "add_item", type, room, near })}
              />
              {photos && <BringYourOwn photos={photos} disabled={empty} />}
            </>
          )}
        </div>
      </section>

      <section className="pw-details" aria-label="What it adds up to">
        {state.comparing ? (
          <Compare comparing={state.comparing} schedule={schedule} unit={state.unit} onClose={() => void intend({ kind: "compare_scheme", name: "off" })} />
        ) : (
          <Schedule schedule={schedule} selected={state.selected} onSelect={select} />
        )}

        <section className="pw-block" aria-label="Worth knowing">
          <h2 className="pw-block-title">Worth knowing</h2>
          {issues.length === 0 ? (
            <p className="pw-none">{empty ? "Nothing to check yet." : "Nothing outstanding."}</p>
          ) : (
            <ul className="pw-issues">
              {issues.map((issue) => (
                <li key={`${issue.room}-${issue.item}-${issue.kind}-${issue.note}`}>{noteIn(issue.note, state.unit)}</li>
              ))}
            </ul>
          )}
          {/* Said here as well as on the sheet, because the sheet can be
              shared and this list cannot, and the claim matters in both. */}
          <p className="pw-hint">Design guidance, not a building-regulations check.</p>
        </section>

        <section className="pw-block" aria-label="Saved schemes">
          <header className="pw-block-head">
            <h2 className="pw-block-title">Schemes</h2>
            <span className="pw-count">{state.schemes.length} of 3</span>
          </header>
          {state.schemes.length === 0 ? (
            <p className="pw-none">Save this plan before trying another arrangement, then compare the two room by room.</p>
          ) : (
            <ul className="pw-schemes">
              {state.schemes.map((scheme) => (
                <li key={scheme.name}>
                  <span className="pw-scheme-name">{scheme.name}</span>
                  <span className="pw-scheme-meta">{scheme.rooms} rooms · {areaLabel(scheme.total_m2, state.unit)} · {scheme.circulation_pct ?? 0}% hall</span>
                  <span className="pw-scheme-actions">
                    <button type="button" className="pw-quiet" onClick={() => void intend({ kind: "compare_scheme", name: scheme.name })}>
                      Compare
                    </button>
                    <button
                      type="button" className="pw-quiet" title="Replace the plan with this scheme (undo brings the plan back)"
                      onClick={() => void intend({ kind: "load_scheme", name: scheme.name })}
                    >
                      Open
                    </button>
                    <button
                      type="button" className="pw-quiet is-danger" aria-label={`Drop ${scheme.name}`} title="Drop this scheme"
                      onClick={() => void intend({ kind: "drop_scheme", name: scheme.name })}
                    >
                      Drop
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button" className="pw-secondary" disabled={empty || state.schemes.length >= 3}
            title={state.schemes.length >= 3 ? "Three is the most; drop one to save another" : "Keep this plan to compare against"}
            onClick={() => void intend({ kind: "save_scheme", name: "" })}
          >
            Save this plan as a scheme
          </button>
        </section>
      </section>
    </div>
  );
}

/** Photos of furniture the client already owns, read into kit pieces at real sizes. */
function BringYourOwn({ photos, disabled }: { photos: Photos; disabled: boolean }) {
  const roomPhoto = useUpload("room", photos);
  const piecePhoto = useUpload("piece", photos);
  const busy = photos.reading !== null || disabled;
  return (
    <section className="pw-own" aria-label="Bring your own furniture">
      {roomPhoto.input}
      {piecePhoto.input}
      <h3 className="pw-label">Bring your own</h3>
      <p className="pw-hint">A photo of a room or a piece you own: what it shows goes in at the kit's real sizes, never guessed from the picture.</p>
      <div className="pw-actions">
        <button type="button" className="pw-chip" disabled={busy} onClick={roomPhoto.choose}>
          {photos.reading === "room" ? "Reading the room…" : "Photo of a room"}
        </button>
        <button type="button" className="pw-chip" disabled={busy} onClick={piecePhoto.choose}>
          {photos.reading === "piece" ? "Reading it…" : "Photo of a piece"}
        </button>
        {/* Having no photo to hand is the normal state of someone deciding
            whether this is worth using; our photo lets them see it work. */}
        <button type="button" className="pw-chip" disabled={busy} onClick={photos.onSample}>
          {photos.reading === "sample" ? "Reading our photo…" : "Try it with our photo"}
        </button>
      </div>
      {photos.error && <p className="pw-redline-note" role="status">{photos.error}</p>}
      {photos.last && (
        <figure className="pw-photo">
          <img src={photos.last.url} alt="The photo that was read" />
          <figcaption>
            {photos.last.seen ? `Saw ${photos.last.seen}. ` : ""}
            {photos.last.added.length ? `Added ${photos.last.added.join(", ")}.` : "Nothing from the kit to add."}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

/** A hidden file input for one purpose, opened by a button. Uploads only: no camera. */
function useUpload(purpose: Purpose, photos: Photos) {
  const ref = useRef<HTMLInputElement | null>(null);
  const input = (
    <input
      ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden
      aria-label={purpose === "room" ? "Photo of a room" : "Photo of a piece"}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) photos.onFile(purpose, file);
      }}
    />
  );
  return { input, choose: () => ref.current?.click() };
}

const icon = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const UndoIcon = () => <svg {...icon}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>;
const SheetIcon = () => <svg {...icon}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 17h6M9 13h6" /></svg>;
