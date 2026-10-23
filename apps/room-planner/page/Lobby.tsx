// Planwright's front door: what it is, how it works, and the way in, with a
// real plan (laid out and traded by the planner itself) as the picture.
import { BackToApps } from "../../../src/kit/index.ts";
import { useMemo } from "react";

import portrait from "../host/portrait.jpg";
import { FloorPlan } from "./FloorPlan.tsx";
import { areaLabel, metres } from "./geometry.ts";
import { lobbySample } from "./sample.ts";

/** The mark: a room in plan, its door swinging open. */
export function Logo({ href = "./" }: { href?: string }) {
  return (
    <a className="pw-logo" href={href} aria-label="Planwright home">
      <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
        <path d="M18 28H28V4H4V28H8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
        <path d="M8 28V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M18 28A10 10 0 0 0 8 18" fill="none" stroke="var(--pw-redline)" strokeWidth="2" strokeDasharray="2.6 2.2" />
      </svg>
      <span>Planwright</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ["Say the size and who lives there", "Iris sketches a whole floor in seconds: rooms, hall, doors and windows. A starting point to argue with."],
  ["Argue with it", "Give the bedroom a metre off the hall, knock through, add a window, put a queen bed by it. Every change comes back with the plan's real numbers, or the reason it won't work."],
  ["Keep the one you like", "Save up to three schemes, compare them room by room, and download the drawing sheet."],
];

const CHECKS = [
  "Every room reachable without walking through another",
  "Ninety centimetres to pass in a hall",
  "Daylight where people sit",
  "Furniture at real sizes, with room to open the doors",
];

export function Lobby({ onStart, host = "Iris" }: { onStart: (mic: boolean) => void; host?: string }) {
  const sample = useMemo(() => lobbySample(), []);
  return (
    <div className="pw-lobby">
      <header className="pw-top is-lobby"><BackToApps /><Logo /></header>
      <main className="pw-hero">
        <div className="pw-hero-copy">
          {/* Who you will be talking to, pinned like a photo on the board. */}
          <p className="pw-host-tag">
            <img src={portrait} alt="" width={44} height={44} />
            <span>
              <span className="pw-host-tag-role">Your architect</span>
              <b>{host}</b>
            </span>
          </p>
          <p className="pw-eyebrow">A home planner you talk to</p>
          <h1>Talk your home into shape.</h1>
          <p className="pw-lede">
            Tell {host}, an AI architect, roughly how big your place is and who lives there, and she draws a whole floor while you talk. Then you argue with it, the way you would at a real drawing board.
          </p>
          <div className="pw-cta">
            <button type="button" className="pw-primary is-big" onClick={() => onStart(true)}>Start talking to {host}</button>
            <button type="button" className="pw-secondary is-big" onClick={() => onStart(false)}>Start by typing</button>
          </div>
          <p className="pw-small">Talking uses your microphone while the call is on. You can drag walls and furniture by hand at any time.</p>
        </div>

        <figure className="pw-hero-plan">
          <div className="pw-hero-sheet">
            <FloorPlan
              level={sample.level} selected={sample.selected} unit="m2" readOnly busy
              onSelectItem={() => {}} onSelectRoom={() => {}} onMoveItem={() => {}} onMoveWall={() => {}}
              label="An example plan: two bedrooms and a study on a nine by seven metre floor"
            />
            {sample.exchange && (
              <div className="pw-hero-talk" aria-label="An example exchange">
                <p className="pw-bubble is-client">{sample.exchange.client}</p>
                <p className="pw-bubble is-host"><b>{host}</b>{sample.exchange.architect}</p>
              </div>
            )}
          </div>
          <figcaption className="pw-titleblock">
            <span><b>Example</b></span>
            <span>Two bedrooms and a study</span>
            <span>{metres(sample.level.w_cm)} × {metres(sample.level.h_cm)} · {areaLabel(sample.total_m2, "m2")}</span>
          </figcaption>
        </figure>
      </main>

      <section className="pw-steps" aria-label="How it works">
        {STEPS.map(([title, text], i) => (
          <article key={title}>
            <span className="pw-step-n">0{i + 1}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="pw-checks" aria-label="What she watches for">
        <h2>What {host} watches for</h2>
        <ul>
          {CHECKS.map((check) => <li key={check}>{check}</li>)}
        </ul>
        <p className="pw-small">Design guidance, not a building-regulations check.</p>
      </section>
    </div>
  );
}
