import { describe, expect, test } from 'vitest';
import { ChessMatch } from './game.ts';
import { judge, mustDo, readsAsMove, tidy, typedMove } from './judge.ts';

const kind = (said: string, moves = 0) => {
  const v = judge(said, { moves });
  switch (v.kind) {
    case 'side': return `side:${v.side}`;
    case 'difficulty': return `difficulty:${v.level}`;
    default: return v.kind;
  }
};

describe('a recogniser transcript, tidied', () => {
  test.each([
    ['Knight to f3.', 'Knight to f3'], ['E4.', 'E4'], ['E four, please.', 'E four please'], ['Please, castle.', 'please castle'], ['E 4', 'e4'], ['e-4', 'e4'], ['  castle   kingside!  ', 'castle kingside'], ['Is it e4?', 'Is it e4?'],
  ])('%s -> %s', (raw, tidied) => expect(tidy(raw)).toBe(tidied));
});

describe('moves, by rules', () => {
  test.each(['e4', 'E4.', 'Knight to f3.', 'e four', 'E 4', 'castle kingside', 'O-O', 'bishop takes c6', 'Nf3!', 'e8=Q#', 'play e4', 'E four, please.', 'Knight to f3, please.'])(
    '%s is a move',
    (said) => expect(judge(said)).toMatchObject({ kind: 'move' }),
  );

  test('the full stop a recogniser adds does not hide the move', () => {
    expect(judge('Knight to f3.')).toEqual({ kind: 'move', text: 'Knight to f3' });
  });

  test.each(['Should I play e4?', 'what about e4', 'is e4 any good', 'Can I castle?'])('a question about a move is not a move: %s', (said) => {
    expect(judge(said).kind).not.toBe('move');
  });

  test('a question about a move is talk', () => {
    expect(kind('Should I play e4?')).toBe('none');
    expect(kind('what about e4')).toBe('none');
  });

  test.each(['Okay, e4.', 'I think I will play knight to f3', 'Alright so knight f3, I guess'])(
    'a move the gate is too careful to read is left to the host: %s',
    (said) => expect(kind(said)).toBe('unsure'),
  );
});

describe('resigning: only a plain statement counts', () => {
  test.each(['I resign.', 'I give up', 'I concede', "I'm resigning", 'Resign'])('%s resigns', (said) => expect(kind(said)).toBe('resign'));
  test.each(['Should I resign?', "I'm not going to resign", "Don't give up!", 'Maybe I should resign', 'I might resign soon'])(
    '%s does not',
    (said) => expect(kind(said)).toBe('none'),
  );
  test('a request to resign is the host’s call', () => expect(kind('Can I resign?')).toBe('unsure'));
});

describe('a new game', () => {
  test.each(['New game', 'Can we play again?', "Let's start over", 'Rematch!', 'Reset the board', 'One more game'])('%s', (said) => expect(kind(said)).toBe('new'));
  test('a question about the game is not a reset', () => expect(kind('Is this a new game?')).toBe('none'));
  test('a deferred one is the host’s call', () => expect(kind("Let's play again after this one")).toBe('unsure'));
});

describe('sides', () => {
  test.each([
    ['Can I play black?', 'side:black'], ["I'd rather be white", 'side:white'], ['Black, please.', 'side:black'],
    ['black', 'side:black'], ['Give me the black pieces', 'side:black'], ['I want to play white', 'side:white'],
    ['Switch sides', 'side:other'], ["Let's swap colours", 'side:other'], ['Can I have white? Can you start us off', 'side:white'],
    ['Let me go second', 'side:black'], ['You go first', 'side:black'],
  ])('%s', (said, expected) => expect(kind(said)).toBe(expected));

  test('turn order seats the player only before the first move', () => {
    expect(kind('Let me go second', 6)).toBe('unsure');
  });

  test.each(['Am I white?', 'Which side am I?', 'Is black winning?'])('a question about the seating is talk: %s', (said) => {
    expect(kind(said)).toBe('none');
  });

  test.each(['Take black’s knight', 'Black is looking strong', 'White to move'])('colour talk that is not a clear request is left to the host: %s', (said) => {
    expect(kind(said)).toBe('unsure');
  });

  test('a remark about the squares is not a request for a colour', () => {
    expect(kind('the dark squares are weak')).toBe('none');
  });
});

describe('difficulty', () => {
  test.each([
    ['Go easy on me', 'difficulty:casual'], ["Go easy on me, I'm a beginner", 'difficulty:beginner'], ['This is too hard', 'difficulty:casual'],
    ["I'm a beginner", 'difficulty:beginner'], ['Can you go easier?', 'difficulty:casual'], ['Easier please', 'difficulty:casual'],
    ['Too easy', 'difficulty:full'], ["Don't go easy on me", 'difficulty:full'], ['Play properly', 'difficulty:full'],
    ['Full strength, please', 'difficulty:full'], ['Make it harder', 'difficulty:full'],
  ])('%s', (said, expected) => expect(kind(said)).toBe(expected));

  test.each(['Are you going easy on me?', 'How strong are you?', "What's your rating?"])('a question about strength is talk: %s', (said) => {
    expect(kind(said)).toBe('none');
  });

  test("a negation the patterns don't cover is the host's call", () => expect(kind("I'm not a beginner")).toBe('unsure'));
});

describe('talk', () => {
  test.each(['Hello! How are you?', 'Nice move', "What's the opening called?", 'Can I take that back?', 'Ha, you got me', ''])(
    '%s is talk',
    (said) => expect(kind(said)).toBe('none'),
  );

  test('commentary that looks like a move passes the gate, and the net still leaves it alone (it never plays moves)', () => {
    expect(judge('that knight belongs on g5')).toMatchObject({ kind: 'move' });
    expect(mustDo('that knight belongs on g5', { moves: 0, over: false })).toBeNull();
  });
});

describe('the safety net: what it does when the host does not, and only what is safe to repeat', () => {
  const at = (moves: number, over = false) => ({ moves, over });
  const net = (said: string, ctx = at(0)) => {
    const call = mustDo(said, ctx);
    return call ? [call.name, ...Object.values(call.arguments)].join(':') : null;
  };

  test.each<[string, string | null]>([
    ['I resign.', 'resign'], ['I give up', 'resign'], ["I'm resigning", 'resign'],
    ['New game', 'new_game'], ['Rematch!', 'new_game'], ["Let's start over", 'new_game'], ['Can we play again?', 'new_game'],
    ['Go easy on me.', 'set_strength:casual'], ["Go easy on me, I'm a beginner.", 'set_strength:beginner'], ['Play properly', 'set_strength:full'], ['This is too hard', 'set_strength:casual'],
    ['Can I play black?', 'choose_side:black'], ['Switch sides', 'choose_side:switch'], ['You go first', 'choose_side:black'],
  ])('%s -> %s', (said, expected) => expect(net(said)).toBe(expected));

  test.each<[string, string]>([['I re-sign.', 'resign'], ['I re sign', 'resign'], ['Re-match!', 'new_game'], ["Let's start-over", 'new_game']])(
    'the recogniser’s spellings: %s -> %s',
    (said, expected) => expect(net(said)).toBe(expected),
  );

  test.each(['e4', 'Knight to f3.', 'Castle kingside', 'Okay, e4.'])('never a move, which is not safe to repeat: %s', (said) => {
    expect(net(said)).toBeNull();
  });

  test.each(['Should I resign?', "Don't give up!", 'Can I take that back?', 'How strong are you?', 'Am I white?', 'Is this a new game?', 'Nice move', "Let's play again after this one", 'Can I resign?'])(
    'talk, questions and doubtful lines are left to the host: %s',
    (said) => expect(net(said)).toBeNull(),
  );

  test('a side swap that would throw away a game in progress is left to the host', () => {
    expect(net('Can I play black?', at(6))).toBeNull();
    expect(net('Switch sides', at(6))).toBeNull();
    expect(net('Can I play black?', at(6, true))).toBe('choose_side:black');
  });

  test('a reset that names a side is a side request, never a bare new game', () => {
    // Seen live: after choose_side(black), "Yes, start over as Black." made the net deal a second game.
    expect(net('Yes, start over as Black.', at(1))).toBeNull();
    expect(net('Yes, start over as Black.', at(0))).toBe('choose_side:black');
    expect(net("New game, I'll be white", at(30, true))).toBe('choose_side:white');
    expect(net('Rematch, same colours', at(30, true))).toBe('new_game');
  });

  test('"start over" is a rematch on the same side, never a seat on White', () => {
    // Bugbot: "I start" inside "I'll start over" made the net call choose_side(white): nothing for a
    // White player, a reseat for a Black one, and no rematch either way.
    expect(net("I'll start over.", at(30, true))).toBe('new_game');
    expect(net('Can I start over?', at(30, true))).toBe('new_game');
    expect(net("Let's start again", at(30, true))).toBe('new_game');
    expect(net("I'll start over as Black", at(30, true))).toBe('choose_side:black');
  });

  test('a finished game cannot be resigned again', () => {
    expect(net('I resign.', at(20, true))).toBeNull();
    expect(net('Rematch!', at(20, true))).toBe('new_game');
  });
});

describe('a typed line that is exactly a legal move', () => {
  const start = () => new ChessMatch('white', 1).snapshot();
  const afterE4 = () => {
    const match = new ChessMatch('black', 1);
    match.applyMove('agent', 'e4');
    return match.snapshot();
  };

  test.each<[string, string]>([['e4', 'e2e4'], ['Nf3', 'g1f3'], ['e2e4', 'e2e4'], ['g1f3', 'g1f3'], ['Nf3.', 'g1f3'], ['  e4  ', 'e2e4'], ['e4!', 'e2e4']])(
    '%s is played as %s',
    (typed, uci) => expect(typedMove(typed, start())).toBe(uci),
  );

  test('as Black after 1.e4, "Nf6" is a move (it once went to the host as chat and never reached the board)', () => {
    expect(typedMove('Nf6', afterE4())).toBe('g8f6');
  });

  test.each(['e5', 'Nf6', 'nf3', 'E4', 'knight to f3', 'e4 please', 'Nice game', 'castle', '', 'O-O'])(
    'anything else goes to the host: %s',
    (typed) => expect(typedMove(typed, start())).toBeNull(),
  );

  test('nothing is played out of turn or after the game', () => {
    const match = new ChessMatch('white', 1);
    match.applyMove('user', 'e4');
    expect(typedMove('e5', match.snapshot())).toBeNull();
    const over = new ChessMatch('white', 1);
    over.resign('user');
    expect(typedMove('e4', over.snapshot())).toBeNull();
  });
});

describe('a typed line written as a move, legal or not, goes to the board', () => {
  test.each(['e4', 'Nf6', 'Nf6.', 'exd5', 'Qxd7+', 'e8=Q#', 'e8Q', 'O-O', 'O-O-O', '0-0', 'e2e4', 'e2-e4', 'g7g8q', 'Nbd2', 'R1a3'])('%s', (typed) => {
    expect(readsAsMove(typed)).toBe(true);
  });
  test.each(['nf3', 'knight to f3', 'e4 please', 'Is e4 good?', 'castle', 'Nice game', 'E4', '', 'hello'])('not: %s', (typed) => {
    expect(readsAsMove(typed)).toBe(false);
  });
});
