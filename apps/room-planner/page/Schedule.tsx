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
    <section className="rp-schedule" aria-label="Area schedule">
      <h2 className="rp-side__title">Areas</h2>
      <table className="rp-table">
        <tbody>
          {schedule.rows.map((row) => (
            <tr
              key={row.id}
              className={row.id === selected ? "rp-table__row--on" : undefined}
              onClick={() => onSelect(row.id)}
            >
              <td>{row.name}</td>
              <td className="rp-table__num">{areaLabel(row.area_m2, schedule.unit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="rp-table__num">
              {areaLabel(schedule.total_m2, schedule.unit)}
            </td>
          </tr>
          <tr className="rp-table__soft">
            <td>Circulation</td>
            <td className="rp-table__num">{schedule.circulation_pct}%</td>
          </tr>
          {schedule.unassigned_m2 > 0 && (
            <tr className="rp-table__warn">
              <td>Not in any room</td>
              <td className="rp-table__num">
                {areaLabel(schedule.unassigned_m2, schedule.unit)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </section>
  );
}

/**
 * Two schemes side by side, room by room.
 *
 * Read-only, and that is the design rather than a shortcut: exactly one plan is
 * editable at any moment, so every spoken intent has one unambiguous target.
 * What the comparison is for is the trade — "this one gives bedroom two an
 * extra three metres, taken off the hall" — and for that you only need to see
 * it.
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
    <section className="rp-compare" aria-label={`Compared with ${comparing.name}`}>
      <header className="rp-compare__head">
        <h2 className="rp-side__title">vs {comparing.name}</h2>
        <button type="button" className="rp-btn rp-btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      {comparing.thumb && (
        <MiniPlan thumb={comparing.thumb} label={comparing.name} />
      )}
      {comparing.deltas.length === 0 ? (
        <p className="rp-side__none">These two are the same on paper.</p>
      ) : (
        <table className="rp-table">
          <tbody>
            {[...gained, ...lost].map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td
                  className={`rp-table__num ${
                    row.delta_m2 > 0 ? "rp-delta--up" : "rp-delta--down"
                  }`}
                >
                  {row.delta_m2 > 0 ? "+" : "−"}
                  {areaLabel(Math.abs(row.delta_m2), unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* The totals. Two schemes both reading "7 rooms · 62.9 m²" in the list
          are indistinguishable, and a room-by-room delta of ±0.5 m² does not
          tell a designer which plan to argue for. Circulation is the number
          that actually separates two layouts of the same envelope. */}
      <div className="rp-compare__totals">
        <span>Circulation</span>
        <span>
          {wasCirculation}% → <strong>{schedule.circulation_pct}%</strong>
        </span>
      </div>
      <div className="rp-compare__totals">
        <span>Rooms</span>
        <span>
          {comparing.rows.length} → <strong>{schedule.rows.length}</strong>
        </span>
      </div>
      <p className="rp-compare__hint">
        Read-only. Say <em>"go back to {comparing.name}"</em> to work on it.
      </p>
    </section>
  );
}
