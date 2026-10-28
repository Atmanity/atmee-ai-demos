import { describe, expect, it } from 'vitest';
import { clean } from './App.tsx';

describe('fillers out of captions and the transcript', () => {
  it.each([
    ['Tonight we are diving into the desert epic Amberfall. ummm I mean uh', 'Tonight we are diving into the desert epic Amberfall.'],
    ['Hmm, that is a lovely question.', 'that is a lovely question.'],
    ['We used, uh, three kinds of silk.', 'We used, three kinds of silk.'],
    ['It was a struggle. hmm but um', 'It was a struggle.'],
    ['Well, the light was the hardest part.', 'Well, the light was the hardest part.'],
    ['I mean, it took months.', 'I mean, it took months.'],
    ['The umbrella and the hummingbird stayed.', 'The umbrella and the hummingbird stayed.'],
    ['were you constantly repairing them between takes? yeah uh uhhh ummm oh', 'were you constantly repairing them between takes?'],
    ['Oh, that is beautiful.', 'Oh, that is beautiful.'],
  ])('%s', (input, out) => { expect(clean(input)).toBe(out); });
});
