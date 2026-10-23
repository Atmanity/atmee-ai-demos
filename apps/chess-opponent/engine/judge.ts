// What a line the player said or typed asks the board to do, by rules. The
// host decides that itself and calls the board's tools; these rules are the
// safety net under it: when the player's words CLEARLY ask for an action that
// is safe to do twice (resign, a new game, a side before any move, a
// strength) and the host does not call the tool, the page does it (`mustDo`).
//
// Two kinds of mistake, unequal: acting on a line the player did not mean as
// an action (a reset game, a resignation) is far worse than missing one (the
// host still has it). So the rules act only on clear phrasings, and
// everything doubtful is left to the host. A move is never the net's: a move
// played twice is two moves.
import { Chess } from 'chess.js';
import { FIRST_PHRASES, parseSide, parseStrength, SECOND_PHRASES } from './game.ts';
import { despellRanks, looksLikeMoveStatement } from './spoken.ts';
import type { ChessSnapshot, Side, Strength } from './types.ts';

export type Verdict =
  | { kind: 'move'; text: string }
  | { kind: 'side'; side: Side | 'other' }
  | { kind: 'difficulty'; level: Strength }
  | { kind: 'resign' }
  | { kind: 'new' }
  /** It may be an action, but the rules cannot settle it: the host decides. */
  | { kind: 'unsure' }
  /** Not an action: talk. */
  | { kind: 'none' };

export interface JudgeContext {
  /** Plies played in this game: turn-order phrases ("you go first") only seat the player before the first move. */
  moves: number;
}

const NONE: Verdict = { kind: 'none' };
const UNSURE: Verdict = { kind: 'unsure' };

/**
 * A recogniser's transcript, tidied for the move gate: its sentence-final full
 * stop is not a second clause ("Knight to f3." is one instruction), nor is a
 * comma before or after "please" ("E four, please."), and a square written
 * apart ("E 4", "e-4") is one square.
 */
export function tidy(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '')
    .trim()
    .replace(/,\s*please$/i, ' please')
    .replace(/^please,\s*/i, 'please ')
    .replace(/\b([a-hA-H])[-\s]([1-8])\b/g, (_m, file: string, rank: string) => file.toLowerCase() + rank);
}

const norm = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();

type Form = 'request' | 'question' | 'statement';
const REQUEST_OPENER = /^(can|could|will|would|may|please|let|let's|lets|i'd like|id like|how about)\b/;
const QUESTION_OPENER = /^(is|are|am|was|were|do|does|did|what|what's|whats|why|how|when|who|which|where|should|shall|have|has|isn't|aren't|don't you)\b/;

function formOf(raw: string, t: string): Form {
  if (REQUEST_OPENER.test(t)) return 'request';
  if (QUESTION_OPENER.test(t) || raw.trim().endsWith('?')) return 'question';
  return 'statement';
}

/** Not now, not really, or not at all. */
const HEDGED = /\b(maybe|perhaps|might|if|later|after this|next time|not yet|thinking (of|about)|wondering|wonder|probably|should i|don't|dont|do not|won't|wont|never|not)\b/;

const RESIGN = /\b(i (resign|concede|give up|surrender|forfeit|quit)|i'll (resign|concede)|i'm (resigning|conceding)|i am (resigning|conceding))\b|^(resign|resigning)( the game)?( now)?$/;
const RESIGN_WORDS = /\b(resign\w*|concede\w*|give up|giving up|forfeit\w*|surrender\w*|quit|throw in the towel)\b/;

const NEW_GAME = /\b(new game|another game|one more game|fresh game|play again|rematch|start (over|again|afresh|a new game|another)|restart|reset (the )?(board|game)|begin again)\b/;

const SWAP = /\b(switch|swap|change|trade|flip) (sides|colou?rs|places|seats)\b|\bother (side|colou?r)\b/;
const COLOUR = /\b(white|black|light|dark)\b/;
const SQUARE_TALK = /\b(light|dark) (coloured |colored )?squares?\b/;
const SIDE_REQUEST = /\b(play|playing|be|have|take|get|give me|want|wanna|prefer|rather|let me|switch to|swap to|change to|try)\b/;
/** A bare answer to "white or black?": nothing but a colour and politeness. */
const SIDE_FILLER = new Set(['white', 'black', 'please', 'the', 'pieces', 'side', 'then', 'ok', 'okay', "i'll", 'i', 'me', 'as', 'be', 'take', 'play', 'with', 'want', 'go', 'for', 'sure', 'yes']);
const PIECE_NAMES = /\b(knight|knights|night|bishop|bishops|rook|rooks|queen|queens|king|kings|pawn|pawns|castle)\b/;

// Difficulty, by what the player wants rather than by which word appears:
// "this is too easy" asks for MORE, "don't go easy on me" too.
const WANTS_FULL = /\b(too easy|not hard enough|(play|go) (harder|properly|seriously|for real|all out|full)|full (strength|power|level|mode)|no mercy|(don't|dont|do not) (go|play|be|take it) (easy|easier|soft|gentle)|(don't|dont|do not) hold back|stop (going easy|holding back|being (soft|gentle))|your (best|hardest|strongest)|(make it|be|play|go) (harder|tougher|stronger)|harder please|raise the (difficulty|level)|(set|switch|change|put) (it |the difficulty |the level )?(to|on) full)\b/;
const WANTS_BEGINNER = /\b(i'm a (complete |total |real )?(beginner|novice)|i am a (complete |total |real )?(beginner|novice)|beginner (mode|level|strength|please)|(set|switch|change|put) (it |the difficulty |the level )?(to|on) beginner|very easy|easiest|much easier|as easy as)\b/;
const WANTS_CASUAL = /\b(go(ing)? easy|go easier|take it easy|(make it|play|be|go) (a (bit|little) )?(easier|gentler|softer)|easier (please|on me|for me)|be gentle|too (hard|strong|difficult|tough)|hold back|tone it down|dial it (down|back)|lower the (difficulty|level)|casual (mode|level|strength|please)|(set|switch|change|put) (it |the difficulty |the level )?(to|on) casual)\b|^easier( please)?$/;
const DIFFICULTY_WORDS = /\b(easy|easier|hard|harder|beginner|novice|strength|strong|difficulty|level|mercy|gentle|casual)\b/;

/** Anything that might be one of the board's actions, for the host to look at. */
const ACTION_WORDS = /[a-h][1-8]|\b(castl\w*|o-o|0-0|knight|night|bishop|rook|queen|king|pawn|takes|captures?|white|black|sides?|colou?rs?|first|second|easy|easier|harder|beginner|strength|difficulty|mercy|resign\w*|concede|give up|forfeit|surrender|new game|again|restart|rematch|start over)\b/;

function sideVerdict(t: string, form: Form, hedged: boolean, ctx: JudgeContext): Verdict | null {
  const talk = t.replace(SQUARE_TALK, ' ');
  const colour = COLOUR.test(talk);
  const turnOrder = SECOND_PHRASES.test(talk) || FIRST_PHRASES.test(talk);
  if (!SWAP.test(talk) && !colour && !turnOrder) return null;
  if (form === 'question') return NONE;   // "am I white?", "is black winning?": the board answers
  // "take black's knight" names a colour and a request verb and is about a piece.
  if (PIECE_NAMES.test(talk) || hedged) return UNSURE;
  if (SWAP.test(talk)) return { kind: 'side', side: 'other' };
  const side = parseSide(talk);
  if (!side) return UNSURE;
  const words = talk.split(' ');
  const bare = words.length <= 4 && words.every((w) => SIDE_FILLER.has(w));
  if (colour && (SIDE_REQUEST.test(talk) || bare)) return { kind: 'side', side };
  // "you go first" seats someone only before the game has begun.
  if (!colour && turnOrder && ctx.moves === 0) return { kind: 'side', side };
  return UNSURE;
}

function difficultyVerdict(t: string, form: Form): Verdict | null {
  const full = WANTS_FULL.test(t);
  const beginner = WANTS_BEGINNER.test(t);
  const casual = WANTS_CASUAL.test(t);
  if (!full && !beginner && !casual && !DIFFICULTY_WORDS.test(t)) return null;
  if (form === 'question') return NONE;   // "are you going easy on me?", "how strong are you?"
  if (full) return { kind: 'difficulty', level: 'full' };
  if (/\b(not|don't|dont|never)\b/.test(t)) return UNSURE;   // "I'm not a beginner"
  if (beginner) return { kind: 'difficulty', level: 'beginner' };
  if (casual) return { kind: 'difficulty', level: parseStrength(t) === 'beginner' ? 'beginner' : 'casual' };
  return UNSURE;
}

/**
 * A typed line that is exactly a legal move in the position, as chess.js reads
 * SAN or UCI ("Nf6", "exd5", "e2e4", "O-O"; a trailing full stop allowed), or
 * null. Typed text has no recognition errors, so such a line is played at once
 * like a move by hand: once typed "Nf6" went to the host as chat, was praised
 * as "developing your knight", and never reached the board.
 */
export function typedMove(text: string, s: Pick<ChessSnapshot, 'fen' | 'turn' | 'result'>): string | null {
  if (s.result || s.turn !== 'user') return null;
  const line = String(text ?? '').trim().replace(/\.$/, '');
  if (!line || /\s/.test(line) || line.length > 12) return null;
  try {
    return new Chess(s.fen).move(line).lan;
  } catch {
    return null;
  }
}

/** What a line typed or said means to the board, by rules. */
export function judge(input: string, ctx: JudgeContext = { moves: 0 }): Verdict {
  const text = tidy(input);
  if (!text) return NONE;
  // The move gate first: a move is the commonest thing said at a board.
  if (looksLikeMoveStatement(text)) return { kind: 'move', text };

  const t = norm(text);
  const form = formOf(text, t);
  const hedged = HEDGED.test(t);

  if (RESIGN.test(t) || RESIGN_WORDS.test(t)) {
    // A resignation cannot be taken back: only a plain statement of it counts.
    if (RESIGN.test(t) && form === 'statement' && !hedged) return { kind: 'resign' };
    return form === 'request' ? UNSURE : NONE;   // "can I resign?" -> unsure; "should I resign?" -> talk
  }
  if (NEW_GAME.test(t)) {
    if (form === 'question' && !/^(can|could|shall) we\b/.test(t)) return NONE;
    return hedged ? UNSURE : { kind: 'new' };
  }
  const side = sideVerdict(t, form, hedged, ctx);
  if (side) return side;
  const difficulty = difficultyVerdict(t, form);
  if (difficulty) return difficulty;
  if (form !== 'question' && ACTION_WORDS.test(despellRanks(t))) return UNSURE;
  return NONE;
}

/**
 * The recogniser's spellings of the words the net listens for: "I re-sign",
 * "re-match", "start-over" are how "I resign", "rematch" and "start over"
 * can come back.
 */
export function heardAs(text: string): string {
  return String(text ?? '')
    .replace(/\bre[-\s]sign(ing|s)?\b/gi, (_m, end: string | undefined) => `resign${end ?? ''}`)
    .replace(/\bre[-\s]match\b/gi, 'rematch')
    .replace(/\bstart-over\b/gi, 'start over');
}

/** The tool call the safety net makes when the host does not. */
export interface NetCall {
  name: 'resign' | 'new_game' | 'choose_side' | 'set_strength';
  arguments: Record<string, unknown>;
}

/**
 * The board action the player's words clearly ask for, among those safe to do
 * twice: a second resignation is refused, a second new game is the same empty
 * board, a strength or a side set twice is set once. Never a move (a doubled
 * move is two moves), and never a side swap that would throw away a game in
 * progress: the host may rightly be asking "abandon this one?" first.
 */
export function mustDo(text: string, ctx: { moves: number; over: boolean }): NetCall | null {
  const heard = heardAs(text);
  let verdict = judge(heard, { moves: ctx.moves });
  // "Yes, start over as Black" answers a side question: it is a side request
  // (choose_side), not a bare reset. Read as a reset, the net once dealt a
  // second fresh game after the host had already seated the player.
  if (verdict.kind === 'new') {
    const side = parseSide(norm(tidy(heard)).replace(SQUARE_TALK, ' '));
    if (side) verdict = { kind: 'side', side };
  }
  switch (verdict.kind) {
    case 'resign': return ctx.over ? null : { name: 'resign', arguments: {} };
    case 'new': return { name: 'new_game', arguments: {} };
    case 'side':
      if (ctx.moves > 0 && !ctx.over) return null;
      return { name: 'choose_side', arguments: { side: verdict.side === 'other' ? 'switch' : verdict.side } };
    case 'difficulty': return { name: 'set_strength', arguments: { level: verdict.level } };
    default: return null;
  }
}
