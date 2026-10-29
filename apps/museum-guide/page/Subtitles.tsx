// The guide's words as subtitles: the phrase he is on, its words lighting up at
// about the pace he says them (subtitles.ts), the visitor's own words under it.
import { useEffect, useRef, useState } from 'react';
import { useLang } from './i18n.ts';
import { nowSaying, unitsPerSecond } from './subtitles.ts';

const TICK_MS = 100;
/** Quiet this long and he has finished: the whole phrase is lit. */
const DONE_AFTER_MS = 700;

export function Subtitles({ text, speaking, name, heard, hint }: {
  /** His utterance so far (the kit's caption: it grows, then a new one replaces it). */
  text: string;
  speaking: boolean;
  name: string;
  /** The visitor's words as they are recognised. */
  heard: string;
  /** Shown when there is nothing to read. */
  hint: string;
}) {
  const { t } = useLang();
  const [spoken, setSpoken] = useState(0);
  const utterance = useRef('');
  const quietSince = useRef<number | null>(null);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const rate = useRef(unitsPerSecond(text));
  rate.current = unitsPerSecond(text);

  // A new utterance (not the last one growing) starts from its first word.
  if (text && !text.startsWith(utterance.current.slice(0, 16))) {
    utterance.current = text;
    if (spoken !== 0) setSpoken(0);
  } else if (text) {
    utterance.current = text;
  }

  useEffect(() => {
    const id = setInterval(() => {
      if (speakingRef.current) {
        quietSince.current = null;
        setSpoken((n) => n + (rate.current * TICK_MS) / 1000);
        return;
      }
      quietSince.current ??= Date.now();
      if (Date.now() - quietSince.current > DONE_AFTER_MS) setSpoken((n) => (n === Infinity ? n : Infinity));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const now = nowSaying(text, spoken);
  return (
    <div className="mr-subs">
      {now ? (
        <>
          <p className="mr-subs-who">{name}</p>
          {/* The whole phrase for screen readers at once; the lighting is for eyes. */}
          <p className="mr-subs-said" key={now.phrase.first} aria-label={now.phrase.words.join(now.phrase.spaced ? ' ' : '')}>
            {now.phrase.words.map((word, i) => <span key={i} className={i < now.said ? 'is-said' : ''} aria-hidden="true">{now.phrase.spaced ? `${word} ` : word}</span>)}
          </p>
        </>
      ) : hint && !heard && <p className="mr-subs-hint">{hint}</p>}
      {heard && <p className="mr-subs-you" aria-live="polite"><b>{t('you')}:</b> {heard}</p>}
    </div>
  );
}
