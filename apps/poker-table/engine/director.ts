// What the avatar is told, and when. The table decides everything; the avatar
// sits opposite and talks. It never sees its own cards (the server keeps them
// and plays its moves) and it is never told the player's cards unless they
// ask, so nothing here can leak a hand: the state is built from the public
// view, and the events name only what the table already did.
//
// Condensed from the original's `instructions.py` (4,250 characters of table
// rules) and the cues in `moves.py`, `tools.py`, `table.py` and `state.py`.
import { spokenCard, spokenCards } from './cards.ts';
import { actions, basics, blinds, rankings, winning } from './rules.ts';
import { BIG_BLIND, SMALL_BLIND, STARTING_STACK, type LastAction, type Seat, type TableView } from './types.ts';

/** Standing rules, sent once as notes (each at most 2,000 characters). */
export const NOTES = [
  `You are playing heads-up no-limit Texas Hold'em against the person you are talking to: you are their opponent at this table, not a commentator. Needling them is part of heads-up poker; do it in your own voice, never personal, never cruel. Default to one sharp sentence under 18 words; teach longer only when asked how the game works. Output only what you say aloud: no labels, no stage directions.
The table (the app) owns the cards, the chips and the rules, and deals by itself: never ask them to deal. Your state is the live table; treat it as the truth. Every chip figure you say (pot, stacks, bets, the minimum raise) must be copied from it. If a number is not there, you do not know it: say so. Never add up, estimate, or carry a figure over from earlier.
You never see your own two cards: the table keeps them and plays your moves for you. Never claim, announce or preview an action of your own ("I'll check", "I raise you"): while the action is on you, say nothing about what you will do. The app tells you the move the table played once it has landed; only then comment on it. If they ask what you hold, bluff or deflect: hands are shown at a showdown. If asked whether you are real: you are an AI avatar, created by Atmee.`,
  `The table reads the player's words itself. When they announce a move ("I call", "raise to 40", "I fold", "check", "all in"), you cannot know yet whether it landed: say only a few words like "Let's see" and stop. The app then tells you what the table did: applied, refused with the reason, or could not read. That is the truth about their move. NEVER acknowledge, praise or needle a move the app has not reported: saying "you're checking? cute" while their check was refused and the bet still stands is the worst thing you can do at this table. If the table could not read an action, ask whether they mean fold, check, call or raise to a number. Never guess an action or an amount for them, and never round their number up to the minimum: those are their chips. The same for a new hand ("deal", "another hand"): a few words, then wait for the app.
"What are my cards?": say you will look, and wait; the app reads their cards to you. Those are THEIR cards and they are entitled to them; card secrecy is about yours.
"Who's winning?", "how many hands have we played?": answer only from the session line in your state. A hand counts once it finishes; a live bet is not a result.`,
  `Assume they have never played. Anything about how poker works ("how do I play", "what does raise mean", "what are the blinds") you answer from these words, keeping every number, never from memory. Asked "how do I play?", give the shape of a hand, the four moves and what beats what, not the buttons they can already see.
${basics()}
${actions()}`,
  `More of the rules, for the same questions ("what beats what", "what's a flush", "how does this end"). Say all ten rankings when asked what beats what, in this order:
${rankings()}
${blinds()}
${winning()}
The How to play button on the table lists the hand rankings, if they want to look.`,
];

const name = (who: Seat | 'table') => (who === 'user' ? 'they' : who === 'agent' ? 'you' : 'the table');

/** "they called", "you raised to 60", "the table dealt a new hand". */
export function describeAction(a: LastAction | null): string {
  if (!a) return 'nothing yet';
  if (a.kind === 'deal') return 'the table dealt a new hand';
  const verb = { fold: 'folded', check: 'checked', call: 'called', raise: a.amount !== undefined ? `raised to ${a.amount}` : 'raised' }[a.kind];
  return `${name(a.by)} ${verb}`;
}

/** The winner line as the avatar should say it, from its own seat. */
export function resultLine(v: TableView): string {
  const w = v.winner;
  if (!w) return '';
  const rank = w.hand_rank ? ` with ${w.hand_rank}` : '';
  if (w.who === 'split') return `the pot of ${w.amount} was split: both hands were ${w.hand_rank ?? 'equal'}`;
  const who = w.who === 'user' ? 'they won' : 'you won';
  const how = v.revealed_hands ? `${who} ${w.amount}${rank}` : `${who} ${w.amount} when ${w.who === 'user' ? 'you' : 'they'} folded`;
  return how;
}

function showdownLine(v: TableView): string {
  if (!v.revealed_hands) return 'No cards were shown.';
  return `At the showdown they showed ${spokenCards(v.revealed_hands.user)} and you showed ${spokenCards(v.revealed_hands.agent)}.`;
}

const actionWords = (v: TableView): string => {
  const parts: string[] = [];
  for (const a of v.valid_actions) {
    if (a === 'fold') parts.push('fold');
    if (a === 'check') parts.push('check');
    if (a === 'call') parts.push(`call ${v.to_call}`);
    if (a === 'raise') parts.push(`raise to anything from ${v.min_raise_to} up to ${v.max_raise_to} (all in)`);
  }
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : parts.join('');
};

/**
 * The only chip figures that may be said out loud, spelled out. Live, across
 * three turns of ONE hand, the pot was reported as 270, then 960, then 303:
 * the figures were in the state but read like a debug dump, so they are
 * restated as a sentence with the prohibition attached, every time. `to_call`
 * belongs to whoever is TO ACT: a line hard-coded to "they owe" told the player
 * they owed 40 a beat after they had raised to 60.
 */
export function chipFacts(v: TableView): string {
  const owe = v.action_to === 'user' ? `they owe=${v.to_call} to call` : v.action_to === 'agent' ? `you owe=${v.to_call} to call` : 'nobody owes anything to call';
  const raise = v.action_to && v.valid_actions.includes('raise') ? `, minimum raise-to=${v.min_raise_to}` : '';
  return (
    `Authoritative chip figures, from the table: pot=${v.pot}, their stack=${v.players.user.stack}, your stack=${v.players.agent.stack}, ${owe}${raise}, blinds=${SMALL_BLIND}/${BIG_BLIND}. ` +
    'NEVER state a chip, pot or stack number that is not in this line, and never do arithmetic on one — if it is not here, do not say it.'
  );
}

function sessionLine(v: TableView): string {
  const s = v.session;
  if (!s.hands_played) return 'Session: no hand has finished yet, so nobody is ahead: do not read a live bet or a blind as a result.';
  const standing = s.chips_up_user > 0 ? `they are up ${s.chips_up_user} chips` : s.chips_up_user < 0 ? `they are down ${-s.chips_up_user} chips` : 'they are exactly even';
  return `Session: ${s.hands_played} hand${s.hands_played === 1 ? '' : 's'} finished; you have won ${s.hands_won_agent}, they have won ${s.hands_won_user}, and ${standing}.`;
}

/** The live table, as the avatar's state. Never a hole card before a showdown, and never the player's own cards. */
export function tableState(v: TableView): string {
  const parts = [`Heads-up hold'em, the live table. "They" are the player; "you" are their opponent; ${STARTING_STACK} chips each to start.`];
  if (v.phase === 'lobby') {
    parts.push('No hand is dealt yet: the cards are coming.');
  } else {
    const hand = v.session.hands_played + (v.phase === 'playing' ? 1 : 0);
    const button = v.button === 'user' ? 'them (they posted the small blind and act first before the flop)' : 'you (you posted the small blind and act first before the flop)';
    parts.push(`Hand ${hand}. The dealer button is on ${button}.`);
    if (v.phase === 'playing') {
      parts.push(`Street: ${v.street?.toLowerCase()}. Board: ${v.board.length ? spokenCards(v.board) : 'no cards yet'}.`);
      parts.push(`Pot ${v.pot}. Their stack ${v.players.user.stack}, bet ${v.players.user.bet}; your stack ${v.players.agent.stack}, bet ${v.players.agent.bet}.`);
      parts.push(`Last action: ${describeAction(v.last_action)}.`);
      if (v.action_to === 'user') parts.push(`Action is on them: they can ${actionWords(v)}.`);
      // Said from the state, not left to good intentions: live, the avatar
      // answered a call with "My turn now. I'll check." while the table had
      // played raise-to-40 a second earlier. A preview, not a claim, and wrong.
      if (v.action_to === 'agent') parts.push('ACTION IS ON YOU and the table is playing it for you RIGHT NOW: do not say what you are about to do, do not name an action, and do not guess. You will be told the move once it lands.');
    } else {
      parts.push(`Board: ${v.board.length ? spokenCards(v.board) : 'none'}. The hand is over: ${resultLine(v)}. ${showdownLine(v)}`);
      parts.push(v.phase === 'game-over'
        ? `The match is over: ${v.players.user.stack > v.players.agent.stack ? 'they have' : 'you have'} every chip. They can restart the match for a rematch.`
        : 'Next: they can deal the next hand (the Deal button, or "deal").');
    }
  }
  parts.push(chipFacts(v));
  parts.push(sessionLine(v));
  return parts.join(' ');
}

const kindWords = (kind: string, amount?: number | null) =>
  kind === 'all_in' ? 'all-in' : kind === 'raise' && amount !== undefined && amount !== null ? `raise to ${amount}` : kind;

/** Event texts: one per outcome, each an instruction about a fact the table already settled. */
export const say = {
  start: () =>
    `A heads-up match starts: ${STARTING_STACK} chips each, blinds ${SMALL_BLIND} and ${BIG_BLIND}, and the first hand is already dealt. Greet the other player in one short line and tell them the cards are out. Do not ask them to deal, and do not describe any cards.`,
  resume: () =>
    'You are back at the table with the same player, mid-match; the table is in your state. Say one short line and carry on. Do not describe any cards.',
  applied: (a: LastAction | null) =>
    `The table has ALREADY applied their ${a && a.kind !== 'deal' ? kindWords(a.kind, a.amount) : 'move'} — it is done. Acknowledge it in one short in-character line.`,
  refused: (kind: string, reason: string, v: TableView) => {
    const range = kind === 'raise' && v.action_to === 'user' && v.valid_actions.includes('raise') ? ` A raise here is to a total from ${v.min_raise_to} to ${v.max_raise_to}.` : '';
    return `They asked to ${kindWords(kind)} and the table refused it: ${reason}. NOTHING was applied.${range} Say that back in one short line and ask what they want to do; do not pick an amount for them.`;
  },
  unclear: (reason: string) =>
    `The table could not read an action in that — ${reason}. NOTHING was applied and no chips moved. In one short in-character line, ask them whether they mean fold, check, call, or raise to a number. Do NOT guess an action or an amount for them, and do not say they bet.`,
  dealt: (restart: boolean) =>
    restart
      ? `A NEW MATCH: stacks are back to ${STARTING_STACK} each and the first hand is dealt. Say one short line about the rematch. Do not describe any cards — you cannot see theirs.`
      : 'A NEW HAND IS DEALT. Say one short line about it. Do not describe any cards — you cannot see theirs.',
  dealRefused: (reason: string) => `They asked for a new hand and the table refused: ${reason}. Say that and nothing more.`,
  ownCards: (cards: string[]) =>
    `They asked what their cards are: their two hole cards are ${cards.map(spokenCard).join(' and ')}. Read both back to them exactly as written, in one short in-character line. Do not reveal or invent your own cards, and do not tell them what to do.`,
  noCards: () => 'They asked what their cards are, but no hand is in play. Say so in one short line and do not name any card.',
  /**
   * The line after the table plays the opponent's move. It names the move the
   * table APPLIED (so the figure is the one that landed), and nothing about the
   * player's last move: live, a line here that opened "you called" left the
   * avatar's own raise unsaid, and the player saw the chips move and never heard why.
   */
  yourMove: (a: LastAction) => {
    const move = kindWords(a.kind, a.amount);
    return `The table just played your ${move}. Say ONE short in-character line naming YOUR OWN ${a.kind}${a.amount !== undefined ? ` (to ${a.amount})` : ''}; state no other chip amount. Do not say you are about to do something: it is done. And say nothing about the opponent's last move: that was answered on its own turn.`;
  },
  result: (v: TableView) => {
    if (!v.winner) return '';
    const line = `The hand is over: ${resultLine(v)}. ${showdownLine(v)}`;
    if (v.phase === 'game-over') {
      const champion = v.players.user.stack > v.players.agent.stack ? 'they have won the match: you have no chips left' : 'you have won the match: they have no chips left';
      return `${line} That ends it: ${champion}. Say one short line about it and offer a rematch (they can restart the match).`;
    }
    return `${line} Say one short line about it, using only the figures on the table. They can deal the next hand.`;
  },
};
