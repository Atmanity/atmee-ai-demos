import { areaLabel } from "./geometry.ts";
import { MiniPlan } from "./MiniPlan.tsx";
import type { Comparing, Schedule as ScheduleShape } from "../engine/types.ts";

/**
 * The area schedule — the number a negotiation actually turns on.
 *
 * Circulation is broken out on purpose: every square metre of hall is one the
 * bedrooms did not get, and a client who can see it is fourteen percent is
 * having a different conversation from one who cannot.
 */
export function Schedule({
  schedule,
  selected,
  onSelect,
}: {
  schedule: ScheduleShape;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="pw-block pw-schedule" aria-label="Area schedule">
      <h2 className="pw-block-title">Areas</h2>
      {schedule.rows.length === 0 ? (
        <p className="pw-none">No rooms yet.</p>
      ) : (
        <table className="pw-table">
          <tbody>
            {schedule.rows.map((row) => (
              <tr key={row.id} className={row.id === selected ? "is-on" : undefined}>
                <td>
                  <button type="button" className="pw-rowpick" onClick={() => onSelect(row.id)} aria-pressed={row.id === selected}>
                    {row.name}
                  </button>
                </td>
                <td className="pw-num">{areaLabel(row.area_m2, schedule.unit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="pw-num">{areaLabel(schedule.total_m2, schedule.unit)}</td>
            </tr>
            <tr className="is-soft">
              <td>Circulation</td>
              <td className="pw-num">{schedule.circulation_pct}%</td>
            </tr>
            {schedule.unassigned_m2 > 0 && (
              <tr className="is-warn">
                <td>Not in any room</td>
                <td className="pw-num">{areaLabel(schedule.unassigned_m2, schedule.unit)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      )}
    </section>
  );
}

/**
 * Two schemes side by side, room by room.
 *
 * Read-only, and that is the design rather than a shortcut: exactly one plan is
 * editable at any moment, so every request has one unambiguous target. What
 * the comparison is for is the trade — "this one gives bedroom two an extra
 * three metres, taken off the hall" — and for that you only need to see it.
 */
export function Compare({
  comparing,
  schedule,
  unit,
  onClose,
}: {
  comparing: Comparing;
  schedule: ScheduleShape;
  unit: "m2" | "ft2";
  onClose: () => void;
}) {
  const gained = comparing.deltas.filter((d) => d.delta_m2 > 0);
  const lost = comparing.deltas.filter((d) => d.delta_m2 < 0);
  const wasCirculation = comparing.circulation_pct ?? 0;

  return (
    <section className="pw-block pw-compare" aria-label={`Compared with ${comparing.name}`}>
      <header className="pw-block-head">
        <h2 className="pw-block-title">vs {comparing.name}</h2>
        <button type="button" className="pw-quiet" onClick={onClose}>
          Close
        </button>
      </header>
      {comparing.thumb && <MiniPlan thumb={comparing.thumb} label={comparing.name} />}
      {comparing.deltas.length === 0 ? (
        <p className="pw-none">These two are the same on paper.</p>
      ) : (
        <table className="pw-table">
          <tbody>
            {[...gained, ...lost].map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td className={`pw-num ${row.delta_m2 > 0 ? "is-up" : "is-down"}`}>
                  {row.delta_m2 > 0 ? "+" : "−"}
                  {areaLabel(Math.abs(row.delta_m2), unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* The totals. Two schemes both reading "7 rooms · 62.9 m²" are
          indistinguishable, and a room-by-room delta of ±0.5 m² does not tell
          anyone which plan to argue for. Circulation is the number that
          actually separates two layouts of the same envelope. */}
      <dl className="pw-compare-totals">
        <div>
          <dt>Circulation</dt>
          <dd>{wasCirculation}% → <strong>{schedule.circulation_pct}%</strong></dd>
        </div>
        <div>
          <dt>Rooms</dt>
          <dd>{comparing.rows.length} → <strong>{schedule.rows.length}</strong></dd>
        </div>
      </dl>
      <p className="pw-hint">Plan minus scheme. The scheme is read-only: open it to work on it.</p>
    </section>
  );
}
