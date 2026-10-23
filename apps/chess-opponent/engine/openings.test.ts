import { describe, expect, it } from "vitest";

import { detectOpening } from "./openings.ts";

describe("detectOpening", () => {
  it("names nothing before there is anything to name", () => {
    expect(detectOpening([])).toBeNull();
    expect(detectOpening(["a3"])).toBeNull();
  });

  it("prefers the longest fingerprint, not the first that matches", () => {
    // Several openings share "e4 e5 Nf3 Nc6"; only the fifth move separates
    // the Italian from the Ruy López.
    expect(detectOpening(["e4", "e5"])).toBe("Open Game");
    expect(detectOpening(["e4", "e5", "Nf3", "Nc6", "Bc4"])).toBe("Italian Game");
    expect(detectOpening(["e4", "e5", "Nf3", "Nc6", "Bb5"])).toBe("Ruy López");
  });

  it("keeps the name once the game has moved on past the fingerprint", () => {
    expect(detectOpening(["e4", "c5", "Nf3", "d6", "d4", "cxd4"])).toBe(
      "Sicilian Defence",
    );
  });

  it("matches as a prefix, so a transposition is not claimed", () => {
    expect(detectOpening(["Nf3", "e5", "e4"])).toBe("Réti Opening");
  });
});

describe("the opening is named on the snapshot both halves read (from test_game_and_table.py)", () => {
  // The model was asked to name the opening while being handed None on every
  // move, and the panel computed the name from its own copy of the table.
  it("one table, read by the board's snapshot", async () => {
    const { ChessMatch } = await import("./game.ts");
    expect(detectOpening(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"])).toBe("Italian Game");
    expect(detectOpening(["a4", "h5"])).toBeNull();
    const match = new ChessMatch();
    for (const [who, san] of [["user", "e4"], ["agent", "e5"], ["user", "Nf3"], ["agent", "Nc6"], ["user", "Bb5"]] as const) match.applyMove(who, san);
    expect(match.snapshot().opening).toBe("Ruy López");
  });
});
