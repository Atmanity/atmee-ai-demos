// A microphone held down: while it is on, each block of its audio (16 kHz PCM)
// goes to the app, with a level for a meter. The browser asks for the
// microphone the first time only; letting go stops the tap but keeps the
// permission for the next press.
import { useCallback, useEffect, useRef, useState } from 'react';
import { tapMicrophone } from '../avatar/pcm.ts';

export interface MicTap {
  on: boolean;
  /** 0..1, the loudness of the latest block. */
  level: number;
  /** Why the microphone could not start, in the user's words, or ''. */
  error: string;
  /** Starts the tap; false when it could not, or when stop() came first (the button was let go). */
  begin(onPcm: (pcm: Int16Array) => void): Promise<boolean>;
  stop(): Promise<void>;
}

const rms = (pcm: Int16Array) => { let s = 0; for (const v of pcm) s += v * v; return Math.sqrt(s / Math.max(1, pcm.length)) / 32768; };

export function useMicTap(): MicTap {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const stream = useRef<MediaStream | null>(null);
  const untap = useRef<(() => Promise<void>) | null>(null);
  // Each begin and each stop takes a number: a begin that finds a newer one when its awaits
  // return was let go meanwhile (a permission prompt, the worklet loading) and does not start.
  const turn = useRef(0);

  const begin = useCallback(async (onPcm: (pcm: Int16Array) => void) => {
    if (untap.current) return true;
    const mine = ++turn.current;
    setError('');
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (mine !== turn.current) return false;
      const stopTap = await tapMicrophone(stream.current, (pcm) => { setLevel(Math.min(1, rms(pcm) * 4)); onPcm(pcm); });
      if (mine !== turn.current) { await stopTap(); return false; }
      untap.current = stopTap;
      setOn(true);
      return true;
    } catch (err) {
      const name = (err as Error).name;
      setError(name === 'NotAllowedError' ? 'The microphone is blocked: allow it in the address bar, then try again.' : 'No microphone could be opened.');
      return false;
    }
  }, []);

  const stop = useCallback(async () => {
    turn.current++;
    const done = untap.current;
    untap.current = null;
    setOn(false);
    setLevel(0);
    await done?.();
  }, []);

  useEffect(() => () => {
    void untap.current?.();
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { on, level, error, begin, stop };
}
