import { describe, expect, test } from 'vitest';
import { asWav, sentences, wav } from './speech.ts';

describe('an answer voiced a sentence at a time', () => {
  test('sentences in order; a short one rides with the next', () => {
    expect(sentences("Hi, I'm Tess from the Waybill help desk. What's your tracking number? It starts with W B."))
      .toEqual(["Hi, I'm Tess from the Waybill help desk.", "What's your tracking number? It starts with W B."]);
  });
  test('a short tail joins the sentence before it; text with no stop is one piece', () => {
    expect(sentences('We booked it for Wednesday between eight and six. Thanks!')).toEqual(['We booked it for Wednesday between eight and six. Thanks!']);
    expect(sentences('no full stop at all')).toEqual(['no full stop at all']);
  });
});

describe("Gemini's audio as a WAV", () => {
  test('raw PCM gets a header with its rate', () => {
    const out = asWav(Buffer.alloc(480), 'audio/L16;codec=pcm;rate=24000');
    expect(out.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.readUInt32LE(24)).toBe(24000);
    expect(out.length).toBe(44 + 480);
  });
  test('a WAV is passed through, not wrapped twice', () => {
    const file = wav(Buffer.alloc(100), 16000);
    expect(asWav(file, 'audio/wav')).toBe(file);
  });
});
