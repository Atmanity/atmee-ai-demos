import { describe, expect, test } from 'vitest';
import { toolReply } from './room.ts';

describe('toolReply', () => {
  test('a string goes back as it is', () => expect(toolReply('4417')).toBe('4417'));
  test('anything else goes back as JSON', () => expect(toolReply({ secret: 4417 })).toBe('{"secret":4417}'));
  test('nothing is "ok"', () => {
    expect(toolReply(undefined)).toBe('ok');
    expect(toolReply(null)).toBe('ok');
  });
  test('a result LiveKit would refuse becomes an error the avatar can read', () =>
    expect(toolReply('x'.repeat(15_001))).toBe('error: the result was too large'));
});
