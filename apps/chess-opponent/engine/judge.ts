// Turning words into actions. The original agent had five tools the model
// chose between (play_user_move, choose_side, set_difficulty, resign,
// new_game) plus a deterministic move gate in front of the model. The Avatar
// API has no function calling, so the app decides: the same gate and
// parsers by rules first, and the app's own model call (server-side) only for
// the lines the rules cannot settle. Whatever the route, the BOARD has the
// last word: a "move" is still resolved and judged by game.ts.
//
// Two kinds of mistake, unequal: acting on a line the player did not mean as
// an action (a move they cannot take back, a reset game, a resignation) is far
// worse than ignoring one (they say it again, or press the button). So rules
// act only on clear phrasings, and everything doubtful goes to the model with
// the same bias.
import { FIRST_PHRASES, parseSide, parseStrength, SECOND_PHRASES } from './game.ts';
import { despellRanks, looksLikeMoveStatement } from './spoken.ts';
import type { Action, Side, Strength } from './types.ts';

export type Via = 'rules' | 'model';
export type Verdict =
  | { kind: 'move'; text: string; via: Via }
  | { kind: 'side'; side: Side | 'other'; via: Via }
  | { kind: 'difficulty'; level: Strength; via: Via }
  | { kind: 'resign'; via: Via }
  | { kind: 'new'; via: Via }
  /** The rules cannot settle it; the server's model may. */
  | { kind: 'model' }
  /** Not an action: the avatar answers it. */
  | { kind: 'none' };

export interface JudgeContext {
  /** Plies played in this game: turn-order phrases ("you go first") only seat the player before the first move. */
  moves: number;
}

const NONE: Verdict = { kind: 'none' };
const MODEL: Verdict = { kind: 'model' };

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

/** Anything that might be one of the board's actions, for the model to look at. */
const ACTION_WORDS = /[a-h][1-8]|\b(castl\w*|o-o|0-0|knight|night|bishop|rook|queen|king|pawn|takes|captures?|white|black|sides?|colou?rs?|first|second|easy|easier|harder|beginner|strength|difficulty|mercy|resign\w*|concede|give up|forfeit|surrender|new game|again|restart|rematch|start over)\b/;

function sideVerdict(t: string, form: Form, hedged: boolean, ctx: JudgeContext): Verdict | null {
  const talk = t.replace(SQUARE_TALK, ' ');
  const colour = COLOUR.test(talk);
  const turnOrder = SECOND_PHRASES.test(talk) || FIRST_PHRASES.test(talk);
  if (!SWAP.test(talk) && !colour && !turnOrder) return null;
  if (form === 'question') return NONE;   // "am I white?", "is black winning?": the state answers
  // "take black's knight" names a colour and a request verb and is about a piece.
  if (PIECE_NAMES.test(talk) || hedged) return MODEL;
  if (SWAP.test(talk)) return { kind: 'side', side: 'other', via: 'rules' };
  const side = parseSide(talk);
  if (!side) return MODEL;
  const words = talk.split(' ');
  const bare = words.length <= 4 && words.every((w) => SIDE_FILLER.has(w));
  if (colour && (SIDE_REQUEST.test(talk) || bare)) return { kind: 'side', side, via: 'rules' };
  // "you go first" seats someone only before the game has begun.
  if (!colour && turnOrder && ctx.moves === 0) return { kind: 'side', side, via: 'rules' };
  return MODEL;
}

function difficultyVerdict(t: string, form: Form): Verdict | null {
  const full = WANTS_FULL.test(t);
  const beginner = WANTS_BEGINNER.test(t);
  const casual = WANTS_CASUAL.test(t);
  if (!full && !beginner && !casual && !DIFFICULTY_WORDS.test(t)) return null;
  if (form === 'question') return NONE;   // "are you going easy on me?", "how strong are you?"
  if (full) return { kind: 'difficulty', level: 'full', via: 'rules' };
  if (/\b(not|don't|dont|never)\b/.test(t)) return MODEL;   // "I'm not a beginner"
  if (beginner) return { kind: 'difficulty', level: 'beginner', via: 'rules' };
  if (casual) return { kind: 'difficulty', level: parseStrength(t) === 'beginner' ? 'beginner' : 'casual', via: 'rules' };
  return MODEL;
}

/** What a line typed or said means to the board, by rules. */
export function judge(input: string, ctx: JudgeContext = { moves: 0 }): Verdict {
  const text = tidy(input);
  if (!text) return NONE;
  // The move gate first: a move is the commonest thing said at a board.
  if (looksLikeMoveStatement(text)) return { kind: 'move', text, via: 'rules' };

  const t = norm(text);
  const form = formOf(text, t);
  const hedged = HEDGED.test(t);

  if (RESIGN.test(t) || RESIGN_WORDS.test(t)) {
    // A resignation cannot be taken back: only a plain statement of it counts.
    if (RESIGN.test(t) && form === 'statement' && !hedged) return { kind: 'resign', via: 'rules' };
    return form === 'request' ? MODEL : NONE;   // "can I resign?" -> the model; "should I resign?" -> the avatar
  }
  if (NEW_GAME.test(t)) {
    if (form === 'question' && !/^(can|could|shall) we\b/.test(t)) return NONE;
    return hedged ? MODEL : { kind: 'new', via: 'rules' };
  }
  const side = sideVerdict(t, form, hedged, ctx);
  if (side) return side;
  const difficulty = difficultyVerdict(t, form);
  if (difficulty) return difficulty;
  if (form !== 'question' && ACTION_WORDS.test(despellRanks(t))) return MODEL;
  return NONE;
}

export function toAction(v: Verdict): Action | null {
  switch (v.kind) {
    case 'move': return { kind: 'move', text: v.text };
    case 'side': return { kind: 'side', side: v.side };
    case 'difficulty': return { kind: 'difficulty', level: v.level };
    case 'resign': return { kind: 'resign' };
    case 'new': return { kind: 'new' };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// the model's half (called from server.ts; the key never reaches the page)

export interface ModelContext {
  userColor: Side;
  turn: 'user' | 'agent' | null;
  /** The player's legal moves in SAN (empty when it is not their move). */
  legal: string[];
  moves: number;
  over: boolean;
}

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['move', 'side', 'difficulty', 'resign', 'new_game', 'none'], description: 'What the player is asking the board to do right now.' },
    move: { type: 'string', description: 'For a move: the move in SAN, from the legal list (e.g. Nf3, exd5, O-O). Empty otherwise.' },
    side: { type: 'string', enum: ['white', 'black', 'none'], description: 'For a side request: the colour the player wants to play.' },
    level: { type: 'string', enum: ['full', 'casual', 'beginner', 'none'], description: 'For a difficulty request: the level.' },
  },
  required: ['action', 'move', 'side', 'level'],
};

export function judgePrompt(text: string, ctx: ModelContext): string {
  const turn = ctx.over ? 'The game is over.' : ctx.turn === 'user' ? "It is the player's move." : "It is the opponent's move.";
  return `In a spoken chess game against an AI opponent, the player said: "${text}"
(Speech recognition may mishear squares: "before" can be "b4", "e for" can be "e4".)
The player is ${ctx.userColor}. ${turn} ${ctx.moves} half-moves played.${ctx.legal.length ? `\nThe player's legal moves: ${ctx.legal.join(', ')}.` : ''}

Is the player asking the board to do one of these right now?
- move: they state THEIR OWN move, to play now ("knight to f3", "okay, e4", "I'll take on d5 with the knight"). Give it as SAN from the legal list. NOT a move: a question ("can I castle?", "should I play e4?"), a plan or hypothetical ("I might play d4 next"), commentary on a piece or a square ("your knight on f3 is strong"), or a move already played.
- side: they ask to play white or black, to switch sides, or to go first or second.
- difficulty: they ask the opponent to go easier (casual), say they are a beginner (beginner), or ask for its full strength (full).
- resign: they clearly concede the game now. Asking about resigning is not resigning.
- new_game: they ask to start a new game now.
- none: anything else: questions, small talk, reactions.
When unsure, answer none: a wrong action cannot be undone.`;
}

const destination = (san: string) => (san.match(/[a-h][1-8]/g) ?? []).pop() ?? null;

/**
 * The model's answer as a verdict, or none. Bounded by the player's own
 * words: a move must land on a square they said (or be a castle they named),
 * and a resignation must be said in so many words. The board still judges
 * the move itself.
 */
export function verdictFrom(raw: unknown, text: string): Verdict {
  const r = (raw ?? {}) as Record<string, unknown>;
  const said = despellRanks(tidy(text)).toLowerCase();
  switch (r.action) {
    case 'move': {
      const move = typeof r.move === 'string' ? r.move.trim() : '';
      if (!move || move.length > 12) return NONE;
      if (/^[O0]-[O0]/.test(move)) return /castl|o-o|0-0/.test(said) ? { kind: 'move', text: move.replace(/0/g, 'O'), via: 'model' } : NONE;
      const square = destination(move);
      return square && said.includes(square) ? { kind: 'move', text: move, via: 'model' } : NONE;
    }
    case 'side':
      return r.side === 'white' || r.side === 'black' ? { kind: 'side', side: r.side, via: 'model' } : NONE;
    case 'difficulty':
      return r.level === 'full' || r.level === 'casual' || r.level === 'beginner' ? { kind: 'difficulty', level: r.level, via: 'model' } : NONE;
    case 'resign':
      return RESIGN_WORDS.test(norm(text)) ? { kind: 'resign', via: 'model' } : NONE;
    case 'new_game':
      return { kind: 'new', via: 'model' };
    default:
      return NONE;
  }
}
