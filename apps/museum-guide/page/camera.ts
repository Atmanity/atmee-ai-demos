// The visitor's camera: the rear one on a phone. The page shows it full
// screen, reads label QR codes from it, and hands Edmund's session a copy of
// its track so he sees it too; a frame of it goes to the server when the
// visitor (or Edmund) asks what a work is.
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseLabel } from '../engine/labels.ts';
import type { Exhibit } from '../engine/catalogue.ts';

export type CameraState = 'off' | 'asking' | 'on' | 'blocked' | 'missing';

export interface Camera {
  state: CameraState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The live video track, for the session. */
  track: MediaStreamTrack | null;
  /** Opens the camera; resolves with its track, or null when it could not. */
  start(): Promise<MediaStreamTrack | null>;
  stop(): void;
}

export function useCamera(): Camera {
  const [state, setState] = useState<CameraState>('off');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    const open = streamRef.current?.getVideoTracks()[0];
    if (open && open.readyState === 'live') return open;
    setState('asking');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = s;
      setStream(s);
      setState('on');
      const track = s.getVideoTracks()[0];
      track.addEventListener('ended', () => setState('off'));
      return track;
    } catch (err) {
      setState((err as Error).name === 'NotAllowedError' ? 'blocked' : 'missing');
      return null;
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setState('off');
  }, []);

  // The preview element mounts with the tour screen, after the camera opened.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.srcObject === stream) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
  });
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return { state, videoRef, track: stream?.getVideoTracks()[0] ?? null, start, stop };
}

/** The video's current frame as a JPEG (base64, no prefix), at most `max` px on its long side; null with no frame. */
export function grabFrame(video: HTMLVideoElement | null, max = 768): string | null {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82).replace(/^data:image\/jpeg;base64,/, '');
}

/** How often the scanner looks for a label's code, and the size it looks at. */
const SCAN_MS = 300;
const SCAN_PX = 720;

/** While `active`, reads QR codes from the video; each code that is a Meridian label calls `onLabel`. */
export function useLabelScanner(video: React.RefObject<HTMLVideoElement | null>, active: boolean, onLabel: (exhibit: Exhibit) => void) {
  const onLabelRef = useRef(onLabel);
  onLabelRef.current = onLabel;
  useEffect(() => {
    if (!active) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const id = setInterval(() => {
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth || document.hidden) return;
      const scale = Math.min(1, SCAN_PX / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
      const exhibit = code ? parseLabel(code.data) : null;
      if (exhibit) onLabelRef.current(exhibit);
    }, SCAN_MS);
    return () => clearInterval(id);
  }, [video, active]);
}
