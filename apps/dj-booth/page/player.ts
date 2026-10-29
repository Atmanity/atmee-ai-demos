// Spotify's embed, driven from the page through its iFrame API. It plays a
// 30-second preview unless the listener is signed in to Spotify in this browser.
import { useCallback, useMemo, useRef } from 'react';
import type { Track } from '../engine/types.ts';

import type { Playback } from '../engine/booth.ts';

export type { Playback };

/** What the booth plays through: the embed (previews, no volume) or the Web Playback SDK (sdk-player.ts). */
export interface Player {
  /** Where the embed mounts; unused by the SDK. */
  host: React.RefObject<HTMLDivElement | null>;
  load(track: Track): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** 0 to 1; a no-op where the player has no volume. */
  setVolume(v: number): void;
  /** Ready the player within a click, where the browser lets it play sound. */
  prepare(): void;
  canVolume: boolean;
}

interface Controller {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  addListener(event: string, fn: (e: { data: any }) => void): void;
}

let api: Promise<any> | null = null;
function loadApi(): Promise<any> {
  api ??= new Promise((resolve) => {
    (window as any).onSpotifyIframeApiReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    document.body.appendChild(script);
  });
  return api;
}

const uriOf = (t: Track) => `spotify:track:${t.id}`;

export function useSpotifyPlayer(onUpdate: (p: Playback) => void): Player {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<Promise<Controller> | null>(null);
  const last = useRef<Playback | null>(null);
  const listener = useRef(onUpdate);
  listener.current = onUpdate;

  // The first record creates the embed with it loaded; later ones load into it.
  const ensure = useCallback((uri: string): [Promise<Controller>, boolean] => {
    if (controller.current) return [controller.current, false];
    controller.current = loadApi().then((IFrameAPI) => new Promise<Controller>((resolve) => {
      const el = document.createElement('div');
      host.current!.replaceChildren(el);
      IFrameAPI.createController(el, { uri, width: '100%', height: 152 }, (c: Controller) => {
        c.addListener('playback_update', (e) => { last.current = e.data; listener.current(e.data); });
        c.addListener('ready', () => resolve(c));
      });
    }));
    return [controller.current, true];
  }, []);

  const load = useCallback(async (track: Track) => {
    const uri = uriOf(track);
    const [pending, fresh] = ensure(uri);
    const c = await pending;
    last.current = null; // the previous record's playback says nothing about this one
    if (!fresh) c.loadUri(uri);
    // play() right after loadUri is sometimes dropped by the embed: try again once if it never started.
    setTimeout(() => c.play(), fresh ? 0 : 400);
    setTimeout(() => { if (!last.current || (last.current.isPaused && last.current.position === 0)) c.play(); }, 2500);
  }, [ensure]);

  const pause = useCallback(async () => { (await controller.current)?.pause(); }, []);
  const resume = useCallback(async () => { (await controller.current)?.resume(); }, []);

  // The embed has no volume: the music plays at the listener's system level.
  return useMemo(() => ({ host, load, pause, resume, setVolume: () => {}, prepare: () => {}, canVolume: false }), [load, pause, resume]);
}
