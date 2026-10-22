// The board itself: chess.js for the rules, and our layer on top. Ported from
// game.py (python-chess). What lives here: the seating and the strength, the
// spoken-move resolver, the turn gate, result detection, refusals, and the
// snapshot both the panel and the director read. Framework-free.
//
// The side is configurable because it once was not, and the model covered
// for it: asked "can I play black instead?", it answered "Sure thing, you can
// play as Black. I'll start, then. e4." with the board untouched, the player
// still White, and no move played. Agreeing is not doing.
import { Chess, type Move as BoardMove } from 'chess.js';
import { detectOpening } from './openings.ts';
import { AmbiguousNotation, IllegalNotation, InvalidNotation, parseSan, parseUci } from './san.ts';
import { despellRanks } from './spoken.ts';
import type { ChessSnapshot, GameEndReason, GameResultWinner, LastMove, LegalMove, Side, SnapshotRefusal, Strength } from './types.ts';

/**
 * How the opponent picks among the moves it has ranked: an index into its own
 * ordering. 0 is the move it likes best; higher is deliberately worse. Mate is
 * always taken regardless.
 */
export const STRENGTHS: Record<Strength, number> = { full: 0, casual: 2, beginner: 5 };
export const DEFAULT_STRENGTH: Strength = 'full';

const SIDE_WORDS = new Map<string, Side>([
  ['white', 'white'], ['w', 'white'], ['light', 'white'],
  ['black', 'black'], ['b', 'black'], ['dark', 'black'],
]);

/**
 * "light" and "dark" name a side AND half the squares. "the dark squares are
 * nice" is about the board, not a request to sit on the other side of it, and
 * acting on it reseats the player and throws the game away.
 */
const SQUARE_TALK = /\b(?:light|dark)\s+(?:coloured |colored )?squares?\b/g;

/**
 * Turn order as a way of naming a side; White moves first, so second is
 * Black. Matched only AFTER a colour word, on word boundaries, because
 * substring tests seated people on the wrong side: "you start" matched "can
 * you start", "after you" matched "after your", and "can I have white? can
 * you start us off" came back BLACK with the board reset under them.
 */
export const SECOND_PHRASES = new RegExp([
  String.raw`\bgo(?:ing)? second\b`,
  String.raw`\byou (?:go |move )?first\b`,
  // "you start" is a seating request; "can you start us off" is not.
  String.raw`\byou start\b(?!\s+(?:us|me|a|an|the|another|it|this|over|again))`,
  // `\byou\b` matches inside "you're" (the apostrophe is not a word character).
  String.raw`\bafter you\b(?![\w'’])`,
].join('|'));
export const FIRST_PHRASES = /\bgo(?:ing)? first\b|\bi start\b|\bme first\b|\bi'?ll start\b/;

const stripChars = (text: string, chars: string) => {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
};

/**
 * The colour somebody named, or null if they named none. Turn order counts,
 * but only as an inference: an explicit colour word always wins.
 */
export function parseSide(text: unknown): Side | null {
  const lowered = String(text || '').trim().toLowerCase().replace(SQUARE_TALK, ' ');
  for (const word of lowered.split(/\s+/)) {
    const side = SIDE_WORDS.get(stripChars(word, `.,!?'"`));
    if (side) return side;
  }
  if (SECOND_PHRASES.test(lowered)) return 'black';
  if (FIRST_PHRASES.test(lowered)) return 'white';
  return null;
}

/**
 * The difficulty somebody asked for, or null. Deliberately generous: "go easy
 * on me", "beginner", "easier" all mean the same, and a player who has to
 * guess the magic word is back where they started.
 */
export function parseStrength(text: unknown): Strength | null {
  const lowered = String(text || '').trim().toLowerCase();
  if (!lowered) return null;
  const has = (...words: string[]) => words.some((word) => lowered.includes(word));
  if (has('beginner', 'very easy', 'easiest', 'much easier')) return 'beginner';
  // A COMPLAINT about difficulty is a request to go easier, read before "hard"
  // is looked for at all: "too hard" contains "hard", so it resolved to FULL,
  // the opposite of what the player asked for.
  if (has('too hard', 'too difficult', 'too strong', 'too tough')) return 'casual';
  if (has('easy', 'easier', 'gentle', 'casual', 'go easy')) return 'casual';
  if (has('full', 'hard', 'hardest', 'normal', 'strongest', 'best', 'properly', 'seriously')) return 'full';
  return lowered in STRENGTHS ? (lowered as Strength) : null;
}

/** A move or command the board refuses, with a reason fit for the player. */
export class IllegalMove extends Error {}

/**
 * The words did not parse as a move at all: NOT a claim about legality. "Qh5"
 * from the opening is read and refused by the position; a phrasing this code
 * cannot take apart is refused because this code could not read it. Reporting
 * the second as the first tells a player their legal move is illegal, which
 * this app must never do.
 */
export class UnreadableMove extends IllegalMove {}

/** Two pieces can do it, so the board is asking which, not refusing. */
export class AmbiguousMove extends IllegalMove {}

/** The exact reason an unreadable move is refused with: a constant, with no user text in it. */
export const UNREADABLE_MOVE_REASON = 'that did not read as a move';
/** Ambiguous refusals all open with this. */
export const AMBIGUOUS_MOVE_PREFIX = 'that could be ';

/**
 * How much of a refusal is kept, IN BYTES (a character is one to four). Both
 * fields carry whatever the player said, and a 30 KB "move" once silenced the
 * original panel; here they bound what reaches the screen and the avatar.
 */
export const REFUSAL_MOVE_MAX_BYTES = 120;
export const REFUSAL_REASON_MAX_BYTES = 480;
/** And how much of the player's words is quoted back at the avatar. */
export const MODEL_QUOTE_MAX_BYTES = 120;

/** `text` as one line, no longer than `maxBytes` of UTF-8, cut on a character boundary. */
export function clip(text: unknown, maxBytes: number): string {
  const line = String(text || '').split(/\s+/).filter(Boolean).join(' ');
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= maxBytes) return line;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.slice(0, end));
}

const UCI_RE = /^[a-h][1-8]\s*(?:to|-|x)?\s*[a-h][1-8]\s*=?\s*([qrbn])?$/i;

const PIECE_WORDS: [string, string][] = [
  ['knight', 'N'], ['night', 'N'], ['bishop', 'B'], ['rook', 'R'], ['queen', 'Q'], ['king', 'K'], ['pawn', ''],
];

/**
 * One token, taken apart: an optional piece letter, an optional capture, the
 * square, an optional promotion. In "b4" the leading b is the FILE, because
 * reading it as a bishop leaves no square behind it.
 */
const TOKEN = String.raw`([kqrbn])?(x?)([a-h][1-8])(?:=([qrbn]))?`;
const TOKEN_FULL = new RegExp(`^(?:${TOKEN})$`);
const TOKEN_ANY = new RegExp(TOKEN);

/** Piece nouns as SAN letters. A pawn has the empty letter: "the e pawn to e4" names a piece. */
export const PIECE_LETTER: Record<string, string> = {
  knight: 'N', knights: 'N', night: 'N', nights: 'N',
  bishop: 'B', bishops: 'B', rook: 'R', rooks: 'R',
  queen: 'Q', queens: 'Q', king: 'K', kings: 'K',
  pawn: '', pawns: '',
};
const hasLetter = (word: string) => Object.prototype.hasOwnProperty.call(PIECE_LETTER, word);

const CAPTURE_WORDS = new Set(['takes', 'take', 'captures', 'capture', 'x']);

/**
 * Does the utterance CLAIM a capture? SAN's x is decoration to the parser, so
 * "take d5" onto an empty d5 resolved to a quiet push and the player who
 * committed to a capture got a move instead. Anchored so "next" is not one.
 */
const CAPTURE_CLAIM = /\btakes?\b|\bcaptures?\b|\bx[a-h][1-8]|[KQRBNa-h][1-8]?x[a-h][1-8]/i;
export const claimsCapture = (text: unknown) => CAPTURE_CLAIM.test(String(text || ''));

const HAS_SQUARE = /[a-h][1-8]/;

/**
 * The ONLY words that may surround a move read out of a sentence: a
 * whitelist, which is the whole safety argument for reading moves out of free
 * text at all. Instruction vocabulary only; nothing descriptive ("is", "was",
 * "on", "your", "looks", "like", "strong" are absent on purpose), because
 * that is the vocabulary of talking ABOUT a square. "your knight on f3 is
 * strong" once pushed the f-pawn; "my knight is f3" did too, through "is".
 * "castle" is absent too: it is the colloquial name of a rook, and as filler
 * "move my castle to d5" pushed the d-PAWN. "next" is absent: it is future
 * tense in every position ("I'll play d4 next").
 */
export const MOVE_FILLER = new Set([
  // asking for it
  'play', 'plays', 'playing', "let's", 'lets', "i'll", 'ill', "we'll",
  'i', "i'm", 'im', 'go', 'goes', 'move', 'moves', 'moving', 'make',
  'it', 'push', 'just',
  // joining it up
  'and', 'now', 'please', 'ok', 'okay', 'the', 'a', 'an',
  'for', 'me', 'my',
  // naming the piece that is going there, and the capture
  'pawn', 'pawns', 'knight', 'knights', 'night', 'nights', 'bishop',
  'bishops', 'rook', 'rooks', 'queen', 'queens', 'king',
  'kings', "king's", "queen's", 'takes', 'take', 'captures', 'capture',
  'x', 'to',
]);

/** "Nbd2" -> "Nd2": the SAN with its origin hint removed, which is what an ambiguous utterance resolves to. */
const DISAMBIGUATED = /^([KQRBN])[a-h]?[1-8]?(x?)([a-h][1-8])(.*)$/;
const withoutDisambiguation = (san: string) => {
  const m = DISAMBIGUATED.exec(san);
  return m ? m.slice(1).join('') : san;
};

/**
 * Filler only AFTER the square: "e4 then" is a verbal full stop; "then I play
 * d4" announces a PLAN, which a move parser must never act on.
 */
const TRAILING_ONLY_FILLER = new Set(['then']);

/** Longer than the gate's six (a real instruction runs long), but bounded. */
const MAX_INSTRUCTION_WORDS = 12;

/**
 * May a move be read out of this sentence at all? Exactly one word carries a
 * square (two is a comparison or a plan: "e4 then d4"), and every other word
 * is filler in a position where it can be. A bare file letter counts.
 */
function extractable(words: string[]): boolean {
  if (words.length > MAX_INSTRUCTION_WORDS) return false;
  const squares = words.filter((word) => HAS_SQUARE.test(word));
  if (squares.length !== 1) return false;
  const index = words.indexOf(squares[0]);
  return words.every((word, position) => {
    if (position === index) return true;
    if (TRAILING_ONLY_FILLER.has(word)) return position > index;
    return MOVE_FILLER.has(word) || /^[a-h]$/.test(word);
  });
}

/**
 * The move a sentence INSTRUCTS, assembled from its words rather than scraped
 * off a string. Piece agreement: if the sentence names a piece, the reading
 * must carry that piece's letter. "knight moves to f3" once played the
 * f-PAWN, because an intervening word broke the letter off its square.
 */
function instructionReading(words: string[]): string | null {
  if (!extractable(words)) return null;
  let named: string | null = null;
  let namedAny = false;
  let capture = false;
  let token: string | null = null;
  for (const word of words) {
    if (HAS_SQUARE.test(word)) {
      token = word;
      continue;
    }
    if (hasLetter(word)) {
      // A piece named AFTER a capture verb is the OBJECT ("take the knight
      // c6"), not the mover. Refuse rather than guess.
      if (capture) return null;
      const letter = PIECE_LETTER[word];
      if (namedAny && named !== letter) return null;   // two different pieces: not one move
      named = letter;
      namedAny = true;
    } else if (CAPTURE_WORDS.has(word)) {
      capture = true;
    }
  }
  if (token === null) return null;
  const match = TOKEN_FULL.exec(token) ?? TOKEN_ANY.exec(token);
  if (!match) return null;
  let lead = (match[1] ?? '').toUpperCase();
  const [, , took, square, promotion] = match;
  if (namedAny) {
    if (lead && lead !== named) return null;   // "knight to Nf3" must agree
    lead = named ?? '';
  }
  if (took) capture = true;
  return `${lead}${capture ? 'x' : ''}${square}${promotion ? '=' + promotion.toUpperCase() : ''}`;
}

/** The word that MAKES it a castle instruction. */
const CASTLE_VERBS = new Set(['castle', 'castles', 'castling']);

/**
 * What turns "castle" into a NOUN when it sits immediately before it: "the
 * castle", "move the castle", "my castle". Checked by position: an exclusion
 * list once refused "my castle" while "the castle" castled.
 */
export const CASTLE_DETERMINERS = new Set([
  'the', 'a', 'an', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', "king's", 'kings', "queen's", 'queens', 'one',
]);
export const CASTLE_TRANSITIVES = new Set(['move', 'moves', 'play', 'plays', 'take', 'takes', 'push', 'pushes', 'use']);

/** The words a castle INSTRUCTION may otherwise contain. No "the", no "and": both are how rook talk gets in. */
export const CASTLE_OK = new Set([
  'kingside', 'queenside', 'short', 'long',
  'i', "i'm", 'im', "i'll", 'ill', 'we', "we'll", 'let', "let's", 'lets',
  'me', 'my', 'want', 'wanna', 'going', 'gonna', 'to', 'please', 'ok',
  'okay', 'now', 'just', 'go', 'it',
]);

/** Piece names a castle instruction may contain only AFTER the verb: "castle my king", not "queen castle". */
export const CASTLE_OBJECT_ONLY = new Set(['king', 'queen']);

/** Is this an instruction to castle, or talk about a rook? */
function castlingWords(words: string[]): boolean {
  const index = words.findIndex((word) => CASTLE_VERBS.has(word));
  if (index < 0) return false;
  if (index > 0 && (CASTLE_DETERMINERS.has(words[index - 1]) || CASTLE_TRANSITIVES.has(words[index - 1]))) return false;
  return words.every((word, position) => {
    if (CASTLE_VERBS.has(word)) return true;
    if (CASTLE_OBJECT_ONLY.has(word)) return position > index;
    return CASTLE_OK.has(word);
  });
}

const WORDS = (text: string) => text.match(/[a-z0-9'’-]+/g) ?? [];

/**
 * Plausible SAN/UCI readings of what somebody said or typed. A list of
 * candidates, not one answer: the board is the judge, this only proposes.
 * Anything the gate (spoken.ts) lets through reaches a best effort here, or
 * the player hears "'play e4' is not a legal move", which is untrue.
 */
export function spokenCandidates(text: string): string[] {
  const raw = String(text || '').split(/\s+/).filter(Boolean).join(' ');
  if (!raw) return [];
  const out = [raw];

  // "e four" -> "e4" first; "?" and SAN suffixes go too ("e4?" is a move said
  // with a rising inflection).
  const lowered = despellRanks(raw).replace(/[.!,?+#]+$/, '');
  // Speech recognition writes the letter O for a spoken castle far more often than the digit.
  const squashed = lowered.replace(/\s/g, '');
  if (/^[o0]-?[o0]-?[o0]$/.test(squashed)) return ['O-O-O'];
  if (/^[o0]-?[o0]$/.test(squashed)) return ['O-O'];
  // A castle goes through the same whitelist discipline as every other
  // reading: a bare search for "castle" castled on "my castle", "nice castle"
  // and "i want to castle later". "king side" is one word said as two.
  const castleText = lowered.replace(/\b(king|queen)\s+side\b/g, '$1side');
  if (castlingWords(WORDS(castleText))) return /queenside|\blong\b/.test(castleText) ? ['O-O-O'] : ['O-O'];

  if (UCI_RE.test(lowered)) {
    const squares = lowered.match(/[a-h][1-8]/g) ?? [];
    if (squares.length === 2) out.push(squares[0] + squares[1] + (UCI_RE.exec(lowered)?.[1] ?? ''));
  }

  let words = lowered;
  for (const [word, letter] of PIECE_WORDS) words = words.replace(new RegExp(String.raw`\b${word}\b`, 'g'), letter);
  words = words.replace(/\btakes?\b|\bcaptures?\b/g, 'x').replace(/\bto\b/g, '');
  const compact = words.replace(/\s+/g, '');
  // SAN is case-sensitive: piece letters upper, squares lower.
  const cased = compact.replace(/^([nbrqk])/, (m) => m.toUpperCase());
  out.push(cased);
  // ...and the twin: a leading "b" is a bishop in SAN and the b-file in a pawn
  // move, and "b4" said as "B4" became a bishop move to nowhere.
  if (cased !== compact && compact.startsWith('b')) out.push(compact);

  // Last: the move the sentence INSTRUCTS, only when it is an instruction and
  // nothing else. "Play e4" is a move; "your knight on f3 is strong" is not.
  const reading = instructionReading(WORDS(lowered));
  if (reading !== null && !out.includes(reading)) out.push(reading);
  return out;
}

const otherSide = (side: Side): Side => (side === 'white' ? 'black' : 'white');
const colourLetter = (side: Side) => (side === 'white' ? 'w' : 'b');

/** One game at a time; `newGame` starts the next. */
export class ChessMatch {
  /** The chess.js board. Tests set positions on it directly. */
  board = new Chess();
  /** The SAN record of this game. */
  historySan: string[] = [];
  /**
   * This match's tie-break seed: one per session, logged at start, so a game
   * that went wrong can be replayed by passing it back in. It only ever breaks
   * ties between moves the heuristic scored EQUAL.
   */
  readonly seed: number;
  private userSide: Side;
  private level: Strength = DEFAULT_STRENGTH;
  private lastMove: LastMove | null = null;
  private result: { winner: GameResultWinner; reason: GameEndReason } | null = null;
  private lastRefusal: { move: string; reason: string } | null = null;

  constructor(userColor: Side = 'white', seed?: number | null) {
    this.userSide = userColor;
    this.seed = seed === undefined || seed === null ? Math.floor(Math.random() * 2 ** 32) : Math.trunc(seed);
  }

  get userColor(): Side { return this.userSide; }
  get agentColor(): Side { return otherSide(this.userSide); }
  get strength(): Strength { return this.level; }
  /** The index into the opponent's own move ordering that this strength plays. */
  get rank(): number { return STRENGTHS[this.level] ?? 0; }

  /**
   * Seat the player on `side` and start a fresh game: a colour swap mid-game
   * is not a thing chess has. The colour they ALREADY have is refused rather
   * than obeyed: "I'll stay white" once wiped a game in progress.
   */
  setSide(side: unknown): Side {
    const color = parseSide(side);
    if (color === null) throw new IllegalMove(`'${String(side).trim()}' is not a side — say white or black`);
    if (color === this.userSide) {
      throw new IllegalMove(`you are already playing ${color} — say ${otherSide(color)} if you want to swap`);
    }
    this.userSide = color;
    this.newGame();
    return color;
  }

  /** How hard the opponent tries. Takes effect on its next move; no reset. */
  setStrength(level: unknown): Strength {
    const name = parseStrength(level);
    if (name === null) throw new IllegalMove(`'${String(level).trim()}' is not a level — say full, casual or beginner`);
    this.level = name;
    return name;
  }

  get phase(): 'playing' | 'game-over' { return this.result ? 'game-over' : 'playing'; }

  turn(): 'user' | 'agent' | null {
    if (this.result) return null;
    return this.board.turn() === colourLetter(this.userSide) ? 'user' : 'agent';
  }

  private boardMoves(): BoardMove[] {
    return this.board.moves({ verbose: true });
  }

  legalMoves(): LegalMove[] {
    if (this.result) return [];
    return this.boardMoves().map((m) => ({ san: m.san, uci: m.lan }));
  }

  newGame(): void {
    this.board = new Chess();
    this.historySan = [];
    this.lastMove = null;
    this.result = null;
    this.lastRefusal = null;
  }

  /**
   * Record a move the board just refused, so the screen shows it too (a
   * spoken refusal once reached only the avatar's mouth). `atFen` is the
   * position it was refused in, read BEFORE the refusal: if a move landed in
   * between, the refusal describes a board that no longer exists.
   */
  noteRefusal(attempted: unknown, reason: string, atFen?: string | null): SnapshotRefusal {
    if (atFen && atFen !== this.board.fen()) throw new IllegalMove('that refusal is stale — the position has moved on');
    this.lastRefusal = { move: clip(attempted, REFUSAL_MOVE_MAX_BYTES), reason: clip(reason, REFUSAL_REASON_MAX_BYTES) };
    return { ...this.lastRefusal };
  }

  resign(who: 'user' | 'agent'): void {
    if (this.result) throw new IllegalMove('the game is already over');
    this.result = { winner: who === 'user' ? 'agent' : 'opponent', reason: 'resignation' };
    this.lastMove = null;
  }

  /** Apply one move, spoken or precise. */
  applyMove(who: 'user' | 'agent', text: unknown): LastMove {
    if (this.result) throw new IllegalMove('the game is over — start a new game to play on');
    if (this.turn() !== who) throw new IllegalMove('it is not your side to move');
    const move = this.resolve(text);
    if (move === null) {
      // The QUOTE is clipped, not the sentence: the explanation must survive.
      throw new IllegalMove(`'${clip(text, MODEL_QUOTE_MAX_BYTES)}' is not a legal move in this position`);
    }
    const san = move.san;
    if (claimsCapture(text) && !move.isCapture() && !move.isEnPassant()) {
      throw new IllegalMove(`there is nothing to take on ${move.to} — say '${san}' if you just want to move there`);
    }
    this.board.move({ from: move.from, to: move.to, promotion: move.promotion });
    this.historySan.push(san);
    this.lastMove = { san, uci: move.lan, by: who };
    // The position has moved on, so the last refusal describes a board that no longer exists.
    this.lastRefusal = null;
    this.detectResult();
    return { ...this.lastMove };
  }

  /**
   * The move these words mean. Null means READABLE BUT ILLEGAL; UnreadableMove
   * means the words never parsed; AmbiguousMove means two pieces can do it.
   * Three different sentences to the player.
   */
  private resolve(text: unknown): BoardMove | null {
    const legal = this.boardMoves();
    let readable = false;
    let ambiguous: string | null = null;
    for (const candidate of spokenCandidates(String(text || ''))) {
      for (const reading of this.expand(candidate, legal)) {
        try {
          return parseUci(legal, reading.toLowerCase());
        } catch (err) {
          if (err instanceof IllegalNotation) readable = true;
          else if (!(err instanceof InvalidNotation)) throw err;
        }
        try {
          return parseSan(legal, reading);
        } catch (err) {
          if (err instanceof AmbiguousNotation) {
            readable = true;
            ambiguous ??= reading;
          } else if (err instanceof IllegalNotation) readable = true;
          else if (!(err instanceof InvalidNotation)) throw err;
        }
      }
    }
    if (ambiguous !== null) throw new AmbiguousMove(this.ambiguityReason(ambiguous, legal));
    if (!readable) throw new UnreadableMove(UNREADABLE_MOVE_REASON);
    return null;
  }

  /**
   * A candidate plus the readings only the board can complete: "pawn takes
   * f6" compacts to "xf6", and only the position knows which file took. Two
   * pawns that can take is an ambiguity to ask about, not a coin to flip.
   */
  private expand(candidate: string, legal: BoardMove[]): string[] {
    const match = /^x([a-h][1-8])(=[QRBN])?$/.exec(candidate);
    if (!match) return [candidate];
    const [, square, promotion = ''] = match;
    const found: string[] = [];
    for (const file of 'abcdefgh') {
      const reading = `${file}x${square}${promotion}`;
      try {
        parseSan(legal, reading);
        found.push(reading);
      } catch {
        // not this file
      }
    }
    if (found.length === 1) return [candidate, found[0]];
    if (found.length > 1) throw new AmbiguousMove(`${AMBIGUOUS_MOVE_PREFIX}${found.join(' or ')} — say which one`);
    return [candidate];
  }

  /**
   * "that could be Nbd2 or Nfd2 — say which one, or give both squares like
   * b1d2". The suggestion has to WORK: "name the square it comes from" sent
   * players to "knight from b1 to d2", which is unreadable.
   */
  private ambiguityReason(reading: string, legal: BoardMove[]): string {
    const options = legal.filter((m) => withoutDisambiguation(m.san) === reading).map((m) => m.san).sort();
    if (options.length < 2) return `${AMBIGUOUS_MOVE_PREFIX}more than one piece — say which one`;
    const both = legal.find((m) => m.san === options[0])?.lan ?? 'b1d2';
    return `${AMBIGUOUS_MOVE_PREFIX}${options.join(' or ')} — say which one, or give both squares like ${both}`;
  }

  /**
   * Checkmate, stalemate, insufficient material, threefold repetition, the
   * fifty-move rule. The repetition and fifty-move tests are the ones that END
   * the game, not the "could claim" ones, which fire a ply early and once
   * declared a playable position drawn.
   */
  detectResult(): void {
    const board = this.board;
    if (board.isCheckmate()) {
      const winner = board.turn() === colourLetter(this.agentColor) ? 'opponent' : 'agent';
      this.result = { winner, reason: 'checkmate' };
    } else if (board.isStalemate()) {
      this.result = { winner: 'draw', reason: 'stalemate' };
    } else if (board.isInsufficientMaterial()) {
      this.result = { winner: 'draw', reason: 'insufficient_material' };
    } else if (board.isThreefoldRepetition()) {
      this.result = { winner: 'draw', reason: 'threefold_repetition' };
    } else if (board.isDrawByFiftyMoves()) {
      this.result = { winner: 'draw', reason: 'fifty_moves' };
    }
  }

  /** The public snapshot: the one authority the panel and the director read. */
  snapshot(): ChessSnapshot {
    const board = this.board;
    const inCheck = board.inCheck() && !this.result;
    const king = inCheck ? board.findPiece({ type: 'k', color: board.turn() })[0] ?? null : null;
    return {
      game: 'chess',
      phase: this.phase,
      user_color: this.userSide,
      difficulty: this.level,
      fen: board.fen(),
      turn: this.turn(),
      in_check: inCheck,
      check_square: king,
      legal_moves: this.legalMoves(),
      history: [...this.historySan],
      opening: detectOpening(this.historySan),
      last_move: this.lastMove ? { ...this.lastMove } : null,
      result: this.result ? { ...this.result } : null,
      last_refusal: this.lastRefusal ? { ...this.lastRefusal } : null,
    };
  }
}
