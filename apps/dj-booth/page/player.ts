// Spotify's embed, driven from the page through its iFrame API. It plays a
// 30-second preview unless the listener is signed in to Spotify in this browser.
import { useCallback, useRef } from 'react';
import type { Track } from '../engine/types.ts';

export interface Playback { isPaused: boolean; isBuffering: boolean; position: number; duration: number }

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

export function useSpotifyPlayer(onUpdate: (p: Playback) => void) {
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

  return { host, load, pause, resume };
}
