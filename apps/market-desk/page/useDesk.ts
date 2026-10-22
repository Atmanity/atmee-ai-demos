// The page's side of the desk: open one on the server, stream its board, act on it.
// The server owns the board (the feed, the pump, the timers); the page draws it
// and relays the desk's own lines to the avatar.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, DeskMessage, Outcome } from '../engine/types.ts';

const API = '/api/apps/market-desk';

export type DeskInput = { intent: { kind: string; symbol?: string } } | { text: string; from: 'spoken' | 'typed' };

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw Object.assign(new Error(`${path}: ${res.status}`), { status: res.status });
  return res.json();
}

export function useDesk({ onSay, onBoard }: {
  /** A line the desk wants the avatar to say (a quote landing, a 1% move, a failed add). */
  onSay: (text: string, ttlS: number) => void;
  /** Every newer board, synchronously (before any line about it is passed on). */
  onBoard?: (board: Board) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [lost, setLost] = useState(false);
  const id = useRef<string | null>(null);
  const seq = useRef(-1);
  const handlers = useRef({ onSay, onBoard });
  handlers.current = { onSay, onBoard };
  const [generation, setGeneration] = useState(0); // bumped to open a fresh desk (the server restarted)

  // Boards arrive from the stream and from each action's reply; the newest wins.
  const accept = useCallback((s: number, b: Board) => {
    if (s < seq.current) return;
    seq.current = s;
    setBoard(b);
    handlers.current.onBoard?.(b);
  }, []);

  useEffect(() => {
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
        else handlers.current.onSay(message.text, message.ttl);
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
  }, [generation, accept]);

  const act = useCallback(async (input: DeskInput): Promise<Outcome | null> => {
    if (!id.current) return null;
    try {
      const outcome = await post<Outcome>(`/desks/${id.current}/act`, input);
      accept(outcome.seq, outcome.board);
      return outcome;
    } catch (err) {
      console.warn('[market-desk]', err);
      if ((err as { status?: number }).status === 404) setGeneration((g) => g + 1);
      return null;
    }
  }, [accept]);

  return { board, act, lost };
}
