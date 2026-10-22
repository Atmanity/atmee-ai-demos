// Words to board actions, as people actually phrase them. The original's
// model chose a tool for every line; these rules must route the common lines
// the same way, and leave the rest (small talk, questions about a stroke
// already done) to the avatar.
import { describe, expect, test } from 'vitest';
import { characterIn, intentFromModel, intentIn, intentPrompt, worthAsking } from './judge.ts';
import { StrokeTutor } from './tutor.ts';
import type { Intent, Phase } from './types.ts';

const kind = (text: string, phase: Phase, current: string | null = phase === 'intro' ? null : 'juu') => {
  const intent = intentIn(text, phase, current);
  return intent ? (intent.kind === 'start_character' ? `start:${intent.id ?? ''}` : intent.kind) : null;
};

describe('a question about the live stroke is a request to be shown', () => {
  // The symptom, from playing the original: "which stroke comes first, and
  // where do I start it?" came back "I can't describe stroke one". Here the
  // app routes it to a reveal, whatever the avatar says first.
  test.each([
    'Which stroke comes first, and where do I start it?',
    'Which way does it go?',
    'where do I start',
    'Show me.',
    'Can you show me this one?',
    "I don't know this one",
    'How do I draw it?',
    'How does this one go?',
    'What does it look like?',
    "I'm stuck.",
    "I can't remember",
    'What shape is it?',
    'which direction?',
    'Can I have a hint?',
    'help',
    "what's the next stroke",
  ])('%s', (said) => {
    expect(kind(said, 'writing')).toBe('reveal');
  });

  test('once the stroke is done, the same question is the avatar\'s to answer from the board', () => {
    expect(kind('Which way does it go?', 'coaching')).toBeNull();
    expect(kind('Show me.', 'coaching')).toBeNull();
    expect(kind('where do I start', 'intro')).toBeNull();
  });
});

describe('choosing a character', () => {
  test.each([
    ["let's do the tree one", 'ki'],
    ['永', 'ei'],
    ['the letter A', 'latin_a'],
    ['Capital E please', 'latin_e'],
    ['Eternity!', 'ei'],
    ['Can we do river?', 'kawa'],
    ['ten', 'juu'],
    ['one', 'ichi'],
    ['A', 'latin_a'],
    ['How about 木?', 'ki'],
  ])('on the menu: %s', (said, id) => {
    expect(kind(said, 'intro')).toBe(`start:${id}`);
  });

  test('mid-character, a named switch needs a choosing word or the name alone', () => {
    expect(kind("Let's switch to the tree", 'writing')).toBe('start:ki');
    expect(kind('Can we try eternity instead?', 'coaching')).toBe('start:ei');
    expect(kind('永', 'writing')).toBe('start:ei');
    expect(kind('Start over with the river', 'writing')).toBe('start:kawa');
    // A name in passing is not a request.
    expect(kind('This is taking forever', 'writing')).toBeNull();
    expect(kind('I have tried ten times already', 'writing')).toBeNull();
  });

  test('the character already on the board is not "switched" to', () => {
    expect(kind('ten', 'writing', 'juu')).toBeNull();
    expect(kind("let's do ten", 'debrief', 'juu')).toBeNull();
  });

  test('a bare "one" mid-character is a number, not 一', () => {
    expect(kind('one', 'writing')).toBeNull();
    expect(characterIn('one', false)).toBeNull();
    expect(characterIn('one', true)).toBe('ichi');
  });

  test('an English "a" is not the letter A', () => {
    for (const said of ['Can I have a hint?', 'I want a different one', 'That was a good one', 'Is it a dot?']) expect(characterIn(said), said).not.toBe('latin_a');
  });
});

describe('moving on', () => {
  test.each([
    ['Next', 'next_stroke'],
    ['ok next', 'next_stroke'],
    ["I'm ready", 'next_stroke'],
    ['go on', 'next_stroke'],
    ['Next one please', 'next_stroke'],
    ['yes', 'next_stroke'],
    ["what's next?", 'next_stroke'],
  ])('after a stroke: %s', (said, expected) => {
    expect(kind(said, 'coaching')).toBe(expected);
  });

  test('while drawing, an explicit "next" is passed on (the board refuses it, and says why); readiness is not', () => {
    expect(kind('Next', 'writing')).toBe('next_stroke');
    expect(kind('skip this one', 'writing')).toBe('next_stroke');
    expect(kind("I'm ready", 'writing')).toBeNull();
    expect(kind('ok', 'writing')).toBeNull();
  });

  test.each([
    ['next character please', 'writing'],
    ['another letter', 'coaching'],
    ['something else', 'writing'],
    ['next', 'debrief'],
    ['another one', 'debrief'],
    ["let's start", 'intro'],
  ] as const)('to another character: %s (%s)', (said, phase) => {
    expect(kind(said, phase)).toBe('next_character');
  });
});

describe('starting over and clearing', () => {
  test.each(["Let's start over", 'from the top', 'wipe it', 'Start again please', 'reset the board'])('%s', (said) => {
    expect(kind(said, 'writing')).toBe('start:');
    expect(kind(said, 'coaching')).toBe('start:');
  });

  test('after the last stroke, "again" is the same character again', () => {
    expect(kind('again', 'debrief')).toBe('start:');
    expect(kind('one more time', 'debrief')).toBe('start:');
  });

  test('clearing the attempt', () => {
    expect(kind('clear', 'writing')).toBe('clear_attempt');
    expect(kind('erase that', 'writing')).toBe('clear_attempt');
    // "clear" in a sentence about something else is not a command.
    expect(kind("It's not clear which way it goes", 'writing')).toBe('reveal');
  });
});

describe('what is left to the avatar', () => {
  test.each(['How am I doing?', 'Thank you!', 'What does eternity mean in Japanese culture?', 'Why does the horizontal come first?', 'That was fun'])('%s', (said) => {
    expect(kind(said, 'coaching', 'ei')).toBeNull();
  });

  test('words never draw', () => {
    const phrasings = ['draw the stroke for me', 'draw a line from left to right', 'stroke', 'make the stroke'];
    for (const phase of ['intro', 'writing', 'coaching', 'debrief'] as Phase[]) {
      for (const said of phrasings) expect(intentIn(said, phase, 'juu')?.kind).not.toBe('stroke');
    }
  });

  test('a word or two is not worth a model call', () => {
    expect(worthAsking('hmm')).toBe(false);
    expect(worthAsking('could you go over that again')).toBe(true);
  });
});

describe("the model's answer", () => {
  const as = (answer: { action: string; character?: string }, phase: Phase, current: string | null = 'juu'): Intent | null => intentFromModel({ character: '', ...answer }, phase, current);

  test('a reveal only while a stroke is live', () => {
    expect(as({ action: 'show' }, 'writing')).toEqual({ kind: 'reveal' });
    expect(as({ action: 'show' }, 'coaching')).toBeNull();
  });

  test('a chosen character is resolved, the current one ignored, an unknown one passed on for the list', () => {
    expect(as({ action: 'choose', character: 'tree' }, 'writing')).toEqual({ kind: 'start_character', id: 'ki' });
    expect(as({ action: 'choose', character: 'juu' }, 'writing')).toBeNull();
    expect(as({ action: 'choose', character: 'dragon' }, 'intro', null)).toEqual({ kind: 'start_character', id: 'dragon' });
    expect(as({ action: 'choose', character: '' }, 'intro', null)).toBeNull();
  });

  test('"next" on the menu means the next character', () => {
    expect(as({ action: 'next_stroke' }, 'debrief')).toEqual({ kind: 'next_character' });
    expect(as({ action: 'next_stroke' }, 'coaching')).toEqual({ kind: 'next_stroke' });
  });

  test('nothing, and nonsense, is nothing', () => {
    expect(as({ action: 'none' }, 'writing')).toBeNull();
    expect(as({ action: 'stroke' }, 'writing')).toBeNull();
    expect(intentFromModel(null, 'writing', 'juu')).toBeNull();
  });

  test('the prompt describes the board without the live stroke', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    const prompt = intentPrompt(tutor.snapshot(), 'how does it go');
    expect(prompt).toContain('drawing stroke 1 of 2');
    expect(prompt).not.toContain('horizontal');
  });
});
