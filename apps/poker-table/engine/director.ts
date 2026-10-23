// Blindside's host: what Dex is told, and how he acts. The table decides
// everything; Dex sits across the felt and talks. He never sees his own cards
// (the server keeps them and the decider plays them) and is told the player's
// only when they ask, so nothing here can leak a hand: the state is built from
// the public view, and every result names only what the table already did.
//
// Condensed from the original's `instructions.py` (4,250 characters of table
// rules) and the cues in `moves.py`, `tools.py`, `table.py` and `state.py`;
// the rules that came from live failures are kept, word for word where they
// still apply.
import type { AppTool } from '../../../server/app-server.ts';
import { spokenCard, spokenCards } from './cards.ts';
import type { ParsedMove } from './judge.ts';
import { actions, basics, blinds, rankings, winning } from './rules.ts';
import { BIG_BLIND, SMALL_BLIND, STARTING_STACK, type LastAction, type Seat, type TableView } from './types.ts';

export const HOST = 'Dex';

/** Dex's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Dex, the player's opponent at Blindside: heads-up no-limit Texas Hold'em, ${STARTING_STACK} chips each, blinds ${SMALL_BLIND} and ${BIG_BLIND}, played until one stack is empty. You sit across the felt and talk: sharp, dry, a little playful. Needle, never personally, never cruelly. One short spoken line, two at most; teach longer only when asked. Say only what you would say aloud.
The table owns the cards, the chips and the rules; you reach it only through its tools. Every request that changes the screen is a tool call, even a single word answering your own question (a yes to the next hand or a rematch, a yes to the chart). The screen changes only when a tool runs: never say an action happened ("you're in", "new hand", "chart's up") unless the tool's result said so.
- Their move: whenever they say or type a move of their own (fold, check, call, bet or raise to an amount, all in), call play_move with their words exactly as they said them, before reacting. Only its result tells you whether it landed. Never pick, round or fix an amount for them. If they give only a number, ask for the whole move ("raise to 60"). A question about a move ("should I fold?") is not a move.
- Your own moves are played by the table, never chosen by you. Never announce, preview or promise one ("I'll call", "I check"). A result tells you the move the table played for you; only then name it, as done.
- "Deal", "next hand", or a yes when you offer one: call deal_hand. "Rematch", "new match" once the match is over: call new_match, only when they ask for one; never on your own.
- "What are my cards?": call read_my_cards and read them back. Those are THEIR cards and they are entitled to them. You never see your own: asked what you hold, bluff or deflect; hands are shown at a showdown.
- "What beats what?", "what's the best hand?", "show me the rankings": call show_hand_rankings first (it opens the chart on their screen) and answer from its result. Open it; never offer to open it instead.
- The pot, the stacks, the board, whose turn it is, the score: answer from the live table in your context, no tool needed. Every chip figure you say is copied from the live table or a tool result; never add up, estimate or carry one over. If a number is not there, you do not know it.
- Never invent an outcome (a ruling, a card, a winner, a move of yours): call the tool even when you think you know.
- When the table refuses a move or cannot read it, say so and ask what they want to do. Never acknowledge, praise or needle a move the table has not played: "you're checking? cute" over a refused check is the worst thing you can do here.
- When they press a button on screen, the table tells you what happened; carry on from that.
- The table deals the first hand itself: never ask them to deal it.
- Asked whether you are real: you are an AI, made by Atmee.`;

/** The rules, for teaching: a standing note (at most 2,000 characters), the same text as the How to play sheet. */
export const RULES_NOTE = `The rules, for teaching; assume they have never played. Answer anything about how poker works from these words, keeping every number. Asked "how do I play?", give the shape of a hand, the four moves and what beats what.
${basics()}
${actions()}
${rankings()}
${blinds()}
${winning()}`;

// Lenient on purpose: the platform answers a call that does not fit the schema
// with "invalid arguments" and the page never sees it. The app normalises.
const noArgs = { type: 'object', properties: {} };

/** The table's tools. Each is answered by the page, which asks the server that owns the cards. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'play_move',
    description: "Plays the player's own move at the table: fold, check, call, bet or raise to an amount, or all in. Call it whenever they say or type a move, before reacting, with their words exactly. The table checks the move against what they said and the rules, plays it or refuses it, then plays your move if the action is yours, and tells you what happened.",
    parameters: {
      type: 'object',
      properties: { words: { type: 'string', maxLength: 500, description: 'The player\'s move in their own words, exactly as they said or typed it: "raise to 60", "I call", "all in".' } },
      required: ['words'],
    },
    'x-atmee': { mode: 'await', timeoutSeconds: 20 },
  },
  {
    type: 'function', name: 'deal_hand',
    description: 'Deals the next hand when the player asks for one ("deal", "next hand", "another one"), then plays your move if you act first. It deals nothing while a hand is in play.',
    parameters: noArgs, 'x-atmee': { mode: 'await', timeoutSeconds: 15 },
  },
  {
    type: 'function', name: 'new_match',
    description: 'Starts a rematch: both stacks back to 1,000 and a new first hand. Only once the match is over, and only when the player asks for one; never on your own.',
    parameters: noArgs, 'x-atmee': { mode: 'await', timeoutSeconds: 15 },
  },
  {
    type: 'function', name: 'read_my_cards',
    description: "Tells you the player's own two hole cards, to read back to them. Call it when they ask what their cards are.",
    parameters: noArgs, 'x-atmee': { mode: 'await', timeoutSeconds: 8 },
  },
  {
    type: 'function', name: 'show_hand_rankings',
    description: "Opens the hand-rankings chart on the player's screen and gives you the rankings, strongest first. Call it whenever they ask what beats what, which hand wins, or to see the rankings, before answering.",
    parameters: noArgs, 'x-atmee': { mode: 'await', timeoutSeconds: 8 },
  },
];

// ---- the live table, as Dex's state ---------------------------------------------

const name = (who: Seat | 'table') => (who === 'user' ? 'they' : who === 'agent' ? 'you' : 'the table');

/** "they called", "you raised to 60", "the table dealt a new hand". */
export function describeAction(a: LastAction | null): string {
  if (!a) return 'nothing yet';
  if (a.kind === 'deal') return 'the table dealt a new hand';
  const verb = { fold: 'folded', check: 'checked', call: 'called', raise: a.amount !== undefined ? `raised to ${a.amount}` : 'raised' }[a.kind];
  return `${name(a.by)} ${verb}`;
}

/** The winner line as Dex should say it, from his own seat. */
export function resultLine(v: TableView): string {
  const w = v.winner;
  if (!w) return '';
  const rank = w.hand_rank ? ` with ${w.hand_rank}` : '';
  if (w.who === 'split') return `the pot of ${w.amount} was split: both hands were ${w.hand_rank ?? 'equal'}`;
  const who = w.who === 'user' ? 'they won' : 'you won';
  return v.revealed_hands ? `${who} ${w.amount}${rank}` : `${who} ${w.amount} when ${w.who === 'user' ? 'you' : 'they'} folded`;
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
    'NEVER state a chip, pot or stack number that is not in this line or a tool result, and never do arithmetic on one.'
  );
}

/** Who is ahead, from the hands that have finished. */
export function standing(v: TableView): string {
  const up = v.session.chips_up_user;
  return up > 0 ? `they are up ${up} chips` : up < 0 ? `they are down ${-up} chips` : 'they are exactly even';
}

function sessionLine(v: TableView): string {
  const s = v.session;
  if (!s.hands_played) return 'Session: no hand has finished yet, so nobody is ahead: do not read a live bet or a blind as a result.';
  return `Session: ${s.hands_played} hand${s.hands_played === 1 ? '' : 's'} finished; you have won ${s.hands_won_agent}, they have won ${s.hands_won_user}, and ${standing(v)}.`;
}

const handNumber = (v: TableView) => v.session.hands_played + (v.phase === 'playing' ? 1 : 0);

/** The live table, as Dex's state. Never a hole card before a showdown, and never the player's own cards. */
export function tableState(v: TableView): string {
  const parts = [`Blindside, the live table (heads-up hold'em). "They" are the player; "you" are Dex, their opponent; ${STARTING_STACK} chips each to start.`];
  if (v.phase === 'lobby') {
    parts.push('No hand is dealt yet: the cards are coming.');
  } else {
    const button = v.button === 'user' ? 'them (they posted the small blind and act first before the flop)' : 'you (you posted the small blind and act first before the flop)';
    parts.push(`Hand ${handNumber(v)}. The dealer button is on ${button}.`);
    if (v.phase === 'playing') {
      parts.push(`Street: ${v.street?.toLowerCase()}. Board: ${v.board.length ? spokenCards(v.board) : 'no cards yet'}.`);
      parts.push(`Pot ${v.pot}. Their stack ${v.players.user.stack}, bet ${v.players.user.bet}; your stack ${v.players.agent.stack}, bet ${v.players.agent.bet}.`);
      parts.push(`Last action: ${describeAction(v.last_action)}.`);
      if (v.action_to === 'user') parts.push(`Action is on them: they can ${actionWords(v)}. Their move reaches the table only through play_move.`);
      // Said from the state, not left to good intentions: live, the avatar
      // answered a call with "My turn now. I'll check." while the table had
      // played raise-to-40 a second earlier. A preview, not a claim, and wrong.
      if (v.action_to === 'agent') parts.push('ACTION IS ON YOU and the table is playing it for you RIGHT NOW: do not say what you are about to do, do not name an action, and do not guess. You will be told the move once it lands.');
    } else {
      parts.push(`Board: ${v.board.length ? spokenCards(v.board) : 'none'}. The hand is over: ${resultLine(v)}. ${showdownLine(v)}`);
      parts.push(v.phase === 'game-over'
        ? `The match is over: ${v.players.user.stack > v.players.agent.stack ? 'they have' : 'you have'} every chip. A rematch (new_match) only if they ask for one.`
        : 'Next: the next hand, when they ask for it (deal_hand) or press Deal.');
    }
  }
  parts.push(chipFacts(v));
  parts.push(sessionLine(v));
  return parts.join(' ');
}

// ---- what a tool call or a button did, in words Dex speaks from ----------------

/** One thing the table did: the facts, and how to say them. Several are spoken as one (`speak`). */
export interface Line {
  facts: string;
  cue: string;
}

/** Lines in order, as one result: every fact, then the last line's cue. */
export function speak(lines: readonly (Line | null | undefined)[]): string {
  const said = lines.filter((l): l is Line => Boolean(l));
  if (!said.length) return '';
  return [...said.map((l) => l.facts), said[said.length - 1].cue].filter(Boolean).join(' ');
}

/** A button press, told to Dex: he cannot see the screen. */
export const pressed = (button: string, outcome: string) => `The player pressed "${button}" on screen. ${outcome}`;

const moveWords = (move: { kind: string; amount?: number | null }) =>
  move.kind === 'all_in' ? 'go all in' : move.kind === 'raise' ? (move.amount != null ? `raise to ${move.amount}` : 'raise') : move.kind;

/** "their call of 10", "your raise to 60, all in": the move that landed, from the view just before it. */
function landed(a: LastAction, before: TableView, who: Seat): { noun: string; verb: string } {
  const seat = before.players[who];
  const owed = before.action_to === who ? before.to_call : 0;
  switch (a.kind) {
    case 'fold': return { noun: 'fold', verb: 'folded' };
    case 'check': return { noun: 'check', verb: 'checked' };
    case 'call': {
      // A call with nothing to call is played as a check, and said as one.
      if (owed === 0) return { noun: 'check', verb: 'checked' };
      const paid = Math.min(owed, seat.stack);
      const allIn = owed >= seat.stack ? ', all in' : '';
      return { noun: `call of ${paid}${allIn}`, verb: `called ${paid}${allIn}` };
    }
    case 'raise': {
      const allIn = before.action_to === who && a.amount === before.max_raise_to ? ', all in' : '';
      return before.current_bet === 0
        ? { noun: `bet of ${a.amount}${allIn}`, verb: `bet ${a.amount}${allIn}` }
        : { noun: `raise to ${a.amount}${allIn}`, verb: `raised to ${a.amount}${allIn}` };
    }
    default: return { noun: 'move', verb: 'moved' };
  }
}

/** New board cards since `before`, said the way a dealer would. */
function boardNews(before: TableView, after: TableView): string {
  const fresh = after.board.slice(before.board.length);
  if (!fresh.length || after.phase === 'lobby') return '';
  if (after.phase !== 'playing') return `The board ran out: ${spokenCards(fresh)}.`;
  if (after.board.length === 3) return `The flop is out: ${spokenCards(fresh)}.`;
  if (after.board.length === 4) return `The turn is the ${spokenCard(fresh[0])}.`;
  return `The river is the ${spokenCard(fresh[0])}.`;
}

function resultFacts(v: TableView): string {
  const line = `The hand is over: ${resultLine(v)}. ${showdownLine(v)}`;
  if (v.phase !== 'game-over') return line;
  const champion = v.players.user.stack > v.players.agent.stack ? 'they have won the match: you have no chips left' : 'you have won the match: they have no chips left';
  return `${line} That ends it: ${champion}.`;
}

/** Whose move it is now, or how the hand ended. */
function nextUp(v: TableView): string {
  if (v.phase === 'hand-over' || v.phase === 'game-over') return resultFacts(v);
  if (v.action_to === 'user') return `The action is on them: they can ${actionWords(v)}.`;
  if (v.action_to === 'agent') return 'The action is on you, and the table is playing your move now.';
  return '';
}

const FIGURES = 'Quote no figure that is not here or on the live table.';

function resultCue(v: TableView, mine: boolean): string {
  const first = mine ? 'Name your own move as done, then say one short in-character line about the hand.' : 'Say one short in-character line about the hand.';
  if (v.phase === 'game-over') return `${first} Ask whether they want a rematch, and call new_match only if they say so. ${FIGURES}`;
  return `${first} ${FIGURES} The next hand comes when they ask for it (deal_hand) or press Deal; never deal it yourself.`;
}

/** The table's outcomes. Each is a fact the table already settled, and how to say it. */
export const said = {
  opening: (v: TableView): Line => ({
    facts: `You have just greeted them; do not greet or introduce yourself again. The match is on at Blindside: ${STARTING_STACK} chips each, blinds ${SMALL_BLIND} and ${BIG_BLIND}, until one stack is empty. Hand 1 is dealt. ${blindsPosted(v)} ${nextUp(v)}`,
    cue: 'Go straight to the first useful line: tell them whose move it is, in one short line. Do not describe any cards, and never ask them to deal.',
  }),

  resume: (v: TableView): Line => ({
    facts: `You have just greeted them; do not greet or introduce yourself again. The player is back at your table, mid-match: hand ${handNumber(v)}; ${v.session.hands_played ? standing(v) : 'no hand has finished yet'}. ${v.phase === 'playing' ? nextUp(v) : v.phase === 'game-over' ? resultFacts(v) : 'The last hand is over; the next comes when they ask for it.'}`,
    cue: 'In one short line, carry on from the live table: say whose move it is. Do not describe any cards.',
  }),

  dealt: (v: TableView, rematch: boolean): Line => ({
    facts: `Done. ${rematch ? `A rematch: both stacks are back to ${STARTING_STACK} and hand 1 is dealt.` : `Hand ${handNumber(v)} is dealt.`} ${blindsPosted(v)} ${nextUp(v)}`,
    cue: v.action_to === 'agent'
      ? 'Say a few words about the new hand at most, and nothing about your move: the table is playing it. Do not describe any cards.'
      : 'Say one short in-character line about the new hand and tell them it is their move. Do not describe any cards: you cannot see theirs.',
  }),

  /** Their move landed (by voice or by a button). `asked` is what they asked for, when it differs from what was played. */
  played: (before: TableView, after: TableView, asked?: string): Line => {
    const a = after.last_action;
    const move = a && a.by === 'user' ? landed(a, before, 'user').noun : 'move';
    const courtesy = asked === 'fold' && a?.kind === 'check' ? ' (with nothing to call, a fold is played as a check)' : '';
    const facts = [`Done. The table played their ${move}${courtesy}.`, boardNews(before, after), nextUp(after)].filter(Boolean).join(' ');
    if (after.phase !== 'playing') return { facts, cue: resultCue(after, false) };
    if (after.action_to === 'agent') return { facts, cue: 'React to their move in a few words at most and say nothing about yours: the table is playing it.' };
    return { facts, cue: `React in one short in-character line and tell them it is their move again. ${FIGURES}` };
  },

  /** The table played Dex's move (the decider's). `again`: a second move in a row, on a new street. */
  yours: (before: TableView, after: TableView, again = false): Line => {
    const a = after.last_action!;
    const facts = [`${again ? 'Then the table played your next move' : 'The table played your move'}: you ${landed(a, before, 'agent').verb}.`, boardNews(before, after), nextUp(after)].filter(Boolean).join(' ');
    if (after.phase !== 'playing') return { facts, cue: resultCue(after, true) };
    return { facts, cue: `In one or two short in-character lines: react to their last move if they just made one, then name your own move as done, never as a plan. ${FIGURES}` };
  },

  refused: (move: { kind: string; amount?: number | null }, reason: string, v: TableView): Line => {
    const range = (move.kind === 'raise' || move.kind === 'all_in') && v.action_to === 'user' && v.valid_actions.includes('raise') ? ` A raise here is to a total from ${v.min_raise_to} to ${v.max_raise_to}.` : '';
    return {
      facts: `Refused. They asked to ${moveWords(move)} and the table refused it: ${reason}. NOTHING was applied.${range}`,
      cue: 'Say that back in one short line and ask what they want to do; never pick an amount for them.',
    };
  },

  /** play_move called with nothing usable in it. */
  noWords: (): Line => ({
    facts: 'Not played. No move came with the call: NOTHING was applied.',
    cue: 'Ask them what they want to do: fold, check, call or raise to a number.',
  }),

  /** The rankings chart, opened on their screen: the order is the answer to "what beats what". */
  rankings: (): Line => ({
    facts: `Done. The hand-rankings chart is open on their screen. ${rankings()}`,
    cue: 'Answer what they asked from this, briefly; name all ten only if they asked what beats what.',
  }),

  unclear: (words: string, reason: string): Line => ({
    facts: `Not played. The table could not read a move in "${words}" (${reason}). NOTHING was applied and no chips moved.`,
    cue: 'Ask them in one short line whether they mean fold, check, call or raise to a number; never guess an action or an amount for them, and do not say they bet.',
  }),

  /** The move is not in the player's own words at this point in the hand. */
  unheard: (words: string, heard: readonly string[]): Line => ({
    facts: `Not played. NOTHING was applied: the table did not hear "${words}" from the player at this point in the hand.${heard.length ? ` What it heard from them since the last move: "${heard.join(' ').slice(0, 240)}".` : ' It has heard nothing from them since the last move.'}`,
    cue: 'If they did mean a move, ask them to say it in full ("raise to 60") or tap it; never treat it as played.',
  }),

  /** The same move again, with nothing new from the player: it already landed. */
  repeat: (move: ParsedMove): Line => ({
    facts: `Not played again. Their ${moveWords(move) === 'go all in' ? 'all-in' : moveWords(move)} already landed a moment ago: NOTHING more was applied.`,
    cue: 'Do not treat it as a new move; carry on from the live table.',
  }),

  handInPlay: (v: TableView): Line => ({
    facts: `Not dealt. A hand is already in play (hand ${handNumber(v)}): nothing was dealt. ${nextUp(v)}`,
    cue: 'Tell them in a few words and carry on.',
  }),

  matchOver: (v: TableView): Line => ({
    facts: `Not dealt. The match is over: ${v.players.user.stack > v.players.agent.stack ? 'they have' : 'you have'} every chip.`,
    cue: 'Ask whether they want a rematch; call new_match only if they say so.',
  }),

  matchOn: (v: TableView): Line => ({
    facts: `Not started. The match is still on (hand ${handNumber(v)}; ${v.session.hands_played ? standing(v) : 'no hand has finished yet'}): a rematch comes only once a stack is empty. Nothing changed.`,
    cue: 'Tell them in one short line.',
  }),

  cards: (cards: readonly string[]): Line => ({
    facts: `Done. Their two hole cards are the ${cards.map(spokenCard).join(' and the ')}.`,
    cue: 'Read both back to them exactly as written, in one short in-character line. Do not reveal or invent your own cards, and do not tell them what to play.',
  }),

  noCards: (): Line => ({
    facts: 'No cards. No hand is in play, so they hold no cards right now.',
    cue: 'Say so in one short line and do not name any card.',
  }),
};

function blindsPosted(v: TableView): string {
  return v.button === 'user'
    ? `They have the button and posted the small blind (${v.players.user.bet}); you posted the big blind (${v.players.agent.bet}).`
    : `You have the button and posted the small blind (${v.players.agent.bet}); they posted the big blind (${v.players.user.bet}).`;
}
