import { describe, expect, it } from "vitest";

import { boardTurnState, playerStatuses } from "./status.ts";

describe("playerStatuses", () => {
  it("gives the side to move the weight and leaves the other idle", () => {
    const yours = playerStatuses({
      over: false,
      turn: "user",
      inCheck: false,
      winner: null,
    });
    expect(yours.user).toEqual({ text: "Your move", tone: "active" });
    expect(yours.agent).toEqual({ text: "Waiting", tone: "idle" });

    const theirs = playerStatuses({
      over: false,
      turn: "agent",
      inCheck: false,
      winner: null,
    });
    expect(theirs.agent).toEqual({ text: "Thinking…", tone: "thinking" });
    expect(theirs.user).toEqual({ text: "Waiting", tone: "idle" });
  });

  // `in_check` used to fire a sound and nothing else — and sound is muted by
  // default, so a check was, for most players, never announced at all.
  it("says check in words, on whichever row is to move", () => {
    expect(
      playerStatuses({ over: false, turn: "user", inCheck: true, winner: null })
        .user.text,
    ).toBe("Your move — check");
    expect(
      playerStatuses({ over: false, turn: "agent", inCheck: true, winner: null })
        .agent.text,
    ).toBe("Thinking… — check");
  });

  it("replaces both statuses with the outcome once the game is over", () => {
    const userWon = playerStatuses({
      over: true,
      turn: null,
      inCheck: false,
      winner: "opponent",
    });
    expect(userWon.user.text).toBe("Won");
    expect(userWon.agent.text).toBe("Lost");
    expect(userWon.user.tone).toBe("result");

    const agentWon = playerStatuses({
      over: true,
      turn: null,
      inCheck: false,
      winner: "agent",
    });
    expect(agentWon.user.text).toBe("Lost");
    expect(agentWon.agent.text).toBe("Won");

    const drawn = playerStatuses({
      over: true,
      turn: null,
      inCheck: false,
      winner: "draw",
    });
    expect(drawn.user.text).toBe("Draw");
    expect(drawn.agent.text).toBe("Draw");
  });

  // A check standing when the game is already over would say "your move" of a
  // turn that is never coming.
  it("never says Waiting or check under a finished game", () => {
    const status = playerStatuses({
      over: true,
      turn: "user",
      inCheck: true,
      winner: "agent",
    });
    expect(status.user.text).toBe("Lost");
    expect(status.agent.text).toBe("Won");
  });
});

describe("boardTurnState", () => {
  it("rings the board only while somebody has a move to make", () => {
    expect(boardTurnState({ over: false, turn: "user" })).toBe("yours");
    expect(boardTurnState({ over: false, turn: "agent" })).toBe("theirs");
    expect(boardTurnState({ over: false, turn: null })).toBe("none");
    expect(boardTurnState({ over: true, turn: "user" })).toBe("over");
  });
});
