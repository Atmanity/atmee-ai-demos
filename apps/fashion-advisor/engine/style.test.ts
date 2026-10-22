// Style targets: the keyword map's order, the brief, and the style hidden in a
// name reply (ported from test_style_already_given.py and test_parity.py).
import { describe, expect, test } from 'vitest';
import { matchStyleKeyword, normalizeStyleCategory, styleConfirmationPhrase, styleHintFromNameReply, targetStyleBrief } from './style.ts';

describe('the style keyword map', () => {
  test('the canonical label, never the utterance', () => {
    // Storing the utterance once read back "we are shaping this into Oh, fashion forward sounds good".
    expect(matchStyleKeyword('Oh, fashion forward sounds good')).toBe('fashion forward');
  });

  test('longer phrases win over the words they contain', () => {
    expect(matchStyleKeyword('smart casual please')).toBe('smart casual');
    expect(matchStyleKeyword('business casual to impress people at work')).toBe('business casual');
    expect(matchStyleKeyword('minimalist professional')).toBe('minimalist professional');
    expect(matchStyleKeyword('something minimalistic')).toBe('minimalist');
    expect(matchStyleKeyword('a rock-star vibe')).toBe('rockstar');
  });

  test('occasions count as targets; nothing named is empty', () => {
    expect(matchStyleKeyword("I've got a wedding on Saturday")).toBe('wedding');
    expect(matchStyleKeyword('the German soccer guy')).toBe('');
  });
});

test('business casual is smart-casual, not strict business', () => {
  expect(normalizeStyleCategory('business casual')).toBe('smart-casual');
  expect(normalizeStyleCategory('Office')).toBe('business');
  expect(normalizeStyleCategory('street wear')).toBe('streetwear');
  expect(normalizeStyleCategory('old money')).toBe('old money');
});

test('the phrase said back is short', () => {
  expect(styleConfirmationPhrase('I want to go business casual for the office')).toBe('business casual');
  expect(styleConfirmationPhrase('old money')).toBe('old money');
  expect(styleConfirmationPhrase('a really long description of a look with far too many words in it')).toBe('a really long description of a look with far too many words in it'.toLowerCase());
});

test('the style brief does not repeat itself', () => {
  // desired look and direction often say the same thing; both made the prompt read "business casual, business casual".
  expect(targetStyleBrief('business casual', 'business').match(/business/g)).toHaveLength(1);
  expect(targetStyleBrief('date night', 'streetwear')).toBe('date night, streetwear');
  expect(targetStyleBrief('', 'formal')).toBe('formal');
});

describe('a style given with the name', () => {
  test('a name reply that says more carries a hint', () => {
    expect(styleHintFromNameReply("I'm Sam, going for smart casual for a work dinner", 'Sam')).toBe("I'm Sam, going for smart casual for a work dinner");
  });

  test('a bare name carries none, so the style question is still asked', () => {
    expect(styleHintFromNameReply('Sam', 'Sam')).toBe('');
    expect(styleHintFromNameReply("I'm Sam", 'Sam')).toBe('');
    expect(styleHintFromNameReply('Hi, my name is Sam, thanks', 'Sam')).toBe('');
  });

  test('a reply that says more but names no style still carries the sentence (the matcher decides)', () => {
    expect(styleHintFromNameReply("I'm Sam, and I have no camera", 'Sam')).not.toBe('');
    expect(matchStyleKeyword("I'm Sam, and I have no camera")).toBe('');
  });
});
