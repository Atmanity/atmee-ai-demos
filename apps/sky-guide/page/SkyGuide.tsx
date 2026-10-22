// The chart, and what the guide is talking about beside it. Ported from the
// original panel's SkyGuide.tsx; the data layer is now props (the view in,
// intents out) instead of the platform's useAppState.
//
// Everything rendered is the chart's snapshot. This component decides nothing:
// it cannot say whether a star is up, and it does not try; a tap or a button is
// one intent and a refusal comes back as a sentence to show.
//
// New in this port: the PLACE has a picker (the original moved it by voice
// only, which the API's ordering makes unreliable), the TIME has a scrubber
// across the night and a date, and each constellation figure has a button,
// so every action the guide's voice tools had now has a control.
import { useState } from "react";

import type { FigureStatus, Intent, SkyView } from "../engine/types.ts";
import { PLACES } from "../engine/sky.ts";
import { compassWord, heightWord } from "./projection.ts";
import { SkyDome } from "./SkyDome.tsx";

export function SkyGuide({
  view,
  message,
  pending = false,
  onIntent,
}: {
  view: SkyView;
  /** The last refusal, as the chart said it. */
  message: string;
  /** A spoken or typed request is being worked out. */
  pending?: boolean;
  onIntent: (intent: Intent) => void;
}) {
  const state = view.snapshot;
  const selected = state.visible.find((star) => star.id === state.selected) ?? null;

  return (
    <div className="sg-panel">
      <header className="sg-header">
        <div className="sg-when-block">
          <div className="sg-when-row">
            <h1 className="sg-place">{state.where.label}</h1>
            <span className="sg-when">{state.when.label}{view.solarTime ? " (solar time)" : ""}</span>
          </div>
          <p className="sg-held">
            The sky is held at this moment — it does not tick. Step it forward
            to watch the stars turn.
            {/* A new place keeps the instant (Taipei at 8 pm is Lisbon at noon),
                and the chart has no Sun to say so. */}
            {isDaytime(view) && (
              <>
                {" "}It is daytime there; the chart leaves out the Sun.{" "}
                <button type="button" className="sg-link" onClick={() => onIntent({ kind: "set_time", preset: "tonight" })}>Show tonight</button>
              </>
            )}
          </p>
        </div>
        <span className="sg-count">
          {state.visible.length} of {state.catalog_size} stars up
          {state.figure ? ` · ${state.figure.name}` : ""}
          {pending ? " · …" : ""}
        </span>
      </header>

      <div className="sg-controls">
        <PlacePicker view={view} onIntent={onIntent} />
        <TimeControl view={view} onIntent={onIntent} />
      </div>

      <div className="sg-body">
        <SkyDome state={state} onSelect={(id) => onIntent({ kind: "select", star: id })} busy={false} />

        <aside className="sg-side">
          {state.fact ? (
            <section className="sg-fact">
              <h2 className="sg-fact__title">{state.fact.title}</h2>
              {selected && (
                <p className="sg-fact__where">
                  {heightWord(selected.alt)} in the {compassWord(selected.az)}
                </p>
              )}
              {state.fact.lines.map((line) => (
                <p key={line} className="sg-fact__line">
                  {line}
                </p>
              ))}
              <button type="button" className="sg-btn" onClick={() => onIntent({ kind: "clear_selection" })}>
                Clear
              </button>
            </section>
          ) : (
            <section className="sg-fact sg-fact--empty">
              <p>Tap a star to ask about it.</p>
              <p className="sg-hint">
                Or just say it: <em>"what's that bright one"</em>,{" "}
                <em>"show me Orion"</em>, <em>"the sky from Lisbon"</em>,{" "}
                <em>"show me midnight"</em>.
              </p>
            </section>
          )}
          <Figures figures={view.figures} lit={state.figure?.con ?? null} onIntent={onIntent} />
        </aside>
      </div>

      {/* Shown whatever else is on screen: the guide is about to say the same
          sentence out loud, and the two agreeing is the whole contract. */}
      {message ? (
        <div className="sg-message" role="status">
          {message}
        </div>
      ) : null}
    </div>
  );
}

/** Between about 7 am and 5 pm on the place's clock. */
export const isDaytime = (view: SkyView) => view.night.hours < 17 || view.night.hours >= 31;

/** Where the observer stands: one of the catalogue's 41 places, or coordinates. */
function PlacePicker({ view, onIntent }: { view: SkyView; onIntent: (intent: Intent) => void }) {
  const [typing, setTyping] = useState(false);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const current = PLACES.find((place) => place.label === view.snapshot.where.label);
  return (
    <div className="sg-place-picker">
      <label className="sg-label" htmlFor="sg-place">Place</label>
      <select
        id="sg-place"
        className="sg-select"
        value={typing ? "coords" : current?.id ?? "here"}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "coords") return setTyping(true);
          setTyping(false);
          const place = PLACES.find((p) => p.id === value);
          if (place) onIntent({ kind: "set_place", label: place.label });
        }}
      >
        {!current && <option value="here">{view.snapshot.where.label}</option>}
        {PLACES.map((place) => (
          <option key={place.id} value={place.id}>{place.label}</option>
        ))}
        <option value="coords">Latitude and longitude…</option>
      </select>
      {typing && (
        <form
          className="sg-coords"
          onSubmit={(event) => {
            event.preventDefault();
            // The chart judges the numbers: out of range is a refusal, said out loud.
            onIntent({ kind: "set_place", lat, lon });
            setTyping(false);
          }}
        >
          <input className="sg-input" aria-label="Latitude" placeholder="lat, e.g. -33.9" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input className="sg-input" aria-label="Longitude" placeholder="lon, e.g. 18.4" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          <button type="submit" className="sg-step" disabled={!lat.trim() || !lon.trim()}>Go</button>
        </form>
      )}
    </div>
  );
}

const NIGHT_TICKS = [
  { at: 12, label: "noon" }, { at: 18, label: "6 pm" }, { at: 24, label: "midnight" }, { at: 30, label: "6 am" }, { at: 36, label: "noon" },
];

/** When: steps, presets, the hour across one night, and the night itself. */
function TimeControl({ view, onIntent }: { view: SkyView; onIntent: (intent: Intent) => void }) {
  const { night } = view;
  return (
    <div className="sg-time">
      <div className="sg-time-row">
        <span className="sg-label">Time</span>
        <button type="button" className="sg-step" aria-label="An hour earlier" title="An hour earlier" onClick={() => onIntent({ kind: "set_time", shiftHours: -1 })}>−1h</button>
        <button type="button" className="sg-step" aria-label="An hour later" title="An hour later" onClick={() => onIntent({ kind: "set_time", shiftHours: 1 })}>+1h</button>
        <button type="button" className="sg-step" aria-label="Back to this evening" title="Back to this evening" onClick={() => onIntent({ kind: "set_time", preset: "tonight" })}>Tonight</button>
        <button type="button" className="sg-step" title="The next midnight" onClick={() => onIntent({ kind: "set_time", preset: "midnight" })}>Midnight</button>
        <button type="button" className="sg-step" title="Five in the morning" onClick={() => onIntent({ kind: "set_time", preset: "dawn" })}>Before dawn</button>
        <label className="sg-night">
          <span className="sg-label">Night of</span>
          <input
            type="date"
            className="sg-input"
            min="1900-01-01"
            max="2099-12-31"
            value={night.date}
            onChange={(event) => { if (event.target.value) onIntent({ kind: "set_time", date: event.target.value }); }}
          />
        </label>
      </div>
      <div className="sg-scrub">
        <input
          type="range"
          aria-label="Hour of the night"
          min={12}
          max={36}
          step={0.25}
          value={night.hours}
          onChange={(event) => onIntent({ kind: "set_time", nightHours: Number(event.target.value) })}
        />
        <div className="sg-ticks" aria-hidden="true">
          {NIGHT_TICKS.map((tick) => (
            <span key={tick.at} style={{ left: `${((tick.at - 12) / 24) * 100}%` }}>{tick.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The eighteen figures: lit, up, or down with when it rises. A down one can
 *  still be pressed; the chart refuses it and says when it rises. */
function Figures({ figures, lit, onIntent }: { figures: FigureStatus[]; lit: string | null; onIntent: (intent: Intent) => void }) {
  return (
    <section className="sg-figures" aria-label="Constellations">
      <h3 className="sg-label">Constellations</h3>
      <div className="sg-figure-list">
        {figures.map((figure) => {
          const isLit = figure.con === lit;
          const where = figure.anchor ? `${heightWord(figure.anchor.alt)} in the ${compassWord(figure.anchor.az)}` : "";
          return (
            <button
              key={figure.con}
              type="button"
              className={`sg-figure${figure.up ? "" : " is-down"}${isLit ? " is-lit" : ""}`}
              aria-pressed={isLit}
              title={figure.up ? where : `Not up${figure.rise ? `: ${figure.rise}` : ""}`}
              onClick={() => onIntent(isLit ? { kind: "clear_figure" } : { kind: "show_constellation", name: figure.con })}
            >
              {figure.name}
            </button>
          );
        })}
      </div>
    </section>
  );
}
