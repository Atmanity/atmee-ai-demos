// The page's microphone to Deepgram's live speech recognition, through this server because
// Deepgram's key stays here. Audio goes up as it comes; what was heard comes back as small messages.
import type { EventEmitter } from 'node:events';

export interface Heard { type: 'heard'; text: string; final: boolean; ended: boolean; at: number }
export interface Ended { type: 'ended' }

/** A WebSocket, as far as the bridge cares. */
export interface Peer extends EventEmitter {
  readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;
const MAX_HELD_BYTES = 16_000 * 2 * 5;     // five seconds of 16 kHz speech while Deepgram connects
const KEEP_ALIVE_MS = 5_000;               // Deepgram closes an idle stream after about ten seconds
export const MAX_LISTEN_MS = 15 * 60_000;
const FINALIZE = JSON.stringify({ type: 'Finalize' });

export function listenUrl(language: string): string {
  const query = new URLSearchParams({
    model: 'nova-3', language, encoding: 'linear16', sample_rate: '16000', channels: '1',
    interim_results: 'true', punctuate: 'true', smart_format: 'true', endpointing: '250', utterance_end_ms: '1000',
  });
  return `wss://api.deepgram.com/v1/listen?${query}`;
}

/** One of Deepgram's messages as the page's, or null for those it has no use for. */
export function readResult(raw: string): Heard | Ended | null {
  let json: any;
  try { json = JSON.parse(raw); } catch { return null; }
  if (json.type === 'UtteranceEnd') return { type: 'ended' };
  if (json.type !== 'Results') return null;
  const text = String(json.channel?.alternatives?.[0]?.transcript ?? '').trim();
  const final = json.is_final === true;
  const ended = final && (json.speech_final === true || json.from_finalize === true);
  if (!text && !ended) return null;
  return { type: 'heard', text, final, ended, at: Number(json.start ?? 0) + Number(json.duration ?? 0) };
}

export function bridgeHearing(client: Peer, upstream: Peer, limitMs = MAX_LISTEN_MS): void {
  const held: Uint8Array[] = [];
  let heldBytes = 0;
  let finished = false;
  let finalizeHeld = false;
  const toUpstream = (data: string | Uint8Array) => { if (upstream.readyState === OPEN) upstream.send(data); };
  const finish = (lost: boolean) => {
    if (finished) return;
    finished = true;
    clearInterval(keepAlive);
    clearTimeout(limit);
    if (client.readyState === OPEN) {
      if (lost) client.send(JSON.stringify({ type: 'lost' }));
      client.close(lost ? 1011 : 1000);
    }
    toUpstream(JSON.stringify({ type: 'CloseStream' }));
    upstream.close();
  };
  const keepAlive = setInterval(() => toUpstream(JSON.stringify({ type: 'KeepAlive' })), KEEP_ALIVE_MS);
  const limit = setTimeout(() => finish(false), limitMs);

  upstream.on('open', () => {
    for (const audio of held) toUpstream(audio);
    held.length = 0;
    heldBytes = 0;
    if (finalizeHeld) toUpstream(FINALIZE);
  });
  upstream.on('message', (data: Buffer) => {
    const result = readResult(data.toString());
    if (result && client.readyState === OPEN) client.send(JSON.stringify(result));
  });
  upstream.on('close', () => finish(true));
  upstream.on('error', () => finish(true));

  client.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      if (data.toString() !== 'finalize') return;
      if (upstream.readyState === OPEN) upstream.send(FINALIZE);
      else finalizeHeld = true;
      return;
    }
    if (upstream.readyState === OPEN) return void upstream.send(data);
    if (heldBytes + data.length <= MAX_HELD_BYTES) { held.push(data); heldBytes += data.length; }
  });
  client.on('close', () => finish(false));
  client.on('error', () => finish(false));
}
