// Spotify's Web Playback SDK: the booth itself becomes a Spotify device, with
// whole tracks and a volume. Needs a Premium listener signed in (spotify-auth.ts).
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Track } from '../engine/types.ts';
import type { Playback, Player } from './player.ts';

let sdk: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdk ??= new Promise((resolve) => {
    (window as any).onSpotifyWebPlaybackSDKReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);
  });
  return sdk;
}

/** How often the page reads the player's position: the SDK reports only changes of state. */
const POLL_MS = 500;

export function useSdkPlayer(token: () => Promise<string>, onUpdate: (p: Playback) => void, onError: (message: string) => void): Player {
  const player = useRef<any>(null);
  const device = useRef<Promise<string> | null>(null);
  const listener = useRef(onUpdate);
  listener.current = onUpdate;
  const failed = useRef(onError);
  failed.current = onError;

  // The script early, so the player can be made within the listener's click.
  useEffect(() => { void loadSdk(); }, []);

  /** Makes the player; call it from a click, where the browser lets it play sound. */
  const prepare = useCallback(() => {
    if (device.current) return;
    device.current = loadSdk().then(() => new Promise<string>((resolve, reject) => {
      const p = new (window as any).Spotify.Player({ name: 'Crate booth', getOAuthToken: (cb: (t: string) => void) => void token().then(cb, (e) => failed.current(String(e.message))), volume: 0.8 });
      const fail = (what: string) => ({ message }: { message: string }) => { failed.current(`${what}: ${message}`); reject(new Error(message)); };
      p.addListener('ready', ({ device_id }: { device_id: string }) => resolve(device_id));
      p.addListener('initialization_error', fail('This browser cannot play Spotify here'));
      p.addListener('authentication_error', fail('Spotify sign-in expired'));
      p.addListener('account_error', fail('Spotify Premium is needed for the booth player'));
      p.activateElement?.();
      void p.connect();
      player.current = p;
    }));
    device.current.catch(() => {});
  }, [token]);

  useEffect(() => {
    const id = setInterval(async () => {
      const state = await player.current?.getCurrentState().catch(() => null);
      if (state) listener.current({ isPaused: state.paused, isBuffering: state.loading, position: state.position, duration: state.duration });
    }, POLL_MS);
    return () => { clearInterval(id); player.current?.disconnect(); };
  }, []);

  const load = useCallback(async (track: Track) => {
    prepare();
    const id = await device.current!;
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [`spotify:track:${track.id}`] }),
    });
    if (!res.ok) failed.current(`Spotify would not play the record (${res.status})`);
  }, [prepare, token]);

  const pause = useCallback(async () => { await player.current?.pause(); }, []);
  const resume = useCallback(async () => { await player.current?.resume(); }, []);
  const seek = useCallback(async (ms: number) => { await player.current?.seek(Math.max(0, Math.round(ms))); }, []);
  const setVolume = useCallback((v: number) => { void player.current?.setVolume(Math.max(0, Math.min(1, v))); }, []);

  const host = useRef<HTMLDivElement>(null);
  return useMemo(() => ({ host, load, pause, resume, seek, setVolume, prepare, canVolume: true }), [load, pause, resume, seek, setVolume, prepare]);
}
