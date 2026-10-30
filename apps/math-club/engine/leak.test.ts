import { expect, it } from 'vitest';
import { cleanSpeech, leakedCall } from './leak.ts';

const LINE = 'Yay, oh so nice, give_answer{answer:<ctrl46>1000<ctrl46>}Yay, oh so nice, you got it right!';

it('reads the call out of the words', () => {
  expect(leakedCall(LINE)).toEqual({ name: 'give_answer', arguments: { answer: '1000' } });
  expect(leakedCall('next_round{}')).toEqual({ name: 'next_round', arguments: {} });
});

it('finds nothing in ordinary speech', () => {
  expect(leakedCall('Give an answer when you are ready!')).toBeNull();
});

it('takes the call out of the words, whole or half arrived', () => {
  expect(cleanSpeech(LINE)).toBe('Yay, oh so nice, Yay, oh so nice, you got it right!');
  expect(cleanSpeech('Yay! give_answer{answer:<ctrl46>10')).toBe('Yay!');
  expect(cleanSpeech('Well done!')).toBe('Well done!');
});
