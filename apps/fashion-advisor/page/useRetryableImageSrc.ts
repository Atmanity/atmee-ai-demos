// From the original panel, unchanged: retries an image download on error by
// cache-busting the URL, for slow or flaky connections.
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_RETRIES = 3;

export function useRetryableImageSrc(src: string) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const retryCountRef = useRef(0);

  useEffect(() => {
    setResolvedSrc(src);
    retryCountRef.current = 0;
  }, [src]);

  const onError = useCallback(() => {
    if (retryCountRef.current >= MAX_RETRIES) return;
    retryCountRef.current += 1;
    const separator = src.includes('?') ? '&' : '?';
    setResolvedSrc(`${src}${separator}retry=${retryCountRef.current}&t=${Date.now()}`);
  }, [src]);

  return { src: resolvedSrc, onError, retriesExhausted: retryCountRef.current >= MAX_RETRIES };
}
