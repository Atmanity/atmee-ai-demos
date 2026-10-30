import { describe, expect, it } from 'vitest';
import { EXHIBITS } from './catalogue.ts';
import { PLAN, pins, ROOMS } from './floorplan.ts';

describe('the floor plan', () => {
  it('puts every work in its own room, well inside the walls', () => {
    const all = pins();
    expect(all.map((p) => p.exhibit.id)).toEqual(EXHIBITS.map((e) => e.id));
    for (const p of all) {
      const { x, y, w, h } = p.room;
      expect(p.x, p.exhibit.id).toBeGreaterThanOrEqual(x + 16);
      expect(p.x, p.exhibit.id).toBeLessThanOrEqual(x + w - 16);
      expect(p.y, p.exhibit.id).toBeGreaterThanOrEqual(y + 30);
      expect(p.y, p.exhibit.id).toBeLessThanOrEqual(y + h - 16);
      expect(p.exhibit.gallery).toContain(`Gallery ${p.room.n}`);
    }
  });

  it('labels pins short enough not to run into their neighbours, and routes without doubling back', () => {
    const all = pins();
    // 8-unit text is about 4.6 units a character: a label must fit the gap to the next pin in its row.
    for (const a of all) for (const b of all) {
      if (a === b || a.y !== b.y) continue;
      expect((a.short.length + b.short.length) * 2.3 + 4, `${a.short} / ${b.short}`).toBeLessThan(Math.abs(a.x - b.x));
    }
    // Within each row of the route, it keeps going one way.
    const legs = all.slice(1).map((p, i) => ({ from: all[i], to: p })).filter((l) => l.from.y === l.to.y).map((l) => Math.sign(l.to.x - l.from.x));
    const top = legs.slice(-3);
    expect(new Set(top).size).toBe(1);
  });

  it('keeps pins apart and rooms inside the drawing without overlapping', () => {
    const all = pins();
    for (const a of all) for (const b of all) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
    for (const r of ROOMS) {
      expect(r.x + r.w).toBeLessThanOrEqual(PLAN.width);
      expect(r.y + r.h).toBeLessThanOrEqual(PLAN.height);
      for (const o of ROOMS) {
        if (o === r) continue;
        const apart = r.x + r.w <= o.x || o.x + o.w <= r.x || r.y + r.h <= o.y || o.y + o.h <= r.y;
        expect(apart, `${r.name} / ${o.name}`).toBe(true);
      }
    }
  });
});
