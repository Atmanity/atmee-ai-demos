// @vitest-environment jsdom
/**
 * The panel as a projection: snapshots in, intents out, nothing decided here
 * (ported from the panel's RoomPlanner.test.tsx; the scripted agent became a
 * scripted `send`).
 *
 * The behaviour worth guarding hardest is the wall drag. It is the only place
 * the panel sends a real measurement, and its sign convention belongs to the
 * planner: a positive delta gives floor to the wall's `a` room. Backwards, the
 * right wall moves the wrong way, which looks exactly like the app
 * misunderstanding the client.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Intent, Item, Level, PlanSnapshot, Wall } from "../engine/types.ts";
import { areaLabel, dropPosition, metres, openingLine, swingPath, wallDelta, wallTargets } from "./geometry.ts";
import { RoomPlanner, type Photos, type SendResult } from "./RoomPlanner.tsx";

afterEach(cleanup);

// jsdom has no PointerEvent; without one a pointer event carries no clientX.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventShim }).PointerEvent = PointerEventShim;
}

const BED: Item = {
  id: "i1", type: "bed_queen", label: "Queen bed",
  x_cm: 40, y_cm: 30, w_cm: 152, h_cm: 203, rot: 0,
};

const WALL: Wall = {
  a: "r1", b: "r2", axis: "v", line_cm: 400, start_cm: 0, end_cm: 700,
  structural: false,
};

function level(over: Partial<Level> = {}): Level {
  return {
    name: "ground",
    w_cm: 900,
    h_cm: 700,
    rooms: [
      {
        id: "r1", name: "Living room", kind: "living", area_m2: 28,
        rects: [[0, 0, 400, 700]], edges: [[0, 0, 400, 0]], bbox: [0, 0, 400, 700],
      },
      {
        id: "r2", name: "Main bedroom", kind: "bedroom", area_m2: 35,
        rects: [[400, 0, 900, 700]], edges: [[400, 0, 900, 0]],
        bbox: [400, 0, 900, 700],
      },
    ],
    unassigned: [],
    unassigned_m2: 0,
    openings: [
      { id: "o1", kind: "door", axis: "v", line_cm: 400, start_cm: 200, width_cm: 85, a: "r1", b: "r2", swing_into: "r1" },
      { id: "o2", kind: "window", axis: "h", line_cm: 0, start_cm: 100, width_cm: 120, b: "r1" },
    ],
    items: [BED],
    walls: [WALL],
    ...over,
  };
}

function snapshot(over: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    level: level(),
    levels: ["ground"],
    active: 0,
    selected: "i1",
    unit: "m2",
    schedule: {
      unit: "m2",
      rows: [
        { id: "r2", name: "Main bedroom", kind: "bedroom", area_m2: 35, area: 35 },
        { id: "r1", name: "Living room", kind: "living", area_m2: 28, area: 28 },
      ],
      total_m2: 63, total: 63, circulation_m2: 0, circulation_pct: 0,
      unassigned_m2: 0, envelope: 63,
    },
    issues: [{ room: "r1", kind: "daylight", note: "The living room has no window at all" }],
    schemes: [],
    room_kinds: [
      { kind: "living", label: "Living room", min_area_m2: 11 },
      { kind: "office", label: "Study", min_area_m2: 5 },
      { kind: "bedroom", label: "Bedroom", min_area_m2: 6.5 },
    ],
    typologies: [{ key: "day_night", label: "Day end, night end", note: "Living at the front." }],
    stairs_aligned: true,
    can_undo: true,
    catalog: [
      { type: "bed_queen", label: "Queen bed", w_cm: 152, h_cm: 203, family: "Beds" },
      { type: "stool", label: "Stool", w_cm: 40, h_cm: 40, family: "Seating" },
    ],
    ...over,
  };
}

/** A scripted planner: records every intent and answers as told. */
function fakePlanner() {
  const intents: Intent[] = [];
  let answer: (intent: Intent) => SendResult = () => ({ applied: false, reason: "unscripted" });
  return {
    intents,
    send: (intent: Intent) => {
      intents.push(intent);
      return answer(intent);
    },
    script(fn: (intent: Intent) => SendResult) {
      answer = fn;
    },
  };
}

const ok = (): SendResult => ({ applied: true });

// --------------------------------------------------------------- rendering

describe("RoomPlanner on the planner's authority", () => {
  it("draws the floor, its rooms, areas and what is worth knowing", () => {
    const planner = fakePlanner();
    render(<RoomPlanner state={snapshot()} send={planner.send} />);
    expect(screen.getAllByText("Living room").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Main bedroom").length).toBeGreaterThan(0);
    expect(screen.getByText("The living room has no window at all")).toBeTruthy();
    expect(screen.getByLabelText("Floor plan of the ground floor")).toBeTruthy();
  });

  it("always says the guidance is not a regulations check", () => {
    // The product decision, on screen as well as in the notes.
    render(<RoomPlanner state={snapshot()} send={fakePlanner().send} />);
    expect(screen.getByText("Design guidance, not a building-regulations check.")).toBeTruthy();
  });

  it("a floor laid out by voice arrives as a new snapshot, with no intent from here", () => {
    const bare = snapshot({ level: level({ rooms: [], items: [], walls: [], openings: [] }), selected: null, issues: [] });
    const planner = fakePlanner();
    const { rerender } = render(<RoomPlanner state={bare} send={planner.send} />);
    expect(screen.getByLabelText("Floor plan of the ground floor")).toBeTruthy();
    rerender(<RoomPlanner state={snapshot()} send={planner.send} />);
    expect(screen.getAllByText("Living room").length).toBeGreaterThan(0);
    expect(planner.intents).toEqual([]);
  });

  it("hatches floor that is in no room, rather than leaving it blank", () => {
    // A gap is a design fact the client should be able to point at.
    const { container } = render(
      <RoomPlanner
        state={snapshot({ level: level({ unassigned: [[0, 600, 900, 700]], unassigned_m2: 9 }), schedule: { ...snapshot().schedule, unassigned_m2: 9 } })}
        send={fakePlanner().send}
      />,
    );
    expect(container.querySelector('rect[fill="url(#rp-dead)"]')).toBeTruthy();
    expect(screen.getByText("Not in any room")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ intents

describe("what the panel sends", () => {
  it("rotate and remove send one intent each for the selected piece", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot()} send={planner.send} />);
    screen.getByText("Rotate").click();
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "rotate_item", id: "i1", deg: 90 }]));
    screen.getByText("Remove").click();
    await waitFor(() => expect(planner.intents).toHaveLength(2));
    expect(planner.intents[1]).toEqual({ kind: "remove_item", id: "i1" });
  });

  it("the unit toggle asks the planner rather than converting here", async () => {
    // Two places that convert is two places that round differently.
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot()} send={planner.send} />);
    screen.getByText("m²").click();
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "set_unit", unit: "ft2" }]));
  });

  it("the furniture picker sends a type and a room, never a position", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot()} send={planner.send} />);
    screen.getByText("Seating").click();
    await waitFor(() => expect(screen.getByText("Stool")).toBeTruthy());
    screen.getByText("Stool").click();
    await waitFor(() => expect(planner.intents).toHaveLength(1));
    const intent = planner.intents[0];
    expect(intent.kind).toBe("add_item");
    expect(intent.type).toBe("stool");
    expect(intent.room).toBeTruthy();
    expect(intent).not.toHaveProperty("x");
    expect(intent).not.toHaveProperty("y");
  });

  it("a refusal becomes a message on the plan and moves nothing", async () => {
    const planner = fakePlanner();
    planner.script(() => ({ applied: false, reason: "That takes the living room down to 4 square metres." }));
    render(<RoomPlanner state={snapshot()} send={planner.send} />);
    screen.getByText("Rotate").click();
    await waitFor(() => expect(screen.getByText("That takes the living room down to 4 square metres.")).toBeTruthy());
  });

  it("a refusal heard by voice is shown the same way", () => {
    render(<RoomPlanner state={snapshot()} send={fakePlanner().send} notice={{ text: "The kitchen and the study don't share a wall.", at: 1 }} />);
    expect(screen.getByText("The kitchen and the study don't share a wall.")).toBeTruthy();
  });

  it("comparing, loading and dropping a scheme are requests", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot({ schemes: [{ name: "Open plan", rooms: 5, total_m2: 63, circulation_pct: 9 }] })} send={planner.send} />);
    screen.getByText("Compare").click();
    screen.getByText("Load").click();
    screen.getByLabelText("Drop Open plan").click();
    await waitFor(() => expect(planner.intents).toEqual([
      { kind: "compare_scheme", name: "Open plan" },
      { kind: "load_scheme", name: "Open plan" },
      { kind: "drop_scheme", name: "Open plan" },
    ]));
  });

  it("shows the difference room by room when a scheme is held up beside it", () => {
    render(
      <RoomPlanner
        state={snapshot({
          comparing: {
            name: "Open plan", rows: [],
            deltas: [
              { name: "Living room", area_m2: 28, was_m2: 24, delta_m2: 4, delta: 4 },
              { name: "Hall", area_m2: 4, was_m2: 7, delta_m2: -3, delta: -3 },
            ],
          },
        })}
        send={fakePlanner().send}
      />,
    );
    expect(screen.getByText("vs Open plan")).toBeTruthy();
    expect(screen.getByText("+4.0 m²")).toBeTruthy();
    expect(screen.getByText("−3.0 m²")).toBeTruthy();
  });

  it("dragging a wall sends one move_wall, signed the planner's way", async () => {
    // jsdom lays nothing out, so a pixel is a centimetre here: a 40 px drag
    // to the east gives the west-side room (the wall's `a`) 40 cm.
    const planner = fakePlanner();
    planner.script(ok);
    const { container } = render(<RoomPlanner state={snapshot({ selected: null })} send={planner.send} />);
    const grip = container.querySelector(".rp-wall--grip")!;
    const plan = screen.getByLabelText("Floor plan of the ground floor");
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(plan, { clientX: 140, clientY: 104, pointerId: 1 });
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "move_wall", a: "r1", b: "r2", delta: 40 }]));
  });
});

// ------------------------------------------------------- direct controls

describe("working the plan without saying anything", () => {
  it("lays out a floor from the wizard, sending a brief and no coordinates", async () => {
    const bare = snapshot({ level: level({ rooms: [], items: [], walls: [], openings: [] }), selected: null, issues: [] });
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={bare} send={planner.send} />);
    // The typology's own sentence is shown: choosing blind between four names is not choosing.
    expect(screen.getByText("Living at the front.")).toBeTruthy();
    screen.getByText("Draw it").click();
    await waitFor(() => expect(planner.intents).toHaveLength(1));
    const intent = planner.intents[0];
    expect(intent.kind).toBe("generate");
    expect(intent.bedrooms).toBe(2);
    expect(intent).not.toHaveProperty("x");
    expect(intent).not.toHaveProperty("rooms");
  });

  it("trades floor with a neighbour, in square metres and in both directions", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot({ selected: "r1" })} send={planner.send} />);
    screen.getByText("← Take").click();
    await waitFor(() => expect(planner.intents).toHaveLength(1));
    expect(planner.intents[0]).toEqual({ kind: "trade_area", from: "r2", to: "r1", m2: 1 });
    screen.getByText("Give →").click();
    await waitFor(() => expect(planner.intents).toHaveLength(2));
    expect(planner.intents[1]).toEqual({ kind: "trade_area", from: "r1", to: "r2", m2: 1 });
  });

  it("only offers neighbours it actually shares a wall with", () => {
    // A control offering a trade with a room that does not touch is a button
    // whose only outcome is a refusal.
    render(<RoomPlanner state={snapshot({ selected: "r1", level: level({ walls: [] }) })} send={fakePlanner().send} />);
    expect(screen.getByLabelText("Room name")).toBeTruthy();
    expect(screen.queryByText("← Take")).toBeNull();
    expect(screen.queryByText("Door through")).toBeNull();
  });

  it("only offers a window on a wall the room actually reaches", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot({ selected: "r1" })} send={planner.send} />);
    expect(screen.getByText("Window on")).toBeTruthy();
    // r1 spans x 0-400 of a 900-wide floor: north, south and west, not east.
    const chips = screen.getAllByRole("button").filter((b) => b.className.includes("rp-chip"));
    const labels = chips.map((b) => b.textContent);
    expect(labels).toContain("west");
    expect(labels).not.toContain("east");
    chips.find((b) => b.textContent === "west")!.click();
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "add_window", id: "r1", wall: "west" }]));
  });

  it("changes what a room is used for without touching its walls", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot({ selected: "r1" })} send={planner.send} />);
    fireEvent.change(screen.getByLabelText("Used as"), { target: { value: "office" } });
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "rename_room", id: "r1", room_kind: "office" }]));
  });

  it("asks the planner for the drawing sheet rather than making one", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot()} send={planner.send} />);
    screen.getByText("Sheet").click();
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "draw_sheet" }]));
  });
});

// --------------------------------------------------- what user testing found

describe("what real users hit", () => {
  it("lets you say how big the place is, and sends the size first", async () => {
    // The avatar asks how big the place is; with nowhere to answer on the
    // panel, a 50 m² flat came out at 63.
    const bare = snapshot({ level: level({ rooms: [], items: [], walls: [], openings: [] }), selected: null, issues: [] });
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={bare} send={planner.send} />);
    fireEvent.change(screen.getByLabelText("Width in metres"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Depth in metres"), { target: { value: "7" } });
    screen.getByText("Draw it").click();
    await waitFor(() => expect(planner.intents.length).toBeGreaterThan(1));
    // Size FIRST: generating into the old envelope and resizing after is
    // refused, because shrinking cuts into rooms.
    expect(planner.intents[0]).toEqual({ kind: "set_envelope", w: 700, h: 700 });
    expect(planner.intents[1].kind).toBe("generate");
  });

  it("shows the trade box in the unit the client is reading", async () => {
    // Labelled m² whatever the schedule said, a client reading square feet
    // typed a square-feet number into a metric field.
    const imperial = snapshot({ selected: "r1", unit: "ft2", schedule: { ...snapshot().schedule, unit: "ft2" } });
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={imperial} send={planner.send} />);
    expect(screen.getAllByText("ft²").length).toBeGreaterThan(1);
    screen.getByText("← Take").click();
    await waitFor(() => expect(planner.intents).toHaveLength(1));
    // 1 ft² is not 1 m², and the planner only speaks metric.
    expect(planner.intents[0].m2 as number).toBeCloseTo(0.09, 2);
  });

  it("says when the sheet could not be drawn", () => {
    render(<RoomPlanner state={snapshot({ sheet: { status: "failed", error: "There's nothing on this floor to draw up yet." } })} send={fakePlanner().send} />);
    expect(screen.getByText("There's nothing on this floor to draw up yet.")).toBeTruthy();
  });

  it("names every piece of furniture on the drawing", () => {
    // A double bed and a three-seat sofa are otherwise the same brown rectangle.
    render(<RoomPlanner state={snapshot()} send={fakePlanner().send} />);
    expect(screen.getAllByText("Queen bed").length).toBeGreaterThan(0);
  });

  it("separates two schemes by what actually differs between them", () => {
    render(
      <RoomPlanner
        state={snapshot({
          schemes: [{ name: "Open plan", rooms: 7, total_m2: 62.9, circulation_pct: 9 }],
          comparing: { name: "Open plan", rows: [], deltas: [{ name: "Hall", area_m2: 9.9, was_m2: 5.4, delta_m2: 4.5, delta: 4.5 }], circulation_pct: 9 },
        })}
        send={fakePlanner().send}
      />,
    );
    expect(screen.getAllByText("Circulation").length).toBeGreaterThan(0);
    expect(screen.getByText(/9% →/)).toBeTruthy();
  });
});

// --------------------------------------------------------------- the sheet

describe("the drawing sheet", () => {
  it("is shown when the planner has drawn one, and can be downloaded", () => {
    const planner = fakePlanner();
    const { rerender } = render(<RoomPlanner state={snapshot()} send={planner.send} />);
    expect(screen.queryByText("Hide the sheet")).toBeNull();
    rerender(<RoomPlanner state={snapshot({ sheet: { status: "ready", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", floor: "ground" } })} send={planner.send} />);
    const img = screen.getByAltText("Drawing sheet");
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    const link = screen.getByText("Download (SVG)");
    expect(link.getAttribute("download")).toBe("home-plan-ground.svg");
    screen.getByText("Hide the sheet").click();
  });
});

// --------------------------------------------------------------- photos

describe("photos", () => {
  const photos = (over: Partial<Photos> = {}): Photos & { calls: string[] } => {
    const calls: string[] = [];
    return { calls, reading: null, onFile: (purpose) => calls.push(`file:${purpose}`), onSample: () => calls.push("sample"), ...over };
  };

  it("offers a sample, and says what the last photo added", () => {
    const p = photos({ last: { seen: "a small living room", url: "data:image/jpeg;base64,x", added: ["a 3-seat sofa in the living room"] } });
    render(<RoomPlanner state={snapshot()} send={fakePlanner().send} photos={p} />);
    screen.getByText("Try a sample").click();
    expect(p.calls).toEqual(["sample"]);
    expect(screen.getByText(/Added: a 3-seat sofa in the living room/)).toBeTruthy();
  });

  it("cannot read a photo before there is a room to put things in", () => {
    const bare = snapshot({ level: level({ rooms: [], items: [], walls: [], openings: [] }), selected: null });
    render(<RoomPlanner state={bare} send={fakePlanner().send} photos={photos()} />);
    expect((screen.getByText("Try a sample") as HTMLButtonElement).disabled).toBe(true);
  });
});

// --------------------------------------------------------------- the levels

describe("two floors", () => {
  it("offers a switch and says when the stairs do not line up", async () => {
    const planner = fakePlanner();
    planner.script(ok);
    render(<RoomPlanner state={snapshot({ levels: ["ground", "upper"], stairs_aligned: false })} send={planner.send} />);
    expect(screen.getByText("stairs ✕")).toBeTruthy();
    screen.getByText("Upstairs").click();
    await waitFor(() => expect(planner.intents).toEqual([{ kind: "go_to_level", id: "upper" }]));
  });

  it("does not offer a switch when there is only one floor", () => {
    render(<RoomPlanner state={snapshot()} send={fakePlanner().send} />);
    expect(screen.queryByText("Upstairs")).toBeNull();
  });
});

// ------------------------------------------------------------- the geometry

describe("the drag arithmetic", () => {
  it("snaps a dropped piece to the grid the planner works in", () => {
    expect(dropPosition(BED, 33, 0, 1, { w_cm: 900, h_cm: 700 })).toEqual({ x: 70, y: 30 });
  });

  it("clamps an overshoot to the wall rather than sending a refusable drop", () => {
    // An overshoot is a slip of the hand, not an instruction.
    expect(dropPosition(BED, 9000, 9000, 1, { w_cm: 900, h_cm: 700 })).toEqual({ x: 748, y: 497 });
  });

  it("gives floor to the wall's own low-side room on a positive drag", () => {
    expect(wallDelta(WALL, 40, 0, 1)).toBe(40);
    expect(wallTargets(WALL, 40)).toEqual({ gains: "r1", loses: "r2" });
    expect(wallTargets(WALL, -40)).toEqual({ gains: "r2", loses: "r1" });
  });

  it("ignores the axis a wall cannot move along", () => {
    expect(wallDelta(WALL, 0, 80, 1)).toBe(0);
  });

  it("treats a wobble as a click rather than a drag", () => {
    expect(wallDelta(WALL, 4, 0, 1)).toBe(0);
  });

  it("puts an opening on the line it was published on", () => {
    expect(openingLine(level().openings[0])).toEqual({ x1: 400, y1: 200, x2: 400, y2: 285 });
  });

  it("swings a door into the room that owns the swing, not a compass side", () => {
    const door = level().openings[0];
    expect(swingPath(door)).toContain("M 400 285");
    expect(swingPath(level().openings[1])).toBeNull();   // a window does not swing
  });

  it("writes lengths and areas the way a person reads them", () => {
    expect(metres(900)).toBe("9 m");
    expect(metres(420)).toBe("4.2 m");
    expect(areaLabel(12.4, "m2")).toBe("12.4 m²");
    expect(areaLabel(12.4, "ft2")).toBe("133 ft²");
  });
});

// keep `act` referenced for environments that warn about unused imports
void act;
