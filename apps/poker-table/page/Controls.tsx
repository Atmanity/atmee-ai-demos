// Under the felt: the player's moves while a hand is on, the next deal
// between hands, the paused table after a call, and the match's end. Nothing
// here decides a rule: `valid_actions`, `to_call` and the raise range arrive
// computed in the view, and a press is an intent the server rules on.
import { useState } from 'react';
import type { AvatarPhase } from '../../../src/kit/useAvatar.ts';
import { HOST, standing } from '../engine/director.ts';
import type { Intent, TableView, Winner } from '../engine/types.ts';

export interface Finished { hand: number; winner: Winner }

const n = (x: number) => x.toLocaleString('en-US');
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Fold, check or call, and a sized bet or raise, for the decision in front of the player. */
export function ActionBar({ view, disabled, onMove }: { view: TableView; disabled: boolean; onMove: (intent: Intent, label: string) => void }) {
  const mine = view.action_to === 'user';
  const user = view.players.user;
  const toCall = mine ? view.to_call : 0;
  const canCheck = mine ? view.valid_actions.includes('check') : toCall === 0;
  const canRaise = mine && view.valid_actions.includes('raise');
  // The floor is the table's own min_raise_to whether or not anything is owed:
  // in the big blind after a limp nothing is to call, yet the smallest legal
  // raise is still TO twice the blind. A floor taken from the blind offered a
  // raise the table refused.
  const lo = view.min_raise_to;
  const hi = mine ? view.max_raise_to : user.bet + user.stack;
  const [amount, setAmount] = useState(lo);
  const size = clamp(amount, lo, hi);
  const verb = view.current_bet > 0 ? 'Raise to' : 'Bet';
  const allIn = size >= hi;
  const owed = Math.min(toCall, user.stack);
  const callLabel = `Call ${n(owed)}${toCall >= user.stack ? ' · all in' : ''}`;
  const raiseLabel = allIn ? `All in · ${n(hi)}` : `${verb} ${n(size)}`;
  // Pot-sized raise TO: the bet in front of you, plus the pot after your call.
  const potSized = (fraction: number) => clamp(Math.round(view.current_bet + (view.pot + toCall) * fraction), lo, hi);
  const presets: [string, number][] = [['Min', lo], ['½ pot', potSized(0.5)], ['Pot', potSized(1)], ['All in', hi]];

  return (
    <div className="bs-actions" aria-label="Your move">
      <div className="bs-moves">
        {!canCheck && <button type="button" className="bs-btn is-fold" disabled={disabled} onClick={() => onMove({ kind: 'fold' }, 'Fold')}>Fold</button>}
        {canCheck
          ? <button type="button" className="bs-btn is-ivory" disabled={disabled} onClick={() => onMove({ kind: 'check' }, 'Check')}>Check</button>
          : <button type="button" className="bs-btn is-ivory" disabled={disabled} onClick={() => onMove({ kind: 'call' }, callLabel)}>{callLabel}</button>}
      </div>
      {canRaise && (
        <div className="bs-sizer">
          {hi > lo && (
            <>
              <div className="bs-presets" role="group" aria-label="Bet size presets">
                {presets.map(([label, value]) => (
                  <button key={label} type="button" className={`bs-chip-btn ${size === value ? 'is-on' : ''}`} disabled={disabled} onClick={() => setAmount(value)}>{label}</button>
                ))}
              </div>
              <input
                type="range" className="bs-slider" aria-label={`${verb} amount`} min={lo} max={hi}
                step={Math.max(1, Math.floor((hi - lo) / 40))} value={size} disabled={disabled}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </>
          )}
          <button type="button" className="bs-btn is-brass" disabled={disabled} onClick={() => onMove({ kind: 'raise', amount: size }, raiseLabel)}>{raiseLabel}</button>
        </div>
      )}
    </div>
  );
}

export function Controls(props: {
  view: TableView | null;
  phase: AvatarPhase;
  /** Why the call could not be placed, in the product's words. */
  detail?: string;
  busy: boolean;
  history: Finished[];
  onMove: (intent: Intent, label: string) => void;
  onCallAgain: () => void;
  onFresh: () => void;
}) {
  const { view, phase, detail, busy, history, onMove, onCallAgain, onFresh } = props;
  const live = phase === 'live';
  const away = phase === 'ended' || phase === 'failed';

  if (view?.phase === 'game-over') return <Summary view={view} history={history} live={live} busy={busy} onMove={onMove} onCallAgain={onCallAgain} />;

  if (away) {
    const hands = view?.session.hands_played ?? 0;
    return (
      <div className="bs-panel is-paused" role="status">
        <div>
          <p className="bs-eyebrow">{phase === 'failed' ? `Couldn’t reach ${HOST}` : 'Table paused'}</p>
          <p className="bs-panel-line">
            {phase === 'failed' && detail ? `${detail} ` : ''}
            {view && hands ? `After ${hands} hand${hands === 1 ? '' : 's'}, ${standing(view).replace('they are', 'you’re').replace('exactly even', 'dead even')}.` : view ? 'Your seat is saved for this hand.' : 'No cards were dealt yet.'}
          </p>
        </div>
        <div className="bs-panel-actions">
          <button type="button" className="bs-btn is-brass" onClick={onCallAgain}>Call {HOST} again</button>
          <button type="button" className="bs-btn is-quiet" onClick={onFresh}>Start a fresh match</button>
        </div>
      </div>
    );
  }

  if (!view || !live) {
    return (
      <div className="bs-panel is-waiting" aria-busy="true">
        <p className="bs-panel-line">{view ? `${HOST} is pulling up a chair…` : `${HOST} is shuffling up…`}</p>
      </div>
    );
  }

  if (view.phase === 'hand-over') {
    return (
      <div className="bs-panel is-between">
        <p className="bs-panel-line">Ready for the next one? Say “deal”, or tap.</p>
        <button type="button" className="bs-btn is-brass is-big" disabled={busy} onClick={() => onMove({ kind: 'deal' }, 'Deal next hand')}>Deal next hand</button>
      </div>
    );
  }

  const mine = view.action_to === 'user';
  return (
    <div className="bs-controls">
      <p className={`bs-hint ${mine ? 'is-yours' : ''}`} aria-live="polite">
        {mine ? <>Your move. Say it, type it or tap it.</> : <>{HOST} to act…</>}
      </p>
      {mine
        ? <ActionBar key={view.seq} view={view} disabled={busy} onMove={onMove} />
        : <div className="bs-actions is-idle" aria-hidden="true"><span className="bs-dots"><i /><i /><i /></span></div>}
    </div>
  );
}

/** The match's end: who took every chip, and how the hands went. */
function Summary({ view, history, live, busy, onMove, onCallAgain }: {
  view: TableView; history: Finished[]; live: boolean; busy: boolean;
  onMove: (intent: Intent, label: string) => void; onCallAgain: () => void;
}) {
  const won = view.players.user.stack > view.players.agent.stack;
  const s = view.session;
  const biggest = history.filter((h) => h.winner.who === 'user').reduce((m, h) => Math.max(m, h.winner.amount), 0);
  return (
    <section className={`bs-panel is-summary ${won ? 'is-won' : 'is-lost'}`} aria-label="Match result">
      <div className="bs-summary-head">
        <p className="bs-eyebrow">Match over</p>
        <h2>{won ? 'You took every chip.' : `${HOST} took every chip.`}</h2>
      </div>
      <dl className="bs-stats">
        <div><dt>Hands</dt><dd>{s.hands_played}</dd></div>
        <div><dt>You won</dt><dd>{s.hands_won_user}</dd></div>
        <div><dt>{HOST} won</dt><dd>{s.hands_won_agent}</dd></div>
        <div><dt>Your biggest pot</dt><dd>{biggest ? n(biggest) : '—'}</dd></div>
      </dl>
      {history.length > 0 && (
        <ol className="bs-history" aria-label="Hand by hand">
          {history.slice(-12).map((h) => (
            <li key={h.hand} className={`is-${h.winner.who}`} title={`Hand ${h.hand}`}>
              <span>{h.hand}</span>
              <b>{h.winner.who === 'split' ? 'Split' : h.winner.who === 'user' ? 'You' : HOST}</b>
              <i>{n(h.winner.amount)}</i>
            </li>
          ))}
        </ol>
      )}
      {live
        ? <button type="button" className="bs-btn is-brass is-big" disabled={busy} onClick={() => onMove({ kind: 'restart' }, 'Rematch')}>Rematch</button>
        : <button type="button" className="bs-btn is-brass is-big" onClick={onCallAgain}>Call {HOST} for a rematch</button>}
    </section>
  );
}
