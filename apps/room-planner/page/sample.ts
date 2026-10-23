// The front door's picture of the product: a real floor laid out by the
// planner, and one real trade on it, so the numbers in the example exchange
// are the ones the app would actually give.
import { fmtG } from '../engine/num.ts';
import { Planner } from '../engine/planner.ts';
import type { Level } from '../engine/types.ts';

export interface Sample {
  level: Level;
  /** The room the example trade gave floor to, highlighted on the drawing. */
  selected: string | null;
  total_m2: number;
  /** What the client says, and what the architect answers, in the plan's own numbers. */
  exchange: { client: string; architect: string } | null;
}

const lower = (name: string) => name.toLowerCase();

export function lobbySample(): Sample {
  const planner = new Planner(900, 700);
  planner.apply({ kind: 'generate', bedrooms: 2, office: true });
  let snap = planner.snapshot();
  const rooms = snap.level.rooms;
  const bedroom = rooms.find((r) => r.name === 'Main bedroom') ?? rooms.find((r) => r.kind === 'bedroom');
  let exchange: Sample['exchange'] = null;
  let selected: string | null = null;
  if (bedroom) {
    const next = snap.level.walls.filter((w) => w.a === bedroom.id || w.b === bedroom.id).map((w) => (w.a === bedroom.id ? w.b : w.a));
    // The hall or the study is the natural donor; anything that shares a wall will do.
    const order = ['office', 'hall', 'corridor', 'bedroom_single', 'bedroom'];
    const donors = rooms.filter((r) => next.includes(r.id)).sort((p, q) => (order.indexOf(p.kind) + 99) % 99 - (order.indexOf(q.kind) + 99) % 99);
    for (const donor of donors) {
      const result = planner.apply({ kind: 'trade_area', from: donor.id, to: bedroom.id, m2: 1 });
      if (!result.applied) continue;
      snap = result.snapshot;
      const [taker, giver] = result.done.rooms ?? [];
      selected = bedroom.id;
      exchange = {
        client: `Give the ${lower(taker.name)} a square metre off the ${lower(giver.name)}.`,
        architect: `Done: the ${lower(taker.name)} is ${fmtG(taker.area_m2)} square metres now, the ${lower(giver.name)} ${fmtG(giver.area_m2)}.`,
      };
      break;
    }
  }
  return { level: snap.level, selected, total_m2: snap.schedule.total_m2, exchange };
}
