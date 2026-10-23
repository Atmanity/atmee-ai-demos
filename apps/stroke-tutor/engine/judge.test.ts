// Words to sheet actions, as people actually phrase them. Ren chooses the tool
// for a line; these rules are what the safety net acts on when Ren does not,
// and how a character Ren passes on is read. They must route the common
// lines the way the original's model did, and leave the rest (small talk,
// questions about a stroke already done) to Ren.
import { describe, expect, test } from 'vitest';
import { CHARACTERS } from './characters.ts';
import { characterIn, GLYPHS, intentIn, mustDo, SPOKEN } from './judge.ts';
import type { Phase } from './types.ts';

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

  test('once the stroke is done, the same question is Ren\'s to answer from the sheet', () => {
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

describe('what is left to Ren', () => {
  test.each(['How am I doing?', 'Thank you!', 'What does eternity mean in Japanese culture?', 'Why does the horizontal come first?', 'That was fun'])('%s', (said) => {
    expect(kind(said, 'coaching', 'ei')).toBeNull();
  });

  test('words never draw', () => {
    const phrasings = ['draw the stroke for me', 'draw a line from left to right', 'stroke', 'make the stroke'];
    for (const phase of ['intro', 'writing', 'coaching', 'debrief'] as Phase[]) {
      for (const said of phrasings) expect(intentIn(said, phase, 'juu')?.kind).not.toBe('stroke');
    }
  });
});

describe('the page-safe names', () => {
  test('every character has spoken names, and every kanji its glyph, matching the character set', () => {
    for (const c of CHARACTERS) {
      expect(SPOKEN.some(([id]) => id === c.id), c.id).toBe(true);
      if (c.script === 'kanji') expect(GLYPHS).toContainEqual([c.id, c.glyph]);
    }
    expect(GLYPHS.length).toBe(CHARACTERS.filter((c) => c.script === 'kanji').length);
  });
});

describe('the safety net: what it does when Ren does not, and only what is safe twice', () => {
  const net = (text: string, phase: Phase, current: string | null = phase === 'intro' ? null : 'juu') => {
    const call = mustDo(text, phase, current);
    return call ? (call.name === 'choose_character' ? `choose:${call.arguments.character}` : call.name) : null;
  };

  test.each([
    ['Show me.', 'show_stroke'],
    ['Can you show me this one?', 'show_stroke'],
    ['Which way does it go?', 'show_stroke'],
    ['which direction', 'show_stroke'],
    ['Where do I start?', 'show_stroke'],
    ['How do I draw it?', 'show_stroke'],
    ['What shape is it?', 'show_stroke'],
    ['Which stroke comes first?', 'show_stroke'],
    ["I'm stuck.", 'show_stroke'],
    ['im stuck', 'show_stroke'],
    ['Start over.', 'start_over'],
    ["Let's start again from the top.", 'start_over'],
    ['Next.', null],                          // refused while a stroke is live: Ren says so from the sheet
    ["I don't know", null],                   // left to Ren, who hears the whole sentence
    ['Can I have a hint?', null],
    ['help', null],
    ["I don't know what eternity means", null],
    ['How am I doing?', null],
    ['Next character please', null],          // done twice it would skip one
  ] as const)('while writing: %s', (said, expected) => {
    expect(net(said, 'writing')).toBe(expected);
  });

  test.each([
    ['Next.', 'next_stroke'],
    ['next stroke please', 'next_stroke'],
    ['OK, next one.', 'next_stroke'],
    ["I'm ready.", 'next_stroke'],
    ['Go on.', 'next_stroke'],
    ["What's next?", 'next_stroke'],
    ['Yes.', null],                           // an answer to some other question as often as not
    ['ok', null],
    ['Show me.', null],                       // already on the sheet; Ren teaches it from the board
    ['Start over', 'start_over'],
  ] as const)('after a stroke: %s', (said, expected) => {
    expect(net(said, 'coaching')).toBe(expected);
  });

  test.each([
    ["Let's do the tree one.", 'choose:ki'],
    ['永', 'choose:ei'],
    ['The letter A, please.', 'choose:latin_a'],
    ['Can we do river?', 'choose:kawa'],
    ['one', 'choose:ichi'],
    ['Next.', null],                          // next character: not safe twice
    ['Start over', null],
  ] as const)('on the menu: %s', (said, expected) => {
    expect(net(said, 'intro')).toBe(expected);
  });

  test('after the last stroke: another character by name, or this one again', () => {
    expect(net("Let's try eternity", 'debrief')).toBe('choose:ei');
    expect(net('One more time', 'debrief')).toBe('start_over');
    expect(net('another one', 'debrief')).toBeNull();
  });

  test('mid-character, a switch is left to Ren (it would wipe their progress)', () => {
    expect(net("Let's switch to the tree", 'writing')).toBeNull();
    expect(net('永', 'coaching')).toBeNull();
  });
});
