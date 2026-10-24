import { describe, expect, test } from 'vitest';
import { sentences, ttsRequest, wav } from './speech.ts';

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

describe("the host's own voice, from Fish", () => {
  test('only the text is sent to be spoken: no instruction rides along to be read out', () => {
    expect(ttsRequest('Good evening.', 'voice-1')).toEqual({ text: 'Good evening.', reference_id: 'voice-1', format: 'pcm', sample_rate: 16000, latency: 'balanced' });
  });
  test("the 16 kHz PCM comes back as a WAV with its rate, the avatar's own", () => {
    const out = wav(Buffer.alloc(320), 16000);
    expect(out.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.readUInt32LE(24)).toBe(16000);
    expect(out.length).toBe(44 + 320);
  });
});
