import { describe, expect, test } from 'vitest';
import {
  MAX_TOOL_OUTPUT, ToolReply, ToolRounds, base64ToPcm, endReason, parseArguments, pcmToBase64, playbackAck,
  refusedPlaybackControl, subprotocols, toolOutput, userText,
} from './protocol.ts';

describe('audio on the wire: PCM16 as base64', () => {
  test('a frame survives the round trip, signs and extremes included', () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 12345, -12345]);
    expect(Array.from(base64ToPcm(pcmToBase64(pcm)))).toEqual(Array.from(pcm));
  });
  test('the bytes are little-endian, as the API sends them', () => {
    expect(pcmToBase64(Int16Array.from([1]))).toBe(btoa('\x01\x00'));
    expect(Array.from(base64ToPcm(btoa('\xff\x7f\x00\x80')))).toEqual([32767, -32768]);
  });
  test('a 20 ms frame of silence is 960 zero bytes', () => {
    expect(atob(pcmToBase64(new Int16Array(480))).length).toBe(960);
  });
});

test('a browser presents its token as the second subprotocol', () => {
  expect(subprotocols('abc.def.ghi')).toEqual(['atmee-live', 'atmee-token.abc.def.ghi']);
});

describe("the user's words", () => {
  test('the tags the server starts a message with come off, and say what the words did', () => {
    expect(userText('[interruption] wait, Thursday')).toEqual({ text: 'wait, Thursday', interruption: true, backchannel: false });
    expect(userText('[backchannel] mm-hm')).toEqual({ text: 'mm-hm', interruption: false, backchannel: true });
    expect(userText('Thursday please')).toEqual({ text: 'Thursday please', interruption: false, backchannel: false });
  });
});

describe('a tool round', () => {
  const ev = (delegation: string, event: Record<string, unknown>) => ({ type: 'response.event', delegation_id: delegation, event });
  const call = (id: string, name: string, args: unknown) => ({ type: 'response.output_item.done', item: { type: 'function_call', call_id: id, name, arguments: args } });

  test('its calls arrive one by one and are run once the round is complete', () => {
    const rounds = new ToolRounds();
    expect(rounds.take(ev('d1', { type: 'response.created', response: {} }))).toBeNull();
    expect(rounds.take(ev('d1', call('c1', 'check_availability', '{"day":"Thursday"}')))).toBeNull();
    expect(rounds.take(ev('d1', call('c2', 'find_appointments', '{"patient_name":"Maria Gomez"}')))).toBeNull();
    expect(rounds.take(ev('d1', { type: 'response.completed', response: {} }))).toEqual([
      { callId: 'c1', name: 'check_availability', arguments: { day: 'Thursday' } },
      { callId: 'c2', name: 'find_appointments', arguments: { patient_name: 'Maria Gomez' } },
    ]);
  });

  test('two rounds keep apart, and a finished one is forgotten', () => {
    const rounds = new ToolRounds();
    rounds.take(ev('a', { type: 'response.created' }));
    rounds.take(ev('b', { type: 'response.created' }));
    rounds.take(ev('a', call('1', 'x', '{}')));
    rounds.take(ev('b', call('2', 'y', '{}')));
    expect(rounds.take(ev('b', { type: 'response.completed' }))?.map((c) => c.callId)).toEqual(['2']);
    expect(rounds.take(ev('a', { type: 'response.completed' }))?.map((c) => c.callId)).toEqual(['1']);
    expect(rounds.take(ev('a', { type: 'response.completed' }))).toEqual([]);
  });

  test('arguments that are not a JSON object are read as none', () => {
    expect(parseArguments('not json')).toEqual({});
    expect(parseArguments('[1,2]')).toEqual({});
    expect(parseArguments('')).toEqual({});
    expect(parseArguments({ day: 'Friday' })).toEqual({ day: 'Friday' });
  });

  test("an app's own refusal is a reply, not an error: the model reads why, the page marks it refused", () => {
    expect(new ToolReply('Not sold: 8 silver, the player has 4.', false)).toMatchObject({ output: 'Not sold: 8 silver, the player has 4.', ok: false });
    expect(new ToolReply('Sold.').ok).toBe(true);
  });

  test('what the model reads back: text as it is, objects as JSON, errors marked, never over the limit', () => {
    expect(toolOutput('Booked: Thursday')).toBe('Booked: Thursday');
    expect(toolOutput({ ok: true })).toBe('{"ok":true}');
    expect(toolOutput(undefined)).toBe('done');
    expect(toolOutput(undefined, new Error('the book is closed'))).toBe('error: the book is closed');
    expect(toolOutput('x'.repeat(MAX_TOOL_OUTPUT + 10)).length).toBe(MAX_TOOL_OUTPUT);
  });
});

describe('why a call ended', () => {
  test("from the server's reason first", () => {
    expect(endReason('close_requested', 1000)).toBe('ended');
    expect(endReason('ended_by_caller', 1000)).toBe('ended');
    expect(endReason('expired', 1000)).toBe('time_up');
    expect(endReason('balance_exhausted', 1000)).toBe('out_of_credits');
  });
  test("else from the socket's close code: 1013 is a full server, 1006 a dropped line", () => {
    expect(endReason(undefined, 1013)).toBe('server_full');
    expect(endReason(undefined, 1012)).toBe('server_restarting');
    expect(endReason(undefined, 1006)).toBe('disconnected');
  });
});

describe('playback control on the wire', () => {
  const delivery = { delivery_id: 3, playback_id: 41, start_sample: 2400 };

  test('an acknowledgment names its delivery as the server opened it', () => {
    expect(playbackAck(delivery, { status: 'started' })).toEqual({
      type: 'causeur.playback.ack', delivery_id: 3, playback_id: 41, start_sample: 2400, status: 'started' });
    expect(playbackAck(delivery, { status: 'finished', played_samples: 960, interrupted: true })).toEqual({
      type: 'causeur.playback.ack', delivery_id: 3, playback_id: 41, start_sample: 2400, status: 'finished',
      played_samples: 960, interrupted: true, position_source: 'renderer_reported' });
  });

  test('a server without playback control refused the start for asking; another refusal is not that', () => {
    expect(refusedPlaybackControl("Unsupported session fields: ['playback_control']; supported: audio, model")).toBe(true);
    expect(refusedPlaybackControl('Unsupported playback control protocol')).toBe(true);
    // A refusal of another field lists playback_control among what is supported.
    expect(refusedPlaybackControl("Unsupported session fields: ['safety']; supported: audio, playback_control")).toBe(false);
    expect(refusedPlaybackControl('Supported model: causeur')).toBe(false);
  });
});
