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

  const begin = useCallback(async (onPcm: (pcm: Int16Array) => void) => {
    if (untap.current) return true;
    setError('');
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      untap.current = await tapMicrophone(stream.current, (pcm) => { setLevel(Math.min(1, rms(pcm) * 4)); onPcm(pcm); });
      setOn(true);
      return true;
    } catch (err) {
      const name = (err as Error).name;
      setError(name === 'NotAllowedError' ? 'The microphone is blocked: allow it in the address bar, then try again.' : 'No microphone could be opened.');
      return false;
    }
  }, []);

  const stop = useCallback(async () => {
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
