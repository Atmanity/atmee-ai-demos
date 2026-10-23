import { describe, expect, it } from "vitest";

import { advantageForSide, advantageLabel, computeCaptured } from "./captured.ts";

// White is a pawn up: Black's e-pawn is missing from the starting set.
const WHITE_A_PAWN_UP = "rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3";

describe("advantageForSide", () => {
  // The panel stated something FALSE here, which is a correctness bug and not
  // polish: `advantageColor` is who is AHEAD, and the agent's row was given
  // the number when the USER was the one ahead. Observed at game over as
  // "<opponent> · Lost · ♟ +1" with the user a pawn up.
  it("puts the lead on the row of the side that is ahead", () => {
    const captured = computeCaptured(WHITE_A_PAWN_UP);
    expect(captured.advantageColor).toBe("w");
    expect(advantageForSide(captured, "w")).toBe(1);
    expect(advantageForSide(captured, "b")).toBe(0);
  });

  it("gives neither row a lead when material is level", () => {
    const level = computeCaptured(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    expect(advantageForSide(level, "w")).toBe(0);
    expect(advantageForSide(level, "b")).toBe(0);
  });
});

describe("advantageLabel", () => {
  // "+3" with no unit reads as a score. It is a running material count in
  // pawns, right now — the brief asks for the unit explicitly.
  it("carries the unit, singular and plural", () => {
    expect(advantageLabel(1)).toEqual({
      value: "+1",
      unit: "pawn",
      title: "1 pawn of material ahead right now",
    });
    expect(advantageLabel(3)?.unit).toBe("pawns");
    expect(advantageLabel(3)?.value).toBe("+3");
  });

  it("has nothing to say at level material", () => {
    expect(advantageLabel(0)).toBeNull();
    expect(advantageLabel(-2)).toBeNull();
  });
});
