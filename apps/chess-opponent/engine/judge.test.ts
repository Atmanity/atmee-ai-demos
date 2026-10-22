import { describe, expect, test } from 'vitest';
import { judge, judgePrompt, tidy, toAction, verdictFrom, type Verdict } from './judge.ts';

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
    (said) => expect(judge(said)).toMatchObject({ kind: 'move', via: 'rules' }),
  );

  test('the full stop a recogniser adds does not hide the move', () => {
    expect(judge('Knight to f3.')).toEqual({ kind: 'move', text: 'Knight to f3', via: 'rules' });
  });

  test.each(['Should I play e4?', 'what about e4', 'is e4 any good', 'Can I castle?'])('a question about a move is not a move: %s', (said) => {
    expect(judge(said).kind).not.toBe('move');
  });

  test('a question about a move goes to the avatar, not the model', () => {
    expect(kind('Should I play e4?')).toBe('none');
    expect(kind('what about e4')).toBe('none');
  });

  test.each(['Okay, e4.', 'I think I will play knight to f3', 'Alright so knight f3, I guess'])(
    'a move the gate is too careful to read goes to the model: %s',
    (said) => expect(kind(said)).toBe('model'),
  );
});

describe('resigning: only a plain statement counts', () => {
  test.each(['I resign.', 'I give up', 'I concede', "I'm resigning", 'Resign'])('%s resigns', (said) => expect(kind(said)).toBe('resign'));
  test.each(['Should I resign?', "I'm not going to resign", "Don't give up!", 'Maybe I should resign', 'I might resign soon'])(
    '%s does not',
    (said) => expect(kind(said)).toBe('none'),
  );
  test('a request to resign is the model’s call', () => expect(kind('Can I resign?')).toBe('model'));
});

describe('a new game', () => {
  test.each(['New game', 'Can we play again?', "Let's start over", 'Rematch!', 'Reset the board', 'One more game'])('%s', (said) => expect(kind(said)).toBe('new'));
  test('a question about the game is not a reset', () => expect(kind('Is this a new game?')).toBe('none'));
  test('a deferred one is the model’s call', () => expect(kind("Let's play again after this one")).toBe('model'));
});

describe('sides', () => {
  test.each([
    ['Can I play black?', 'side:black'], ["I'd rather be white", 'side:white'], ['Black, please.', 'side:black'],
    ['black', 'side:black'], ['Give me the black pieces', 'side:black'], ['I want to play white', 'side:white'],
    ['Switch sides', 'side:other'], ["Let's swap colours", 'side:other'], ['Can I have white? Can you start us off', 'side:white'],
    ['Let me go second', 'side:black'], ['You go first', 'side:black'],
  ])('%s', (said, expected) => expect(kind(said)).toBe(expected));

  test('turn order seats the player only before the first move', () => {
    expect(kind('Let me go second', 6)).toBe('model');
  });

  test.each(['Am I white?', 'Which side am I?', 'Is black winning?'])('a question about the seating is the avatar’s: %s', (said) => {
    expect(kind(said)).toBe('none');
  });

  test.each(['Take black’s knight', 'Black is looking strong', 'White to move'])('colour talk that is not a request goes to the model: %s', (said) => {
    expect(kind(said)).toBe('model');
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

  test.each(['Are you going easy on me?', 'How strong are you?', "What's your rating?"])('a question about strength is the avatar’s: %s', (said) => {
    expect(kind(said)).toBe('none');
  });

  test("a negation the patterns don't cover is the model's call", () => expect(kind("I'm not a beginner")).toBe('model'));
});

describe('talk', () => {
  test.each(['Hello! How are you?', 'Nice move', "What's the opening called?", 'Can I take that back?', 'Ha, you got me', ''])(
    '%s goes to the avatar',
    (said) => expect(kind(said)).toBe('none'),
  );

  test('commentary that looks like a move is a move for the board to judge (it reads it as unreadable, then the model decides)', () => {
    expect(judge('that knight belongs on g5')).toMatchObject({ kind: 'move', via: 'rules' });
  });
});

describe('verdicts become actions', () => {
  test.each<[Verdict, unknown]>([
    [{ kind: 'move', text: 'e4', via: 'rules' }, { kind: 'move', text: 'e4' }],
    [{ kind: 'side', side: 'other', via: 'rules' }, { kind: 'side', side: 'other' }],
    [{ kind: 'difficulty', level: 'casual', via: 'model' }, { kind: 'difficulty', level: 'casual' }],
    [{ kind: 'resign', via: 'rules' }, { kind: 'resign' }],
    [{ kind: 'new', via: 'rules' }, { kind: 'new' }],
    [{ kind: 'none' }, null],
    [{ kind: 'model' }, null],
  ])('%j', (verdict, action) => expect(toAction(verdict)).toEqual(action));
});

describe("the model's answer, bounded by the player's words", () => {
  test('a move must land on a square they said', () => {
    expect(verdictFrom({ action: 'move', move: 'Nf3' }, 'okay so knight to f three then')).toEqual({ kind: 'move', text: 'Nf3', via: 'model' });
    expect(verdictFrom({ action: 'move', move: 'Nf3' }, 'okay, the horse')).toEqual({ kind: 'none' });
    expect(verdictFrom({ action: 'move', move: '' }, 'e4')).toEqual({ kind: 'none' });
  });

  test('a castle must be one they named', () => {
    expect(verdictFrom({ action: 'move', move: '0-0' }, "alright, let's castle")).toEqual({ kind: 'move', text: 'O-O', via: 'model' });
    expect(verdictFrom({ action: 'move', move: 'O-O' }, 'hmm, not sure')).toEqual({ kind: 'none' });
  });

  test('a resignation must be said in so many words', () => {
    expect(verdictFrom({ action: 'resign' }, "I'm done, I give up")).toEqual({ kind: 'resign', via: 'model' });
    expect(verdictFrom({ action: 'resign' }, 'whatever')).toEqual({ kind: 'none' });
  });

  test('sides, levels and resets', () => {
    expect(verdictFrom({ action: 'side', side: 'black' }, 'the dark pieces this time')).toEqual({ kind: 'side', side: 'black', via: 'model' });
    expect(verdictFrom({ action: 'side', side: 'none' }, 'x')).toEqual({ kind: 'none' });
    expect(verdictFrom({ action: 'difficulty', level: 'beginner' }, 'x')).toEqual({ kind: 'difficulty', level: 'beginner', via: 'model' });
    expect(verdictFrom({ action: 'new_game' }, 'x')).toEqual({ kind: 'new', via: 'model' });
    expect(verdictFrom({ action: 'none' }, 'x')).toEqual({ kind: 'none' });
    expect(verdictFrom(null, 'x')).toEqual({ kind: 'none' });
    expect(verdictFrom('garbage', 'x')).toEqual({ kind: 'none' });
  });

  test('the prompt carries the words, the seating and the legal moves', () => {
    const prompt = judgePrompt('okay, e4', { userColor: 'black', turn: 'user', legal: ['e5', 'Nf6'], moves: 1, over: false });
    expect(prompt).toContain('"okay, e4"');
    expect(prompt).toContain('The player is black');
    expect(prompt).toContain('e5, Nf6');
    expect(prompt).toContain('When unsure, answer none');
  });
});
