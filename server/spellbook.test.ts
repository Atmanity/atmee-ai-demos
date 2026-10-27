import { beforeAll, describe, expect, it } from "vitest";
import "../public/spellbook.js";

type Point = [number, number];
// The spellcraft page's spellbook: a plain script that sets globalThis.Spellbook.
const book = () => (globalThis as any).Spellbook;
let SB: any;
beforeAll(() => { SB = book(); });

// A hand drifting off the guide and back, as far as amount (in canvas widths).
const drift = (points: Point[], amount: number): Point[] =>
  points.map(([x, y], i) => [x + amount * Math.sin(i * 0.15 + 1), y + amount * Math.cos(i * 0.11)]);
const traced = (kind: string): Point[] => SB.resample(SB.SIGILS[kind].path(), 80);

describe("scoreTrace", () => {
  it("gives a faithful trace of every sigil full marks, in either direction", () => {
    for (const kind of Object.keys(SB.SIGILS)) {
      expect(SB.scoreTrace(traced(kind), kind), kind).toBeGreaterThanOrEqual(98);
      expect(SB.scoreTrace(traced(kind).reverse(), kind), `${kind} reversed`).toBeGreaterThanOrEqual(98);
    }
  });
  it("keeps a careful hand brilliant and a sloppy one below that", () => {
    for (const kind of Object.keys(SB.SIGILS)) {
      expect(SB.scoreTrace(drift(traced(kind), 0.03), kind), kind).toBeGreaterThanOrEqual(80);
      expect(SB.scoreTrace(drift(traced(kind), 0.1), kind), kind).toBeLessThan(80);
    }
  });
  it("marks a different sigil traced instead well below a solid cast", () => {
    for (const [drawn, wanted] of [["circle", "triangle"], ["square", "diamond"], ["wave", "chevron"], ["star", "circle"], ["spiral", "circle"]]) {
      expect(SB.scoreTrace(traced(drawn), wanted), `${drawn} for ${wanted}`).toBeLessThan(60);
    }
  });
  it("counts the part of the sigil never traced", () => {
    const half = traced("circle").slice(0, 40);
    expect(SB.scoreTrace(half, "circle")).toBeLessThan(70);
  });
  it("gives nothing for a dot, a tiny scribble or an unknown sigil", () => {
    expect(SB.scoreTrace([[0.5, 0.5]], "circle")).toBe(0);
    expect(SB.scoreTrace([[0.5, 0.5], [0.52, 0.51], [0.5, 0.53]], "circle")).toBe(0);
    expect(SB.scoreTrace(traced("circle"), "pentacle")).toBe(0);
  });
});

describe("similarity", () => {
  it("hears every incantation inside a sentence, as recognisers misspell it", () => {
    const heard: [string, string][] = [
      ["Okay... Ignis Bella!", "Ignis Vela"], ["egnis vella", "Ignis Vela"], ["pyre a corona", "Pyra Corona"],
      ["Marys lenis", "Maris Lenis"], ["under surge at", "Unda Surgat"], ["aura cellar", "Aura Celer"],
      ["turbo plume", "Turbo Plumae"], ["Germina veret", "Germina Viret"], ["radix tenacs", "Radix Tenax"],
      ["umbra vela", "Umbra Velat"], ["tacitus gradus", "Tacitus Gradus"], ["looks Clara", "Lux Clara"],
      ["veritas full get", "Veritas Fulget"],
    ];
    for (const [said, words] of heard) expect(SB.similarity(said, words), `${said} / ${words}`).toBeGreaterThanOrEqual(0.7);
  });
  it("does not hear the words in ordinary talk", () => {
    for (const [said, words] of [["hello, how are you today", "Ignis Vela"], ["I am not sure what to say", "Lux Clara"], ["can you say that again please", "Pyra Corona"], ["", "Umbra Velat"]]) {
      expect(SB.similarity(said, words), `${said} / ${words}`).toBeLessThan(0.6);
    }
  });
});

describe("names the host gives", () => {
  it("finds the school from its name or what it stands for", () => {
    expect(SB.schoolOf("Ember")).toBe("ember");
    expect(SB.schoolOf("the school of fire")).toBe("ember");
    expect(SB.schoolOf("GLOAM")).toBe("gloam");
    expect(SB.schoolOf("Lumen, the light")).toBe("lumen");
    expect(SB.schoolOf("wind")).toBe("gale");
    expect(SB.schoolOf("necromancy")).toBe(null);
  });
  it("finds the spell by place, name or a telling part of it, only in that school", () => {
    expect(SB.spellIndex("ember", "1")).toBe(0);
    expect(SB.spellIndex("ember", "the second one")).toBe(1);
    expect(SB.spellIndex("ember", "Pyra Corona")).toBe(1);
    expect(SB.spellIndex("ember", "ignis vela, the little flame")).toBe(0);
    expect(SB.spellIndex("ember", "Vela")).toBe(0);
    expect(SB.spellIndex("ember", "Lux Clara")).toBe(-1);
    expect(SB.spellIndex("ember", "a")).toBe(-1);
    expect(SB.spellIndex("nowhere", "1")).toBe(-1);
  });
  it("finds the rank", () => {
    expect(SB.rankOf("adept")).toBe("Adept");
    expect(SB.rankOf("a promising Apprentice")).toBe("Apprentice");
    expect(SB.rankOf("Grand Sorcerer")).toBe(null);
  });
});

describe("castPower and tier", () => {
  it("halves a cast without its words and names the tiers", () => {
    expect(SB.castPower(90, true)).toBe(90);
    expect(SB.castPower(90, false)).toBe(45);
    expect([95, 70, 40, 10].map((p) => SB.tier(p))).toEqual(["brilliant", "solid", "shaky", "fizzled"]);
  });
  it("gives every school two spells whose sigils exist", () => {
    for (const school of Object.values(SB.SCHOOLS) as any[]) {
      expect(school.spells).toHaveLength(2);
      for (const spell of school.spells) expect(SB.SIGILS[spell.sigil], spell.name).toBeTruthy();
    }
  });
});
