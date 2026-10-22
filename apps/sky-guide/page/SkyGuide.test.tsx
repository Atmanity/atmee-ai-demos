// @vitest-environment jsdom
/**
 * The panel as a projection: a view in, intents out, nothing decided here.
 * Ported from the original panel's SkyGuide.test.tsx; the scripted agent is
 * now a props spy, since the chart runs in the page.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FigureStatus, Intent, SkySnapshot, SkyView } from "../engine/types.ts";
import { SkyGuide } from "./SkyGuide.tsx";

const SIRIUS = { id: "sirius", name: "Sirius", alt: 34.2, az: 128.5, mag: -1.46, con: "CMa" };
const VEGA = { id: "vega", name: "Vega", alt: 71.4, az: 12.0, mag: 0.03, con: "Lyr" };

function snapshot(over: Partial<SkySnapshot> = {}): SkySnapshot {
  return {
    where: { label: "Taipei", lat: 25.03, lon: 121.56 },
    when: { epoch: 1785931200, label: "9:00 pm, Wed 5 Aug" },
    visible: [SIRIUS, VEGA],
    figure: null,
    selected: null,
    fact: null,
    catalog_size: 137,
    ...over,
  };
}

const FIGURES: FigureStatus[] = [
  { con: "Lyr", name: "Lyra", up: true, anchor: VEGA, rise: "" },
  { con: "Ori", name: "Orion", up: false, anchor: null, rise: "it rises about half past 2 in the morning" },
];

function view(over: Partial<SkySnapshot> = {}, figures = FIGURES): SkyView {
  return { snapshot: snapshot(over), figures, spokenWhen: "about 9 in the evening", solarTime: false, night: { date: "2026-08-05", hours: 21 } };
}

function setup(v: SkyView = view(), message = "") {
  const intents: Intent[] = [];
  const utils = render(<SkyGuide view={v} message={message} onIntent={(intent) => intents.push(intent)} />);
  return { intents, ...utils };
}

/**
 * jsdom has no `PointerEvent`, so `fireEvent.pointerDown` silently drops
 * `clientX`/`clientY` and every tap lands at NaN — which reads in a failure as
 * "the handler never fired". A `MouseEvent` named `pointerdown` carries the
 * coordinates and React dispatches it the same way.
 */
function tapAt(element: Element, x: number, y: number) {
  fireEvent(element, new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
}

/** jsdom measures every element as zero, so the dome would have no radius and
 *  every tap would miss. This is the box the canvas pretends to be. */
function sizeTheCanvas(width = 300, height = 300) {
  const box = () => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) });
  Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", { configurable: true, value: box });
  Object.defineProperty(HTMLDivElement.prototype, "getBoundingClientRect", { configurable: true, value: box });
}

beforeAll(() => {
  // jsdom has no 2D context; the dome must still render its text and stay tappable.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterEach(cleanup);

describe("SkyGuide", () => {
  it("draws the place, the clock and how much of the sky is up, at once (no sync to wait for)", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Taipei" })).toBeTruthy();
    expect(screen.getByText("9:00 pm, Wed 5 Aug")).toBeTruthy();
    expect(screen.getByText(/2 of 137 stars up/)).toBeTruthy();
  });

  it("turns a tap on a star into one select intent and nothing else", async () => {
    sizeTheCanvas();
    const { intents, container } = setup();
    const canvas = container.querySelector("canvas")!;
    // Vega is at altitude 71.4 and azimuth 12, which on a 300-square dome is
    // just above and a little left of centre.
    const r = ((90 - 71.4) / 90) * 132; // domeFor(300, 300) pads by 18
    const x = 150 - r * Math.sin((12 * Math.PI) / 180);
    const y = 150 - r * Math.cos((12 * Math.PI) / 180);
    await act(async () => tapAt(canvas, x, y));
    expect(intents).toEqual([{ kind: "select", star: "vega" }]);
  });

  it("does not send anything for a tap on empty sky", async () => {
    sizeTheCanvas();
    const { intents, container } = setup();
    await act(async () => tapAt(container.querySelector("canvas")!, 2, 2));
    expect(intents).toEqual([]);
  });

  it("reaches every star from the keyboard too (the canvas is invisible to a screen reader)", () => {
    const { intents } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Sirius" }));
    expect(intents).toEqual([{ kind: "select", star: "sirius" }]);
  });

  it("shows the chart's refusal instead of pretending the tap worked", () => {
    setup(view(), "Sirius is below the horizon from there right now.");
    expect(screen.getByRole("status").textContent).toMatch(/below the horizon/);
  });

  it("renders the fact the chart chose, never one of its own, with where to look in words", () => {
    const { intents } = setup(view({ selected: "sirius", fact: { title: "Sirius", lines: ["Brightest star in the night sky."] } }));
    expect(screen.getByText("Brightest star in the night sky.")).toBeTruthy();
    // The same words the avatar uses out loud, not degrees.
    expect(screen.getByText(/halfway up in the south-east/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(intents).toEqual([{ kind: "clear_selection" }]);
  });

  it("redraws from a new view", () => {
    const { rerender } = setup();
    rerender(<SkyGuide view={view({ where: { label: "Lisbon", lat: 38.72, lon: -9.14 } })} message="" onIntent={() => {}} />);
    expect(screen.getByRole("heading", { name: "Lisbon" })).toBeTruthy();
  });

  it("names the lit constellation beside the count", () => {
    setup(view({ figure: { con: "Lyr", name: "Lyra", lines: [["vega", "sirius"]] } }));
    expect(screen.getByText(/2 of 137 stars up · Lyra/)).toBeTruthy();
  });

  it("invites a tap when nothing is selected, rather than showing an empty box", () => {
    setup();
    expect(screen.getByText(/Tap a star to ask about it/)).toBeTruthy();
  });
});

describe("a clock that never moves, and every way to move it", () => {
  // The symptom: the header printed "9:00 pm, Wed 5 Aug" and then never
  // changed. A first-time user read that as a frozen app.
  it("says the sky is held rather than leaving a stopped clock on screen", () => {
    setup();
    expect(screen.getByText(/held at this moment/)).toBeTruthy();
  });

  it("says when the chart is showing the daytime (a new place keeps the instant), with a way back to tonight", () => {
    setup();
    expect(screen.queryByText(/daytime there/)).toBeNull();
    const { intents } = setup({ ...view({ where: { label: "Lisbon", lat: 38.72, lon: -9.14 } }), night: { date: "2026-08-05", hours: 13 } });
    expect(screen.getByText(/daytime there/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show tonight" }));
    expect(intents).toEqual([{ kind: "set_time", preset: "tonight" }]);
  });

  it("steps the clock an hour either way, and back to tonight, as set_time intents", () => {
    const { intents } = setup();
    fireEvent.click(screen.getByLabelText("An hour later"));
    fireEvent.click(screen.getByLabelText("An hour earlier"));
    fireEvent.click(screen.getByLabelText("Back to this evening"));
    fireEvent.click(screen.getByRole("button", { name: "Midnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Before dawn" }));
    expect(intents).toEqual([
      { kind: "set_time", shiftHours: 1 },
      { kind: "set_time", shiftHours: -1 },
      { kind: "set_time", preset: "tonight" },
      { kind: "set_time", preset: "midnight" },
      { kind: "set_time", preset: "dawn" },
    ]);
  });

  it("scrubs the hour across the night and picks the night itself (new in this port)", () => {
    const { intents } = setup();
    const slider = screen.getByLabelText("Hour of the night") as HTMLInputElement;
    expect(slider.value).toBe("21");
    fireEvent.change(slider, { target: { value: "26" } });
    fireEvent.change(screen.getByDisplayValue("2026-08-05"), { target: { value: "2026-12-21" } });
    expect(intents).toEqual([{ kind: "set_time", nightHours: 26 }, { kind: "set_time", date: "2026-12-21" }]);
  });
});

describe("the place picker (the original moved the place by voice only)", () => {
  it("moves the observer to a listed place", () => {
    const { intents } = setup();
    const picker = screen.getByLabelText("Place") as HTMLSelectElement;
    expect(picker.value).toBe("taipei");
    expect(picker.options).toHaveLength(42);   // 41 places and "Latitude and longitude…"
    fireEvent.change(picker, { target: { value: "lisbon" } });
    expect(intents).toEqual([{ kind: "set_place", label: "Lisbon" }]);
  });

  it("takes a latitude and longitude, and leaves judging them to the chart", () => {
    const { intents } = setup();
    fireEvent.change(screen.getByLabelText("Place"), { target: { value: "coords" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "-33.9" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "18.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(intents).toEqual([{ kind: "set_place", lat: "-33.9", lon: "18.4" }]);
  });

  it("shows coordinates as the current place when the chart is at them", () => {
    setup(view({ where: { label: "33.9°S 18.4°E", lat: -33.9, lon: 18.4 } }));
    expect((screen.getByLabelText("Place") as HTMLSelectElement).selectedOptions[0].textContent).toBe("33.9°S 18.4°E");
  });
});

describe("the constellation buttons (the original lit a figure by voice only)", () => {
  it("lights an up figure, unlights a lit one, and still offers a down one (the chart says when it rises)", () => {
    const { intents, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lyra" }));
    const orion = screen.getByRole("button", { name: "Orion" });
    expect(orion.className).toContain("is-down");
    expect(orion.getAttribute("title")).toBe("Not up: it rises about half past 2 in the morning");
    fireEvent.click(orion);
    const litView = view({ figure: { con: "Lyr", name: "Lyra", lines: [["vega", "sirius"]] } });
    rerender(<SkyGuide view={litView} message="" onIntent={(intent) => intents.push(intent)} />);
    expect(screen.getByRole("button", { name: "Lyra" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Lyra" }));
    expect(intents).toEqual([
      { kind: "show_constellation", name: "Lyr" },
      { kind: "show_constellation", name: "Ori" },
      { kind: "clear_figure" },
    ]);
  });
});

// Stars (the keyboard list) and figures (the buttons) share one screen; no
// name may be both, or "tap Lyra" would mean two things.
it("never offers the same button twice", () => {
  setup();
  const names = screen.getAllByRole("button").map((b) => b.textContent);
  expect(new Set(names).size).toBe(names.length);
});
