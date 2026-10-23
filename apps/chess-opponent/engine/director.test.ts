import { describe, expect, test } from 'vitest';
import { actionFor, boardState, INSTRUCTIONS, materialLead, movesText, pressed, say, TOOLS } from './director.ts';
import { ChessMatch } from './game.ts';
import { Table } from './table.ts';

const STATE_LIMIT = 3858;
const INSTRUCTIONS_LIMIT = 4000;

describe('the API limits', () => {
  test('the instructions fit, and name every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
  });

  test('the schemas are lenient: a call that does not fit never reaches the page, so the page does the checking', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      for (const banned of ['enum', 'pattern', 'format', 'minLength', 'const']) expect(o, banned).not.toHaveProperty(banned);
      expect(o.additionalProperties).not.toBe(false);
      if (typeof o.maxLength === 'number') expect(o.maxLength).toBeGreaterThanOrEqual(500);
      Object.values(o).forEach(walk);
    };
    for (const tool of TOOLS) walk(tool.parameters);
  });

  test('the tools fit the API: names, descriptions, schemas, all await within 28 s', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(8);
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  test('the busiest board in a game gone the distance still fits the state limit', () => {
    // 218 legal moves (the most a position is known to hold) and 400 plies of history.
    const match = new ChessMatch();
    match.board.load('R6R/3Q4/1Q4Q1/4Q3/2Q4Q/Q4Q2/pp1Q4/kBNN1KB1 w - - 0 1');
    match.historySan = Array.from({ length: 400 }, () => 'Qxd7+');
    const snapshot = match.snapshot();
    expect(snapshot.legal_moves.length).toBeGreaterThan(200);
    const state = boardState({ ...snapshot, opening: "Queen's Gambit Declined", difficulty: 'beginner' });
    expect(state.length).toBeLessThanOrEqual(STATE_LIMIT);
    expect(state).toContain('Qxd7+');
  });

  test('every result, with the longest inputs, stays short', () => {
    const s = new Table(new ChessMatch()).snapshot();
    const long = 'x'.repeat(120);
    const why = 'y'.repeat(480);
    for (const text of [say.refused(long, why), say.ambiguous(long, why), say.unreadable(long), say.sideRefused(why), say.start(s), say.resume(s)]) {
      expect(text.length).toBeLessThan(1000);
    }
  });
});

describe('destructive tools are only for when the player asks', () => {
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

  test('resign and new game say so in their descriptions and in the instructions', () => {
    expect(tool('resign').description).toMatch(/only when the player clearly says/i);
    expect(tool('new_game').description).toMatch(/only when the player asks for one; never on your own/i);
    expect(INSTRUCTIONS).toContain('only when they ask for one; never on your own, not even after a game ends');
  });

  test('no result asks for another game to be started: it is offered, and started only if they say so', () => {
    const t = new Table(new ChessMatch());
    const resigned = t.act({ kind: 'resign' });
    expect(resigned.event!.text).toContain('start one only if they say so');
    expect(boardState(resigned.snapshot)).toContain('A new game starts only if the player asks');
  });

  test('a move is never played for the host: play_move is for the player\'s own moves', () => {
    expect(tool('play_move').description).toContain('Never for your own move');
    expect(INSTRUCTIONS).toContain('Never call play_move for your own move');
  });
});

describe('the persona never claims a strength it does not have', () => {
  // The original prompt opened "You play at a strong level" for a one-ply heuristic.
  const all = INSTRUCTIONS.toLowerCase();

  test('the honest description is there', () => {
    expect(all).not.toContain('strong level');
    expect(all).toContain('one move ahead');
    expect(all).toContain('two-move tactic');
  });

  test('a rating is only ever mentioned to forbid claiming one', () => {
    expect(all).toContain('never claim a rating, an elo, a title');
    for (const sentence of all.split(/(?<=[.!?:])\s+/)) {
      if (/\b(grandmaster|elo)\b/.test(sentence)) expect(sentence).toContain('never claim');
    }
  });

  test('call, don\'t narrate: even a one-word answer is a tool call, and nothing happened unless a result said so', () => {
    expect(all).toContain('every request that changes the board is a tool call, even a one-word answer to your own question');
    expect(all).toContain("never say a move was played, a side changed or a game started unless a tool's result said so");
    expect(all).toContain('when they say yes, call it');
  });

  test('the hard-won rules are kept', () => {
    expect(all).toContain('no takebacks');
    expect(all).toContain('never name or announce a move of yours');
    expect(all).toContain('the screen changes only when you call a tool');
    expect(all).toContain('best move');
  });
});

describe('tool calls become board actions, with their arguments checked', () => {
  test.each<[string, Record<string, unknown>, unknown]>([
    ['play_move', { move: 'knight to f3' }, { kind: 'move', text: 'knight to f3' }],
    ['play_move', { move: '  Nf3  ' }, { kind: 'move', text: 'Nf3' }],
    ['choose_side', { side: 'black' }, { kind: 'side', side: 'black' }],
    ['choose_side', { side: 'switch' }, { kind: 'side', side: 'other' }],
    ['set_strength', { level: 'beginner' }, { kind: 'difficulty', level: 'beginner' }],
    ['resign', {}, { kind: 'resign' }],
    ['new_game', {}, { kind: 'new' }],
  ])('%s %j', (name, args, action) => expect(actionFor(name, args)).toEqual(action));

  test('a missing or unusable argument does nothing and gives the host a question to ask', () => {
    expect(actionFor('play_move', {})).toMatch(/^Nothing moved: .*Ask the player which move/);
    expect(actionFor('play_move', { move: { san: 'e4' } })).toMatch(/^Nothing moved/);
    expect(actionFor('choose_side', { side: 'purple' })).toMatch(/^Nothing changed: .*White or Black/);
    expect(actionFor('set_strength', { level: 'grandmaster' })).toMatch(/^Nothing changed: .*full, casual or beginner/);
  });

  test.each<[string, Record<string, unknown>, unknown]>([
    ['choose_side', { side: 'Black' }, { kind: 'side', side: 'black' }],
    ['choose_side', { side: 'the black pieces' }, { kind: 'side', side: 'black' }],
    ['choose_side', { side: ' WHITE ' }, { kind: 'side', side: 'white' }],
    ['choose_side', { side: 'the other side' }, { kind: 'side', side: 'other' }],
    ['choose_side', { side: 'Swap' }, { kind: 'side', side: 'other' }],
    ['choose_side', { color: 'black' }, { kind: 'side', side: 'black' }],
    ['set_strength', { level: 'Beginner' }, { kind: 'difficulty', level: 'beginner' }],
    ['set_strength', { level: 'a beginner' }, { kind: 'difficulty', level: 'beginner' }],
    ['set_strength', { level: 'Beginner mode' }, { kind: 'difficulty', level: 'beginner' }],
    ['set_strength', { level: 'easier' }, { kind: 'difficulty', level: 'casual' }],
    ['set_strength', { level: 'Casual' }, { kind: 'difficulty', level: 'casual' }],
    ['set_strength', { level: 'harder' }, { kind: 'difficulty', level: 'full' }],
    ['set_strength', { level: 'Full strength' }, { kind: 'difficulty', level: 'full' }],
  ])('capitals and synonyms work: %s %j', (name, args, action) => expect(actionFor(name, args)).toEqual(action));

  test('an extra field the host adds is ignored, not refused', () => {
    expect(actionFor('play_move', { move: 'e4', reason: 'the player said e four' })).toEqual({ kind: 'move', text: 'e4' });
    expect(actionFor('choose_side', { side: 'black', confirmed: true })).toEqual({ kind: 'side', side: 'black' });
    expect(actionFor('resign', { why: 'they said so' })).toEqual({ kind: 'resign' });
  });

  test('a wall of words is clipped before it reaches the board', () => {
    const action = actionFor('play_move', { move: 'e4 '.repeat(500) });
    expect(typeof action === 'object' && action.kind === 'move' && new TextEncoder().encode(action.text).length).toBeLessThanOrEqual(120);
  });

  test('an unknown tool is an error, not a silent no-op', () => {
    expect(() => actionFor('take_back', {})).toThrow(/unknown tool/);
  });

  test('every tool has an action', () => {
    for (const tool of TOOLS) expect(() => actionFor(tool.name, {})).not.toThrow();
  });
});

describe('the state', () => {
  test("describes the board for questions, and lists the player's legal moves only on their turn", () => {
    const t = new Table(new ChessMatch('white', 1));
    const first = t.act({ kind: 'move', text: 'e4' });
    const mid = boardState(first.snapshot);
    expect(mid).toContain('It is your move');
    expect(mid).toContain('Do not name it');
    expect(mid).not.toContain('legal moves right now');
    t.reply(first.next!);
    const yours = boardState(t.snapshot());
    expect(yours).toContain("It is the player's move");
    expect(yours).toContain('legal moves right now');
    expect(yours).toContain('A move they state still goes through play_move');
    expect(yours).toContain(`Position (FEN): ${t.snapshot().fen}`);
    expect(yours).toMatch(/Moves so far: 1\. e4 \S+/);
  });

  test('never carries a refusal: that is said once, not restated on every turn', () => {
    const t = new Table(new ChessMatch());
    const refused = t.act({ kind: 'move', text: 'e5' });
    expect(refused.snapshot.last_refusal).not.toBeNull();
    expect(boardState(refused.snapshot)).not.toMatch(/refus/i);
  });

  test('stages no answers: what a side swap or a strength change does comes from the tools', () => {
    const state = boardState(new ChessMatch().snapshot());
    expect(state).not.toContain('Only if the player asks');
    expect(state).not.toContain('casual strength from your next move');
  });

  test('after the game only the result, and a new game only if asked', () => {
    const match = new ChessMatch();
    match.resign('user');
    const state = boardState(match.snapshot());
    expect(state).toContain('The game is over: the player resigned, so you won');
    expect(state).not.toContain('legal moves');
  });

  test('material is a count from the player’s side, not an evaluation', () => {
    expect(materialLead('rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3', 'white')).toBe(1);
    expect(materialLead('rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3', 'black')).toBe(-1);
    const match = new ChessMatch();
    match.board.load('rnbqkbnr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3');
    expect(boardState(match.snapshot())).toContain('the player is 1 pawn of material ahead (a count of pieces, not an evaluation)');
  });

  test('the move list is numbered like a scoresheet, and its elided head says so', () => {
    expect(movesText(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(movesText(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 2)).toBe('… 2... Nc6 3. Bb5');
  });
});

describe('the reply', () => {
  test('names only the move the board played, with what it does and the opening once', () => {
    const text = say.reply({ userMove: 'Nf3', check: false }, { san: 'Nc6', tags: ['knight'] }, { ...new ChessMatch().snapshot(), history: ['e4', 'e5', 'Nf3', 'Nc6'], opening: 'Open Game' });
    expect(text).toMatch(/^Done: the player played Nf3/);
    expect(text).toContain('You replied Nc6, already on the board');
    expect(text).toContain('The opening is Open Game. Name the opening ONLY if you have not named it already');
    expect(text).toContain('Do not narrate any other move');
  });

  test('a check given by the player is acknowledged, and what the move does is said in words, never in scores', () => {
    const text = say.reply({ userMove: 'Bb5+', check: true }, { san: 'c6', tags: ['pawn'] }, new ChessMatch().snapshot());
    expect(text).toContain('It gives you check');
    const capture = say.reply({ userMove: 'e4' }, { san: 'Qxd7#', tags: ['checkmate', 'capture', 'queen'] }, new ChessMatch().snapshot());
    expect(capture).toContain('What your move does: it is checkmate; it captures a piece.');
    expect(capture).not.toMatch(/score|centipawn/i);
  });

  test('a move made by hand or a button is told as such: the host cannot see the screen', () => {
    expect(pressed('pressed "Resign"', 'The player resigned.')).toBe('The player pressed "Resign" on screen. The player resigned.');
  });
});

describe('results lead with the outcome, so the filler line before them cannot contradict it', () => {
  const t = () => new Table(new ChessMatch('white', 1));

  test('every result opens with a plain outcome', () => {
    const outcomes: string[] = [];
    const a = t();
    const first = a.act({ kind: 'move', text: 'e4' });
    outcomes.push(a.reply(first.next!).event!.text);
    outcomes.push(t().act({ kind: 'move', text: 'Ra5' }).event!.text);
    outcomes.push(t().act({ kind: 'move', text: 'the horse' }).event!.text);
    outcomes.push(t().act({ kind: 'difficulty', level: 'casual' }).event!.text);
    outcomes.push(t().act({ kind: 'difficulty', level: 'full' }).event!.text);
    outcomes.push(t().act({ kind: 'side', side: 'white' }).event!.text);
    outcomes.push(t().act({ kind: 'resign' }).event!.text);
    outcomes.push(t().act({ kind: 'new' }).event!.text);
    const b = t();
    const side = b.act({ kind: 'side', side: 'black' });
    outcomes.push(b.reply(side.next!).event!.text);
    for (const text of outcomes) expect(text).toMatch(/^(Done|Refused|Not yet|Not played|Nothing changed|Game over):/);
  });

  test('the opening does not greet a second time', () => {
    expect(t().start().event!.text).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. /);
    const black = new Table(new ChessMatch('black', 1));
    const lead = black.start().next!;
    expect(black.reply(lead).event!.text).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. /);
    expect(say.resume(t().snapshot())).toMatch(/^You have just greeted them/);
  });
});
