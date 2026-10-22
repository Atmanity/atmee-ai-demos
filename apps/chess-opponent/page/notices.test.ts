import { describe, expect, it } from "vitest";

import {
  noticesFor,
  refusalNotice,
  resultReasonLine,
  resultSentence,
} from "./notices.ts";

describe("resultSentence", () => {
  it("names the winner in a sentence, using the avatar's own name", () => {
    expect(resultSentence("agent", "Jamie Hess")).toBe("Jamie Hess wins.");
    expect(resultSentence("opponent", "Jamie Hess")).toBe("You win.");
    expect(resultSentence("draw", "Jamie Hess")).toBe("Draw.");
  });
});

describe("resultReasonLine", () => {
  // `result.reason` was on the snapshot and rendered nowhere, so a bare
  // "Draw." never explained itself — and the three drawing rules are exactly
  // the ones a casual player does not know.
  it("explains every ending the agent can report", () => {
    for (const reason of [
      "checkmate",
      "stalemate",
      "insufficient_material",
      "threefold_repetition",
      "fifty_moves",
      "resignation",
    ] as const) {
      expect(resultReasonLine(reason).length).toBeGreaterThan(0);
    }
    expect(resultReasonLine("fifty_moves")).toMatch(/fifty moves/i);
    expect(resultReasonLine(null)).toBe("");
  });
});

describe("refusalNotice", () => {
  it("renders a refusal that arrived only on the snapshot", () => {
    // The whole point: a move SAID out loud and refused used to change zero
    // pixels, because `message` is only ever set by a panel-originated send.
    expect(
      refusalNotice("", { move: "e9", reason: "'e9' is not a legal move" }),
    ).toEqual({
      kind: "refusal",
      text: "'e9' is not a legal move",
      detail: "Heard as “e9”.",
    });
  });

  it("prefers the panel's own refusal when both are present", () => {
    expect(
      refusalNotice("the game is already over", {
        move: "e4",
        reason: "stale",
      })?.text,
    ).toBe("the game is already over");
  });

  it("tolerates a payload with no refusal field at all", () => {
    expect(refusalNotice("", undefined)).toBeNull();
    expect(refusalNotice("", null)).toBeNull();
    expect(refusalNotice("   ", { reason: "  " })).toBeNull();
    expect(refusalNotice("", { reason: "no side to move" })).toEqual({
      kind: "refusal",
      text: "no side to move",
      detail: undefined,
    });
  });
});

describe("noticesFor", () => {
  it("does not let a refusal replace the result", () => {
    // `message || resultLine`: a refusal landing after mate silently took the
    // result's place, and the one sentence the game exists to produce was gone.
    const notices = noticesFor({
      localMessage: "the game is already over",
      snapshotRefusal: null,
      result: { winner: "agent", reason: "checkmate" },
      opponentName: "Jamie Hess",
    });
    expect(notices.map((n) => n.kind)).toEqual(["result", "refusal"]);
    expect(notices[0].text).toBe("Jamie Hess wins.");
    expect(notices[0].detail).toMatch(/Checkmate/);
    expect(notices[1].text).toBe("the game is already over");
  });

  it("shows nothing mid-game with nothing to report", () => {
    expect(
      noticesFor({
        localMessage: "",
        snapshotRefusal: null,
        result: null,
        opponentName: "Jamie Hess",
      }),
    ).toEqual([]);
  });

  it("shows a lone refusal mid-game", () => {
    const notices = noticesFor({
      localMessage: "",
      snapshotRefusal: { move: "Qh5", reason: "it is not your side to move" },
      result: null,
      opponentName: "Jamie Hess",
    });
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("refusal");
  });
});
