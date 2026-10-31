import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bridgeHearing, listenUrl, readResult, type Peer } from './hearing.ts';

class Fake extends EventEmitter {
  sent: (string | Uint8Array)[] = [];
  closed = false;
  constructor(public readyState: number) { super(); }
  send(data: string | Uint8Array) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
}
const peers = (upstreamState = 0) => {
  const client = new Fake(1);
  const upstream = new Fake(upstreamState);
  bridgeHearing(client as unknown as Peer, upstream as unknown as Peer);
  return { client, upstream };
};
const audio = (n: number) => Buffer.alloc(n);
const results = (over: object) => JSON.stringify({ type: 'Results', start: 2, duration: 1.5, is_final: true, speech_final: false, channel: { alternatives: [{ transcript: 'hello there' }] }, ...over });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Deepgram's messages as the page's", () => {
  test('a result says its words, whether final, and when the speech ended on the audio clock', () => {
    expect(readResult(results({}))).toEqual({ type: 'heard', text: 'hello there', final: true, ended: false, at: 3.5 });
  });
  test('a pause, or a finalize, ends the run', () => {
    expect(readResult(results({ speech_final: true }))).toMatchObject({ final: true, ended: true });
    expect(readResult(results({ from_finalize: true }))).toMatchObject({ ended: true });
  });
  test('an interim result never ends the run', () => {
    expect(readResult(results({ is_final: false, speech_final: true }))).toMatchObject({ final: false, ended: false });
  });
  test('an empty result with a pause still ends the run; other empties and metadata are dropped', () => {
    const silent = { channel: { alternatives: [{ transcript: '' }] } };
    expect(readResult(results({ ...silent, speech_final: true }))).toMatchObject({ text: '', ended: true });
    expect(readResult(results(silent))).toBeNull();
    expect(readResult('{"type":"Metadata"}')).toBeNull();
    expect(readResult('not json')).toBeNull();
    expect(readResult('{"type":"UtteranceEnd"}')).toEqual({ type: 'ended' });
  });
});

describe('the bridge', () => {
  test('the language is the one asked for; no secret in the URL', () => {
    const url = listenUrl('zh-TW');
    expect(url).toContain('language=zh-TW');
    expect(url).not.toMatch(/token|key/i);
  });
  test('audio sent before Deepgram is ready goes first, in order, then straight through', () => {
    const { client, upstream } = peers();
    const a = audio(10), b = audio(20), c = audio(30);
    client.emit('message', a, true);
    client.emit('message', b, true);
    expect(upstream.sent).toEqual([]);
    upstream.readyState = 1;
    upstream.emit('open');
    client.emit('message', c, true);
    expect(upstream.sent).toEqual([a, b, c]);
  });
  test('audio waiting for Deepgram is capped', () => {
    const { client, upstream } = peers();
    for (let i = 0; i < 12; i++) client.emit('message', audio(16_000), true);
    upstream.readyState = 1;
    upstream.emit('open');
    expect(upstream.sent).toHaveLength(10);
  });
  test('the page can finalize; no other text reaches Deepgram', () => {
    const { client, upstream } = peers(1);
    client.emit('message', Buffer.from('finalize'), false);
    client.emit('message', Buffer.from('{"type":"CloseStream"}'), false);
    expect(upstream.sent).toEqual(['{"type":"Finalize"}']);
  });
  test('a finalize sent before Deepgram is ready goes after the held audio', () => {
    const { client, upstream } = peers();
    const a = audio(10);
    client.emit('message', a, true);
    client.emit('message', Buffer.from('finalize'), false);
    upstream.readyState = 1;
    upstream.emit('open');
    expect(upstream.sent).toEqual([a, '{"type":"Finalize"}']);
  });
  test('the stream is kept alive through silence', () => {
    const { upstream } = peers(1);
    vi.advanceTimersByTime(5_000);
    expect(upstream.sent).toEqual(['{"type":"KeepAlive"}']);
  });
  test('the page leaving closes Deepgram once and stops the keep-alive', () => {
    const { client, upstream } = peers(1);
    client.readyState = 3;
    client.emit('close');
    expect(upstream.sent).toEqual(['{"type":"CloseStream"}']);
    expect(upstream.closed).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(upstream.sent).toHaveLength(1);
  });
  test('Deepgram going away tells the page', () => {
    const { client, upstream } = peers(1);
    upstream.readyState = 3;
    upstream.emit('close');
    expect(client.sent).toEqual(['{"type":"lost"}']);
    expect(client.closed).toBe(true);
  });
  test('a stream ends at its limit, so a forgotten tab does not keep spending', () => {
    const { client, upstream } = peers(1);
    vi.advanceTimersByTime(15 * 60_000);
    expect(client.closed).toBe(true);
    expect(upstream.closed).toBe(true);
  });
});
