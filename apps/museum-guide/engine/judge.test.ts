import { describe, expect, it } from 'vitest';
import { asksForHost, asksWhat } from './judge.ts';

describe('the safety net\'s phrases', () => {
  it.each([
    "What's this?", 'what is that painting', 'Whats this', '[interruption] what’s this one', 'Who painted this?',
    'what am I looking at', 'tell me about this', '[backchannel] Who made it?',
  ])('asks what something is: %s', (text) => expect(asksWhat(text)).toBe(true));

  it.each(['What a lovely painting', 'This is nice', 'what time is it there', 'who painted the Mona Lisa'])(
    'does not: %s', (text) => expect(asksWhat(text)).toBe(false));

  it.each([
    'Can I talk to Edmund again?', 'bring back the chairman', 'Take me back to the guide', 'call him back please',
    '[interruption] Edmund, are you there?', 'I want your guide back', 'Where is Edmund?',
  ])('asks a guest for Edmund: %s', (text) => expect(asksForHost(text)).toBe(true));

  it.each(['What were you thinking about?', 'Tell me about the fog', 'go back to the mountains', 'Did Edmund say 1665?',
    'go back to the window', 'Edmund told me you were painted in 1818', 'Was the chairman right about the fog?'])(
    'does not: %s', (text) => expect(asksForHost(text)).toBe(false));
});
