import { describe, expect, it } from 'vitest';
import { arrival, followUp, INSTRUCTIONS, TOOLS, trailState } from './director.ts';
import { mustDo } from './judge.ts';
import { addLayer, CLAIMS, finished, judge, LAYERS, newTrail, pickRock, pump, PUMPS, ROCKS, STOPS, walkOn, type Trail } from './trail.ts';

const pumped = (t: Trail) => { for (let i = 0; i < PUMPS; i++) t = pump(t).trail; return t; };
const atStop = (n: number) => {
  let t = pumped(newTrail());
  if (n >= 1) { t = walkOn(t).trail; }
  if (n >= 2) { for (const l of LAYERS) t = addLayer(t, l.name).trail; t = walkOn(t).trail; }
  if (n >= 3) { for (const c of CLAIMS) t = judge(t, c.truth ? 'true' : 'nope').trail; t = walkOn(t).trail; }
  return t;
};

describe('Rumble Peak', () => {
  it('erupts on the last pump and gives the sticker', () => {
    const m = pump(pump(pump(newTrail()).trail).trail);
    expect(m.fx).toEqual(['pump', 'erupt', 'sticker']);
    expect(m.trail.stickers).toEqual(['boom']);
  });
  it('does not stack a second eruption or sticker', () => {
    const m = pump(pumped(newTrail()));
    expect(m.ok).toBe(false);
    expect(m.trail.stickers).toHaveLength(1);
  });
  it('is not left before the eruption', () => {
    expect(walkOn(newTrail()).outcome).toMatch(/^Not yet/);
  });
});

describe('The Big Dig', () => {
  it('refuses a layer out of order and takes the right one in any wording', () => {
    const t = atStop(1);
    expect(addLayer(t, 'the crust').ok).toBe(false);
    expect(addLayer(t, 'Inner core!').trail.layers).toBe(1);
  });
  it('takes "add one" with no name', () => {
    expect(addLayer(atStop(1), undefined).trail.layers).toBe(1);
  });
  it('wins the sticker with the last layer', () => {
    let t = atStop(1);
    for (const l of LAYERS) t = addLayer(t, l.id).trail;
    expect(t.stickers).toContain('layers');
  });
});

describe('Silly Bridge', () => {
  it('reads child words for both verdicts', () => {
    const t = atStop(2);
    expect(judge(t, 'Nope!').ok).toBe(true);
    expect(judge(t, "that's true").ok).toBe(false);
    expect(judge(t, 'not true').ok).toBe(true);
  });
  it('asks again when the words say neither', () => {
    const m = judge(atStop(2), 'banana');
    expect(m.outcome).toMatch(/^Not clear/);
    expect(m.trail.claim).toBe(0);
  });
  it('still gives the sticker after a wrong answer', () => {
    let t = atStop(2);
    for (const c of CLAIMS) t = judge(t, c.truth ? 'silly' : 'yes').trail;
    expect(t.caught).toBe(0);
    expect(t.stickers).toContain('silly');
  });
});

describe('Rock Camp', () => {
  it('keeps the same rock after a wrong pick', () => {
    const m = pickRock(atStop(3), 'basalt');
    expect(m.ok).toBe(false);
    expect(m.trail.rock).toBe(0);
  });
  it('finishes the trail with all stickers', () => {
    let t = atStop(3);
    for (const r of ROCKS) t = pickRock(t, r.name).trail;
    const end = walkOn(t);
    expect(end.fx).toEqual(['finish']);
    expect(finished(end.trail)).toBe(true);
    expect(end.trail.stickers).toHaveLength(STOPS.length);
  });
});

it('refuses a move from another stop', () => {
  expect(pickRock(newTrail(), 'pumice').outcome).toMatch(/^Not here/);
  expect(pump(atStop(1)).outcome).toMatch(/^Not here/);
});

describe('the director', () => {
  it('fits the API', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
    for (const tool of TOOLS) expect(JSON.stringify(tool.parameters)).not.toMatch(/enum|additionalProperties|pattern/);
  });
  it('gives Mochi the line each stop needs, within the state limit', () => {
    expect(trailState(atStop(2))).toContain(CLAIMS[0].line);
    expect(trailState(atStop(3))).toContain(ROCKS[0].clue);
    expect(trailState(atStop(3))).not.toContain(`${ROCKS[0].name}.`);
    for (const n of [0, 1, 2, 3]) expect(trailState(atStop(n)).length).toBeLessThanOrEqual(3858);
  });
  it('hands over the next claim after a verdict', () => {
    expect(followUp(judge(atStop(2), 'nope').trail)).toContain(CLAIMS[1].line);
  });
  it('opens without a second greeting', () => {
    expect(arrival(newTrail())).toMatch(/^You have just greeted them/);
  });
});

it('hears walking on, and nothing else', () => {
  expect(mustDo("Let's go!")).toBe('walk_on');
  expect(mustDo('next stop please')).toBe('walk_on');
  expect(mustDo('make it erupt')).toBeNull();
});
