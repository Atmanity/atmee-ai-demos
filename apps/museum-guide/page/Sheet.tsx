// The gallery labels (?sheet): every work with its label's QR code, for a
// screen or a printer, so the tour can be tried anywhere. Point the phone at
// a code (the tour scans it) or at a picture (ask "What is this?").
// A work opens to fill the window, as a work on a wall would fill the phone's
// view; what shows with it (the painting alone, with its label, or only the
// code) is one choice for the whole sheet, so the camera can be tried on each.
import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EXHIBITS, type Exhibit } from '../engine/catalogue.ts';
import { labelUrl, TOUR_PATH } from '../engine/labels.ts';
import { exhibitImage } from './images.ts';
import { Wordmark } from './Lobby.tsx';

type Show = 'work' | 'label' | 'code';
const SHOWS: [Show, string][] = [['work', 'Painting'], ['label', 'With label'], ['code', 'Code only']];
const SHOW_KEY = 'meridian-sheet-show';

function Qr({ text, label, className = 'mr-qr' }: { text: string; label: string; className?: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return <img className={className} src={qr.createDataURL(8, 2)} alt={label} />;
}

function Label({ exhibit }: { exhibit: Exhibit }) {
  return (
    <div className="mr-label">
      <div>
        <p className="mr-card-where">{exhibit.gallery}</p>
        <h2>{exhibit.title}</h2>
        <p>{exhibit.artist}<br />{exhibit.date}<br /><i>{exhibit.medium}</i></p>
      </div>
      <Qr text={labelUrl(location.origin, exhibit.id)} label={`Label code for ${exhibit.title}`} />
    </div>
  );
}

function useShow(): [Show, (s: Show) => void] {
  const [show, setShow] = useState<Show>(() => {
    try {
      const saved = localStorage.getItem(SHOW_KEY);
      if (saved === 'work' || saved === 'label' || saved === 'code') return saved;
    } catch { /* no storage: the default */ }
    return 'label';
  });
  const set = useCallback((s: Show) => {
    setShow(s);
    try { localStorage.setItem(SHOW_KEY, s); } catch { /* not kept */ }
  }, []);
  return [show, set];
}

function ShowPicker({ show, onShow }: { show: Show; onShow: (s: Show) => void }) {
  return (
    <div className="mr-show" role="radiogroup" aria-label="What to show">
      {SHOWS.map(([value, name], i) => (
        <button key={value} type="button" role="radio" aria-checked={show === value} className={show === value ? 'is-on' : ''}
          onClick={() => onShow(value)} title={`${name} (${i + 1})`}>{name}</button>
      ))}
    </div>
  );
}

/** One work filling the window, with the sheet's choice of what shows beside it. */
function Viewer({ index, show, onShow, onMove, onClose }: {
  index: number;
  show: Show;
  onShow: (s: Show) => void;
  onMove: (step: number) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const exhibit = EXHIBITS[index];
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      else if (e.key === 'ArrowRight') onMove(1);
      else if (e.key === 'ArrowLeft') onMove(-1);
      else if (e.key === 'f') void toggleFull();
      else if (['1', '2', '3'].includes(e.key)) onShow(SHOWS[Number(e.key) - 1][0]);
    };
    const onFull = () => setFull(Boolean(document.fullscreenElement));
    addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFull);
    return () => { removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFull); };
  });
  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, []);

  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await box.current?.requestFullscreen();
    } catch { /* not allowed here: the window view stays */ }
  };

  return (
    <div ref={box} className={`mr-viewer is-${show}`} role="dialog" aria-modal="true" aria-label={exhibit.title}>
      <div className="mr-viewer-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {show !== 'code' && <img className="mr-viewer-work" src={exhibitImage(exhibit)} alt={`${exhibit.title}, ${exhibit.artist}`} />}
        {show === 'label' && <Label exhibit={exhibit} />}
        {show === 'code' && (
          <div className="mr-viewer-code">
            <Qr text={labelUrl(location.origin, exhibit.id)} label={`Label code for ${exhibit.title}`} className="mr-qr-big" />
            <p>{exhibit.title}</p>
          </div>
        )}
      </div>
      <div className="mr-viewer-bar">
        <button type="button" className="mr-chip" onClick={() => onMove(-1)} aria-label="Previous work">‹</button>
        <span className="mr-viewer-count">{index + 1} / {EXHIBITS.length}</span>
        <button type="button" className="mr-chip" onClick={() => onMove(1)} aria-label="Next work">›</button>
        <ShowPicker show={show} onShow={onShow} />
        {document.fullscreenEnabled && (
          <button type="button" className="mr-chip" onClick={() => void toggleFull()} aria-pressed={full}>{full ? 'Exit full screen' : 'Full screen'}</button>
        )}
        <button type="button" className="mr-chip" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function Sheet() {
  const tour = `${location.origin}${TOUR_PATH}`;
  const [show, setShow] = useShow();
  const [open, setOpen] = useState<number | null>(null);
  const move = useCallback((step: number) => setOpen((i) => (i === null ? i : (i + step + EXHIBITS.length) % EXHIBITS.length)), []);
  // The page under the viewer does not scroll.
  useEffect(() => {
    document.documentElement.style.overflow = open === null ? '' : 'hidden';
    return () => { document.documentElement.style.overflow = ''; };
  }, [open]);

  return (
    <div className={`mr-sheet is-${show}`}>
      <header className="mr-sheet-top">
        <Wordmark />
        <div className="mr-sheet-intro">
          <h1>Gallery labels</h1>
          <p>Open the tour on your phone (scan this code), begin it, then point the phone at a label's code, or at a painting and ask Edmund what it is. Click a work to fill the window with it.</p>
          <ShowPicker show={show} onShow={setShow} />
        </div>
        <Qr text={tour} label="Open the tour on your phone" />
      </header>
      <ol className="mr-labels">
        {EXHIBITS.map((e, i) => (
          <li key={e.id}>
            <button type="button" className="mr-open" onClick={() => setOpen(i)} aria-label={`Open ${e.title} full window`}>
              {show !== 'code'
                ? <img className="mr-work" src={exhibitImage(e)} alt="" />
                : <span className="mr-work mr-work-code"><Qr text={labelUrl(location.origin, e.id)} label="" className="mr-qr-big" /></span>}
            </button>
            {show === 'label' ? <Label exhibit={e} /> : <p className="mr-work-name">{e.title}<span>{e.artist}</span></p>}
          </li>
        ))}
      </ol>
      {open !== null && <Viewer index={open} show={show} onShow={setShow} onMove={move} onClose={() => setOpen(null)} />}
    </div>
  );
}
