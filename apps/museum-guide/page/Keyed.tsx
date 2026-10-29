// Edmund, keyed out of his green screen and drawn over the camera view. His
// session's video plays in an element the visitor never sees; every new frame
// of it is keyed into the canvas. Without WebGL he shows as he is, screen and all.
import { useEffect, useRef, useState } from 'react';
import { createKeyer } from './chroma.ts';

export function Keyed({ videoRef, audioRef, label, className = '' }: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  label: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [keyed, setKeyed] = useState(true);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    let keyer: ReturnType<typeof createKeyer> = null;
    try {
      keyer = c ? createKeyer(c) : null;
    } catch (err) {
      console.warn('[keyer] no WebGL keying (%s): showing the video as it is', (err as Error).message);
    }
    // Without keying, the video itself is what the visitor sees.
    if (!keyer) { setKeyed(false); setShowing(true); return; }
    let stop = false;
    let shown = false;
    let handle = 0;
    const video = videoRef.current;
    // Every new frame of his video, where the browser says when one arrives; else every repaint.
    const frameCallback = video && 'requestVideoFrameCallback' in video;
    const tick = () => {
      if (stop) return;
      const v = videoRef.current;
      if (v && keyer.draw(v) && !shown) { shown = true; setShowing(true); }
      handle = frameCallback && v ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stop = true;
      if (frameCallback && video) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      keyer.dispose();
    };
  }, [videoRef]);

  return (
    <div className={`mr-edmund ${showing ? 'is-showing' : ''} ${className}`} role="img" aria-label={label}>
      {/* The source: playing, but not seen (display:none would stop some browsers decoding it). */}
      <video ref={videoRef} className={keyed ? 'mr-source' : 'mr-source is-plain'} playsInline muted />
      <audio ref={audioRef} autoPlay />
      <canvas ref={canvas} hidden={!keyed} />
    </div>
  );
}
