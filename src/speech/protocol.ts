// The speech session's WebSocket protocol, as the page uses it: pure pieces,
// tested on their own (session.ts runs the connection).
//
//   page -> server   session.start              {session: {model: 'causeur', input_transcript, ...}}
//                    session.input_audio.append {audio: base64 PCM16, 24 kHz mono}, every 20 ms, silence too
//                    session.input_audio.mute / .unmute
//                    response.item.create       {item: {type: 'function_call_output', call_id, output}}
//                    response.create            once every call of the round has its output
//                    session.close
//   server -> page   session.started            the session as the page may see it (pinned fields left out)
//                    session.output_audio.delta {delta: base64 PCM16}, paced in real time, silence too
//                    session.output_transcript.delta  the avatar's words, as their audio goes out
//                    causeur.input_transcript   {text, final}: the user's whole message so far
//                    session.delegation.created + response.event {delegation_id, event}: a tool round
//                    error                      {error: {code, message}}
//                    session.closed             {reason}, then the socket closes (1000)

/** The subprotocols a browser connects with: the API's, and the token. */
export const subprotocols = (token: string) => ['atmee-live', `atmee-token.${token}`];

/** Whole user messages, replaced as recognition goes, instead of appended chunks. */
export const INPUT_TRANSCRIPT = 'causeur.input_transcript.v1';

/**
 * Playback control: each reply comes as fast as the voice makes it, in
 * deliveries, and the page says what it played (LIVE_API.md, "Playback
 * control for a public client"). Without it the reply is paced to real time,
 * and a stall on the way is heard as a gap.
 */
export const PLAYBACK_CONTROL = 'playback-v2';

/** A delivery as `causeur.playback.start` opens it: what its acknowledgments name. */
export interface Delivery { delivery_id: number; playback_id: unknown; start_sample: number }

/** What the page played of a delivery, as the server is told it. */
export type PlaybackAck =
  | { status: 'started' }
  | {
    status: 'finished'; played_samples: number; interrupted: boolean;
    /** How the page knows: what its output reported (the default), none of it reached the
     * output, or no position at all, which the server settles from its own estimate. */
    position_source?: 'renderer_reported' | 'not_submitted' | 'unavailable';
  };

/** The `causeur.playback.ack` for a delivery. */
export function playbackAck(delivery: Delivery, ack: PlaybackAck): Record<string, unknown> {
  return {
    type: 'causeur.playback.ack', delivery_id: delivery.delivery_id,
    playback_id: delivery.playback_id, start_sample: delivery.start_sample,
    ...(ack.status === 'started' ? { status: 'started' } : {
      status: 'finished', played_samples: ack.played_samples, interrupted: ack.interrupted,
      position_source: ack.position_source ?? 'renderer_reported',
    }),
  };
}

/**
 * A server that does not offer playback control refused session.start for
 * asking: it named the field among those it refused (not merely among those
 * it supports), or the protocol.
 */
export const refusedPlaybackControl = (message: string) =>
  /Unsupported session fields: \[[^\]]*playback_control/.test(message)
  || message.startsWith('Unsupported playback control protocol');

/** 16-bit PCM as base64 (the bytes as they are: little-endian, as every browser runs). */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** base64 as 16-bit PCM; an odd trailing byte is dropped. */
export function base64ToPcm(b64: string): Int16Array {
  const s = atob(b64);
  const n = s.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8);
    out[i] = v >= 0x8000 ? v - 0x10000 : v;
  }
  return out;
}

export interface UserText {
  text: string;
  /** The user cut the avatar off with these words. */
  interruption: boolean;
  /** Listener feedback ("mm-hm") the avatar talked on through: no turn of its own. */
  backchannel: boolean;
}

/** The server's tags at the start of a user message, taken off. */
export function userText(raw: string): UserText {
  let text = raw;
  let interruption = false;
  let backchannel = false;
  for (;;) {
    if (text.startsWith('[interruption] ')) { interruption = true; text = text.slice(15); continue; }
    if (text.startsWith('[backchannel] ')) { backchannel = true; text = text.slice(14); continue; }
    break;
  }
  return { text: text.trim(), interruption, backchannel };
}

/** A function the model asked the page to run. */
export interface ToolCall { callId: string; name: string; arguments: Record<string, unknown> }

/**
 * One round of tool calls: the server announces the round, sends each call
 * as a `response.output_item.done`, then `response.completed`; the page runs
 * them and answers each one before asking the model to go on.
 */
export class ToolRounds {
  private calls = new Map<string, ToolCall[]>();

  /** Takes a `response.event`; returns the round's calls once it is complete. */
  take(message: { delegation_id?: unknown; event?: { type?: unknown; item?: Record<string, unknown> } }): ToolCall[] | null {
    const id = typeof message.delegation_id === 'string' ? message.delegation_id : '';
    const event = message.event ?? {};
    if (event.type === 'response.created') {
      this.calls.set(id, []);
      return null;
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const item = event.item;
      const list = this.calls.get(id) ?? [];
      list.push({ callId: String(item.call_id), name: String(item.name), arguments: parseArguments(item.arguments) });
      this.calls.set(id, list);
      return null;
    }
    if (event.type === 'response.completed') {
      const list = this.calls.get(id) ?? [];
      this.calls.delete(id);
      return list;
    }
    return null;
  }
}

/** A call's arguments: a JSON object, or {} when they are not one. */
export function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * A tool's answer with its outcome: `ok` false when the app refused what was
 * asked (the model still reads the text, which says why). A handler that
 * returns plain text or JSON counts as done; one that throws, as an error.
 */
export class ToolReply {
  constructor(readonly output: string, readonly ok = true) {}
}

/** Longest tool output the server takes, in characters. */
export const MAX_TOOL_OUTPUT = 65_536;

/** A handler's result as the model reads it: text as it is, anything else as JSON; an error as `error: …`. */
export function toolOutput(result: unknown, error?: unknown): string {
  let text: string;
  if (error !== undefined) text = `error: ${error instanceof Error ? error.message : String(error)}`;
  else if (typeof result === 'string') text = result;
  else if (result === undefined || result === null) text = 'done';
  else text = JSON.stringify(result);
  return text.length > MAX_TOOL_OUTPUT ? text.slice(0, MAX_TOOL_OUTPUT) : text;
}

/** Why the call ended, in the page's terms, from the server's `session.closed` reason or the socket's close code. */
export function endReason(reason: string | undefined, code: number): string {
  if (reason) {
    if (reason === 'close_requested' || reason === 'ended_by_caller') return 'ended';
    if (reason === 'expired' || reason === 'max_duration') return 'time_up';
    if (reason === 'balance_exhausted') return 'out_of_credits';
    if (reason === 'drained') return 'server_restarting';
    return reason;
  }
  if (code === 1000) return 'ended';
  if (code === 1013) return 'server_full';
  if (code === 1012) return 'server_restarting';
  if (code === 1009) return 'too_large';
  return 'disconnected';
}
