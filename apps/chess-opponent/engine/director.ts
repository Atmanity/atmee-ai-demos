// What the host is told, and how it acts. The board decides everything (the
// rules, legality, its own moves); the host plays the part of the opponent
// across the table: it calls the board's tools for whatever the player asks
// the board to do, and speaks from what they return. Every result below is a
// fact plus how to say it; none asks the host to act on its own initiative.
//
// The "never" rules come from the original agent's prompt (persona.py), each
// from a real failure, and are kept.
import type { AppTool } from '../../../server/app-server.ts';
import type { Choice } from './engine.ts';
import { parseFen, PIECE_VALUES } from './engine.ts';
import { clip, MODEL_QUOTE_MAX_BYTES } from './game.ts';
import type { Action, ChessSnapshot, GameEndReason, GameResultWinner, LastMove } from './types.ts';

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the player's opponent in a game of chess, on a board on their screen: a dry-witted club player who needles a little, teaches a little and explains every move. The board owns the rules and plays your moves for you; you reach it only through its tools.
- When the player states a move they are making now ("e4", "knight to f3", "castle", "bishop takes c6"), call play_move with it before saying anything about it. Its result says whether the board took it and which move you replied with: speak only from that. Never say a move was played, legal, illegal or good before the result.
- Never call play_move for your own move, for a question ("should I play d4?", "can I castle?") or for a plan ("I'll push e5 next"). Your own move comes back in play_move's result, already on the board: say why you played it. Never name or announce a move of yours that a result has not given you.
- "Can I play black?", "let's switch sides": call choose_side. It starts a new game, so mid-game, if it is not clear they want to abandon this one now, ask first. "Go easy on me", "I'm a beginner", "play properly": call set_strength.
- "I resign", "I give up": call resign, only when they clearly concede now. "New game", "rematch": call new_game, only when they ask for one; never on your own, not even after a game ends.
- The screen changes only when you call a tool. Saying "sure, you're Black" or "fine, I'll go easy" without the call changes nothing and misleads them: call the tool every time, even when you think you know the outcome.
- Questions about the position, whose move it is, the moves so far, the opening, the material or the result: answer from the live board in your context, no tool needed.
- If the player moves a piece or presses a button on screen, the board tells you what happened; carry on from that.
How strong you are, honestly: you look one move ahead. You take a hanging piece and a mate that is there, and a two-move tactic beats you. If asked, say that in one light line. Never claim a rating, an Elo, a title or "grandmaster level"; never talk about evaluations or numbers.
There are no takebacks: if asked, say kindly that the move stands and offer a new game. A clock, odds, removing a piece or a variant: you cannot; say so in one line.
Style: understated trash talk, never an insult; no gloating, take a loss well. Name the opening once when a result gives it, and a motif (a pin, a fork, a weak square) when one appears. Avoid the phrase "best move". A player who goes quiet is thinking: at most one short, dry line, and never tell them what to play.
Speak only what you say aloud: one short sentence, two with a teaching beat, under 30 words. No lists, markdown or emojis. If asked whether you are real: you are an AI.`;

const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const awaits = (timeoutSeconds: number) => ({ mode: 'await' as const, timeoutSeconds });

/** The board's tools. Each is answered by the page, which owns the board. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'play_move',
    description: 'Plays the player\'s own move on the board. The board checks it is legal and, if it is, plays your reply; the result says what happened. Call it whenever the player states a move they are making now ("e4", "knight to f3", "castle kingside"), before reacting to it. Never for your own move, a question about a move, or a plan.',
    parameters: {
      type: 'object',
      properties: { move: { type: 'string', minLength: 1, maxLength: 80, description: 'Just the move, no other words: in the player\'s words ("knight to f3", "e4", "castle kingside") or in notation (Nf3, O-O, e2e4).' } },
      required: ['move'], additionalProperties: false,
    },
    'x-atmee': awaits(12),
  },
  {
    type: 'function', name: 'choose_side',
    description: 'Seats the player on White or Black and starts a new game (chess has no swap mid-game). If you are White after it, the result includes your first move. Call it when the player asks to play a colour or to switch sides.',
    parameters: {
      type: 'object',
      properties: { side: { type: 'string', enum: ['white', 'black', 'switch'], description: 'The colour the player wants, or "switch" for the other one.' } },
      required: ['side'], additionalProperties: false,
    },
    'x-atmee': awaits(12),
  },
  {
    type: 'function', name: 'set_strength',
    description: 'Sets how hard you play from your next move: full, casual or beginner. Call it when the player asks you to go easier or harder, or says they are a beginner.',
    parameters: {
      type: 'object',
      properties: { level: { type: 'string', enum: ['full', 'casual', 'beginner'], description: 'full: your favourite move; casual: easier; beginner: easiest.' } },
      required: ['level'], additionalProperties: false,
    },
    'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'resign',
    description: 'Resigns the game for the player. Only when the player clearly says they resign or give up now; never on your own, and never for a question like "should I resign?".',
    parameters: noArgs, 'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'new_game',
    description: 'Starts a new game with the same sides and strength. Only when the player asks for one; never on your own, not even when a game ends.',
    parameters: noArgs, 'x-atmee': awaits(12),
  },
];

export type ToolName = 'play_move' | 'choose_side' | 'set_strength' | 'resign' | 'new_game';

/**
 * A tool call as a board action, with its arguments checked: the host passes
 * what it heard, the board decides. A string is the reason nothing was done,
 * for the host to speak from.
 */
export function actionFor(name: string, args: Record<string, unknown> = {}): Action | string {
  switch (name) {
    case 'play_move': {
      const move = clip(typeof args.move === 'string' ? args.move : '', MODEL_QUOTE_MAX_BYTES);
      return move ? { kind: 'move', text: move } : 'No move was given, so nothing moved: ask the player which move they mean.';
    }
    case 'choose_side': {
      const side = args.side;
      if (side === 'white' || side === 'black') return { kind: 'side', side };
      if (side === 'switch') return { kind: 'side', side: 'other' };
      return 'No side was given, so nothing changed: ask the player whether they want White or Black.';
    }
    case 'set_strength': {
      const level = args.level;
      if (level === 'full' || level === 'casual' || level === 'beginner') return { kind: 'difficulty', level };
      return 'No level was given, so nothing changed: the levels are full, casual and beginner.';
    }
    case 'resign': return { kind: 'resign' };
    case 'new_game': return { kind: 'new' };
  }
  throw new Error(`unknown tool ${name}`);
}

const sideName = (side: 'white' | 'black') => (side === 'white' ? 'White' : 'Black');

const STRENGTH_LINES: Record<string, string> = {
  full: 'You are playing at full strength: you look one move ahead.',
  casual: 'You are playing at casual strength: each move you deliberately play your third choice (never declining a mate).',
  beginner: 'You are playing at beginner strength: each move you deliberately play your sixth choice (never declining a mate).',
};

const REASON_WORDS: Record<GameEndReason, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  insufficient_material: 'insufficient material (neither side can mate)',
  threefold_repetition: 'threefold repetition',
  fifty_moves: 'the fifty-move rule',
  resignation: 'resignation',
};

function outcome(winner: GameResultWinner, reason: GameEndReason): string {
  if (winner === 'draw') return `a draw by ${REASON_WORDS[reason]}`;
  if (reason === 'resignation') return winner === 'agent' ? 'the player resigned, so you won' : 'you resigned, so the player won';
  return winner === 'agent' ? `you won by ${REASON_WORDS[reason]}` : `the player won by ${REASON_WORDS[reason]}`;
}

/** The moves so far, numbered like a scoresheet, the last `keep` plies only. */
export function movesText(history: readonly string[], keep = 24): string {
  const start = Math.max(0, history.length - keep);
  const parts: string[] = start > 0 ? ['…'] : [];
  for (let i = start; i < history.length; i++) {
    const number = Math.floor(i / 2) + 1;
    if (i % 2 === 0) parts.push(`${number}. ${history[i]}`);
    else parts.push(i === start ? `${number}... ${history[i]}` : history[i]);
  }
  return parts.join(' ');
}

const MATERIAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** The running material count in pawns, from the player's side: not an evaluation. */
export function materialLead(fen: string, userColor: 'white' | 'black'): number {
  const position = parseFen(fen);
  if (!position) return 0;
  let white = 0;
  let black = 0;
  for (const [colour, letter] of position.pieces.values()) {
    if (!(letter in PIECE_VALUES)) continue;
    if (colour === 'w') white += MATERIAL[letter];
    else black += MATERIAL[letter];
  }
  return userColor === 'white' ? white - black : black - white;
}

function materialLine(fen: string, userColor: 'white' | 'black'): string {
  const lead = materialLead(fen, userColor);
  const pawns = (n: number) => `${n} pawn${n === 1 ? '' : 's'}`;
  if (lead > 0) return `Material: the player is ${pawns(lead)} of material ahead (a count of pieces, not an evaluation).`;
  if (lead < 0) return `Material: you are ${pawns(-lead)} of material ahead (a count of pieces, not an evaluation).`;
  return 'Material is level.';
}

/** The live board, as the host's state: everything it may need to answer questions, nothing it must invent. */
export function boardState(s: ChessSnapshot): string {
  const parts = [`Chess, live board on the player's screen. The player is ${sideName(s.user_color)}; you are ${sideName(s.user_color === 'white' ? 'black' : 'white')}.`];
  parts.push(STRENGTH_LINES[s.difficulty] ?? STRENGTH_LINES.full);
  if (s.result) {
    parts.push(`The game is over: ${outcome(s.result.winner, s.result.reason)}. A new game starts only if the player asks (new_game, or choose_side for the other colour).`);
  } else if (s.turn === 'user') {
    parts.push(`It is the player's move${s.in_check ? ', and they are in check' : ''}.`);
  } else {
    parts.push(`It is your move${s.in_check ? ', and you are in check' : ''}: the board is playing it now. Do not name it.`);
  }
  if (s.last_move) parts.push(`Last move: ${s.last_move.by === 'agent' ? 'you' : 'the player'} played ${s.last_move.san}.`);
  parts.push(s.history.length ? `Moves so far: ${movesText(s.history)}.` : 'No moves have been played yet.');
  if (s.opening) parts.push(`Opening: ${s.opening}.`);
  parts.push(materialLine(s.fen, s.user_color));
  parts.push(`Position (FEN): ${s.fen}`);
  if (!s.result && s.turn === 'user' && s.legal_moves.length) {
    parts.push(`The player's legal moves right now, for questions like "can I castle?": ${s.legal_moves.map((m) => m.san).join(', ')}. A move they state still goes through play_move. Never suggest a move unasked.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// results: what each action did, in words the host speaks from (a tool's
// result, or an event after a button or a drag)

const TAG_PHRASES: Record<string, string> = {
  checkmate: 'it is checkmate',
  check: 'it gives check',
  capture: 'it captures a piece',
  promotion: 'it promotes a pawn',
  castle_kingside: 'you castled kingside',
  castle_queenside: 'you castled queenside',
};

export const describeTags = (tags: readonly string[]) => tags.filter((t) => t in TAG_PHRASES).map((t) => TAG_PHRASES[t]).join('; ');

/** What led to the opponent's turn, folded into the text about its move. */
export interface Lead {
  /** The player's move that made it the opponent's turn. */
  userMove?: string;
  /** That move gave the opponent check. */
  check?: boolean;
  /** Something else that happened first ("a new game started with the player on Black"). */
  note?: string;
}

/** After a game ends: offered, never started on the host's own initiative. */
const ANOTHER = 'Then ask whether they would like another game; start one only if they say so.';

/** The game just ended. `winner` is 'agent' (the host), 'opponent' (the player) or 'draw'. */
function resultCue(winner: GameResultWinner, reason: GameEndReason): string {
  const line = winner === 'agent'
    ? 'You won. Acknowledge it quietly, no gloating, and mention the idea that decided it.'
    : winner === 'opponent' ? 'You lost. Give them honest credit, no excuses.' : 'It is a draw. Say something about the balance of the position.';
  return `The game just ended (${REASON_WORDS[reason]}). ${line} One sentence, under 20 words. ${ANOTHER}`;
}

export const say = {
  /** The opening, when the player moves first. */
  start: (s: ChessSnapshot) => `A new game is set up on the player's screen: they are ${sideName(s.user_color)} and move first, and you are their opponent. Welcome them in one short line and invite their first move: they can say it, type it, or drag a piece.`,

  /** The opening, when the opponent moves first: the lead of its reply. */
  startLead: (s: ChessSnapshot) => `A new game is set up on the player's screen: they are ${sideName(s.user_color)}, so you moved first. Welcome them in a few words.`,

  resume: (s: ChessSnapshot) => `The player is back at the board; the game goes on from where it was (${s.history.length} moves played). Welcome them back in one short line; ${s.result ? 'that game is over, so ask whether they would like another; start one only if they say so' : s.turn === 'user' ? 'it is their move' : 'it is your move and the board is playing it'}.`,

  /** The opponent's own move, and whatever led to it, in one text. */
  reply(lead: Lead, choice: Pick<Choice, 'san' | 'tags'>, s: ChessSnapshot): string {
    const parts: string[] = [];
    if (lead.note) parts.push(lead.note);
    if (lead.userMove) parts.push(`The player played ${lead.userMove} and it is on the board.${lead.check ? ' It gives you check; acknowledge it without drama.' : ''}`);
    parts.push(`You ${s.history.length <= 1 && !lead.userMove ? 'opened with' : 'replied'} ${choice.san}, already on the board.`);
    const facts = describeTags(choice.tags);
    if (facts) parts.push(`What your move does: ${facts}.`);
    parts.push(`In character, ${lead.userMove ? 'a few words on their move if it deserves them, then ' : ''}say in one short line why you played it: the idea, the piece it improves, the plan it sets up.`);
    if (s.opening) parts.push(`The opening is ${s.opening}. Name the opening ONLY if you have not named it already this game.`);
    parts.push('Do not narrate any other move, and do not say the phrase "best move".');
    return parts.join(' ');
  },

  /** The game ended, on whoever's move. Said once: no separate commentary on the final move. */
  result(s: ChessSnapshot, last: LastMove | null): string {
    const final = last ? `${last.by === 'agent' ? 'You' : 'The player'} played ${last.san}, and it is on the board. ` : '';
    return final + resultCue(s.result!.winner, s.result!.reason);
  },

  refused: (said: string, why: string) => `The board REFUSED the player's move '${said}': ${why}. It was NOT played, the position is unchanged and it is still their move; the reason is on their screen. Say so plainly in one short line, name the reason and invite another move. Do NOT congratulate them or describe it as played.`,

  ambiguous: (said: string, why: string) => `The player's move '${said}' could be either of two pieces: ${why}. Nothing was played. Ask them which, in one short line. Do NOT call it illegal.`,

  unreadable: (said: string) => `The board could not read '${said}' as a move, so nothing was played and the position is unchanged. Do NOT say it is illegal: it may well be legal. Ask them to say it again plainly, like "knight to f3", or to drag the piece.`,

  /** The side the player already has: nothing is reset. */
  sideSame: (s: ChessSnapshot, played: boolean) => `The player is already playing ${sideName(s.user_color)}, so nothing changed${played ? ' and the game goes on (a fresh game on the same side is new_game, only if they ask for one)' : ': this game has only just started'}. Say so in one short line; do not claim anything changed.`,

  sideRefused: (why: string) => `Nothing changed: ${why}. The game goes on. Say so in one short line; do not claim they changed sides.`,

  /** A reset that leaves the player to move (no opponent move follows). */
  freshBoard: (s: ChessSnapshot, why: 'new' | 'side') => why === 'side'
    ? `Done: the board started a new game with the player on ${sideName(s.user_color)}, so they move first. Say that in one short line and invite their first move.`
    : `A fresh game just started and the board is reset; the player is ${sideName(s.user_color)} and moves first. Say one short line inviting the first move. Do not recap the last game.`,

  /** A reset that makes the opponent move first: the lead of its reply. */
  freshBoardLead: (s: ChessSnapshot, why: 'new' | 'side') => why === 'side'
    ? `Done: the board started a new game with the player on ${sideName(s.user_color)}, so you moved first.`
    : `A fresh game just started; the player is ${sideName(s.user_color)}, so you moved first. Do not recap the last game.`,

  difficulty: (level: string) => `Done: you are playing at ${level} strength from your next move on${level === 'full' ? '' : ': you deliberately play a move lower in your own ranking, and never decline a mate'}. Say so in one short, unbothered line; no promises about what you will play.`,

  difficultySame: (level: string) => `You were already playing at ${level} strength, so nothing changed. Say so in one short line.`,

  difficultyRefused: (why: string) => `Nothing changed: ${why}. Say so in one short line and do not claim anything changed.`,

  resigned: () => `The player resigned, so the game is over and you won. Thank them for the game in one short, gracious line. ${ANOTHER}`,

  refusedCommand: (why: string) => `Nothing changed: ${why}. Say so in one short line.`,
};

/** A button press or a move made by hand, told to the host: it cannot see the screen. */
export const pressed = (what: string, outcome: string) => `The player ${what} on screen. ${outcome}`;
