// The page's side of the desk: open one on the server, stream its board, and
// send it the host's tool calls and the user's button presses. The server
// owns the board (the feed, the pump, the timers); the page draws it and
// relays the desk's own lines to the host.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActReply, Board, DeskMessage, Kind } from '../engine/types.ts';

const API = '/api/apps/market-desk';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw Object.assign(new Error(`${path}: ${res.status}`), { status: res.status });
  return res.json();
}

export function useDesk({ enabled, onSay }: {
  /** Open the desk (once the user has come in from the front door). */
  enabled: boolean;
  /** A line the desk wants the host to say (a 1% move, a quote that outlived the host's wait). */
  onSay: (text: string, ttlS: number) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [lost, setLost] = useState(false);
  const id = useRef<string | null>(null);
  const seq = useRef(-1);
  const sayRef = useRef(onSay);
  sayRef.current = onSay;
  const [generation, setGeneration] = useState(0); // bumped to open a fresh desk (the server restarted)

  // Boards arrive from the stream and from each action's reply; the newest wins.
  const accept = useCallback((s: number, b: Board) => {
    if (s < seq.current) return;
    seq.current = s;
    setBoard(b);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void post<{ id: string; seq: number; board: Board }>('/desks').then((desk) => {
      if (cancelled) return;
      id.current = desk.id;
      seq.current = -1;
      accept(desk.seq, desk.board);
      setLost(false);
      source = new EventSource(`${API}/desks/${desk.id}/stream`);
      source.onmessage = (e) => {
        const message = JSON.parse(e.data) as DeskMessage;
        if (message.type === 'board') accept(message.seq, message.board);
        else sayRef.current(message.text, message.ttl);
      };
      // A dropped stream reconnects by itself; one the server refuses (it no
      // longer knows this desk) is closed for good, so open a new desk.
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED || cancelled) return;
        setLost(true);
        retry = setTimeout(() => setGeneration((g) => g + 1), 2000);
      };
    }).catch(() => {
      if (cancelled) return;
      setLost(true);
      retry = setTimeout(() => setGeneration((g) => g + 1), 3000);
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [enabled, generation, accept]);

  const send = useCallback(async (path: string, body: unknown): Promise<ActReply> => {
    if (!id.current) throw new Error('the board is still opening; try again in a moment');
    try {
      const reply = await post<ActReply>(`/desks/${id.current}${path}`, body);
      accept(reply.seq, reply.board);
      return reply;
    } catch (err) {
      if ((err as { status?: number }).status === 404) setGeneration((g) => g + 1);
      throw err;
    }
  }, [accept]);

  /** The host's tool call: the reply's text is what the host says next. */
  const tool = useCallback((name: string, args: Record<string, unknown>) => send('/tool', { name, arguments: args }), [send]);
  /** A button: it acts at once; the reply's text tells the host what happened. */
  const act = useCallback((command: Kind, symbol = '') => send('/act', { command, symbol }), [send]);

  return { board, lost, tool, act };
}
