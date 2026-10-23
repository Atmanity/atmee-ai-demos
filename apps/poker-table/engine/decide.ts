// The opponent's own move, decided on its own path. Ported from the
// original's `decide.py`.
//
// The move used to be a by-product of conversation: fold/check/call/raise sat
// on the chat agent as optional tools, so a reply that merely DESCRIBED a move
// ("Sure, I'll raise it to 40") was a legal outcome. The table never moved, and
// the agent went on insisting it had raised. On the Avatar API the avatar has
// no tools at all, so the separation is total: the app's server asks a model
// for a structured decision (JSON out, nothing else), validates it against the
// legal actions, and plays it; the avatar is told afterwards.
//
// A decision that is missing, late or illegal degrades to a safe action rather
// than to silence. A slightly dull opponent beats a dead table.
import type { DecisionRequest } from './match.ts';
import type { PokerActionKind } from './types.ts';

/**
 * How long Dex's move may take. The original's 4.5 s was too tight live: the
 * first decision of a run (a cold connection, the model thinking) fell back
 * while the next one, same prompt and schema, answered. Two decisions in a row
 * still fit play_move's await (see director.ts).
 */
export const DECISION_TIMEOUT_MS = 8000;

export interface Decision { kind: PokerActionKind; amount: number | null }

/** A decision and how it was made: the model's, or the safe action and why. */
export interface Decided extends Decision {
  source: 'model' | 'fallback';
  /** How long it took. */
  ms: number;
  /** Why the safe action was played instead of the model's answer. */
  reason?: string;
}

export const DECISION_SYSTEM_PROMPT = `You are a heads-up Texas Hold'em player deciding one action.
Answer with the action and, for a raise, its amount. Never write prose.
Choose only from the valid actions supplied. Use "raise" for both opening bets and raises, with the TOTAL chips the bet becomes.

Style — heads-up, so loose and aggressive:
- Rarely fold preflop; almost any two cards are playable.
- Raise or call with any ace, any pair, any suited connector, any broadway card.
- Post-flop, bet with any piece of the board and bluff missed draws often.
- Slow-play a monster sometimes. Lean toward action over caution.`;

const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The action to take when no decision can be had. Free to check -> check;
 * otherwise call if the price is on the table; otherwise fold. Never invents an
 * amount, so it cannot be illegal.
 */
export function safeAction(validActions: unknown, toCall: unknown): Decision {
  const valid = Array.isArray(validActions) ? validActions.map((a) => String(a).trim().toLowerCase()) : [];
  const owed = num(toCall);
  if (owed <= 0 && valid.includes('check')) return { kind: 'check', amount: null };
  if (valid.includes('call')) return { kind: 'call', amount: null };
  if (valid.includes('check')) return { kind: 'check', amount: null };
  return { kind: 'fold', amount: null };
}

/**
 * Force a model's answer into something the table will accept. Everything here
 * is a real answer a model has given: folding when checking is free, raising
 * without an amount, and naming an action that is not on the list.
 */
export function normalizeDecision(kindIn: unknown, amount: unknown, request: Partial<DecisionRequest>): Decision {
  const valid = (request.valid_actions ?? []).map((a) => String(a).trim().toLowerCase());
  const kind = String(kindIn ?? '').trim().toLowerCase();
  const owed = num(request.to_call);

  if (!valid.includes(kind)) return safeAction(valid, owed);
  // Folding for free is never right, and reads as a bug to the player.
  if (kind === 'fold' && owed <= 0 && valid.includes('check')) return { kind: 'check', amount: null };
  if (kind !== 'raise') return { kind: kind as PokerActionKind, amount: null };

  let total = typeof amount === 'number' || typeof amount === 'string' ? Number(amount) : NaN;
  if (!Number.isFinite(total) || total <= 0) total = num(request.min_raise_to);
  if (total <= 0) return safeAction(valid, owed);
  // New in the port: a figure outside the legal range is pulled into it. In
  // the original the table refused it and the opponent's turn simply stalled.
  const lo = num(request.min_raise_to);
  const hi = num(request.max_raise_to);
  if (hi > 0) total = Math.min(Math.max(total, lo), hi);
  return { kind: 'raise', amount: Math.trunc(total) };
}

const show = (value: unknown) => (value === null || value === undefined ? '?' : Array.isArray(value) ? (value.length ? value.join(' ') : 'none') : String(value));

/** The decision prompt: the opponent's own cards and the public table, never the player's cards. */
export function decisionPrompt(request: DecisionRequest): string {
  return [
    `Your hand: ${show(request.hand)}`,
    `Board: ${show(request.board)}`,
    `Street: ${show(request.street)}`,
    `Pot: ${show(request.pot)}`,
    `Your stack: ${show(request.your_stack)}`,
    `Opponent stack: ${show(request.opponent_stack)}`,
    `Current bet: ${show(request.current_bet)}`,
    `To call: ${show(request.to_call)}`,
    `Minimum raise-to (a TOTAL, not an increment): ${show(request.min_raise_to)}`,
    `Maximum raise-to (all in): ${show(request.max_raise_to)}`,
    `Valid actions: ${show(request.valid_actions)}`,
    '',
    'Decide your action now.',
  ].join('\n');
}

/** Structured output in place of the original's four required tools. */
export function decisionSchema(request: DecisionRequest) {
  return {
    type: 'object',
    properties: {
      action: { type: 'string', enum: request.valid_actions.length ? request.valid_actions : ['fold'], description: 'One of the valid actions.' },
      amount: { type: 'integer', description: 'For raise only: the TOTAL the bet becomes. 0 otherwise.' },
    },
    required: ['action', 'amount'],
  };
}

export type Ask = (request: DecisionRequest) => Promise<{ action?: unknown; amount?: unknown } | null>;

/**
 * Decide the opponent's move: the model's answer, normalized, or the safe
 * action when there is no model, it fails, or it is too slow.
 */
export async function decide(request: DecisionRequest, ask: Ask | null, timeoutMs = DECISION_TIMEOUT_MS): Promise<Decided> {
  const started = Date.now();
  const fallback = (reason: string): Decided => ({ ...safeAction(request.valid_actions, request.to_call), source: 'fallback', ms: Date.now() - started, reason });
  if (!ask) return fallback('no model key');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      ask(request),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(resolve, timeoutMs, 'timeout'); }),
    ]);
    if (answer === 'timeout') return fallback(`no answer within ${timeoutMs} ms`);
    if (!answer) return fallback('an empty answer');
    const action = String(answer.action ?? '').trim().toLowerCase();
    if (!request.valid_actions.includes(action as PokerActionKind)) return fallback(`the model answered "${action.slice(0, 40)}", not one of ${request.valid_actions.join('/')}`);
    return { ...normalizeDecision(answer.action, answer.amount, request), source: 'model', ms: Date.now() - started };
  } catch (err) {
    return fallback(`the model call failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}
