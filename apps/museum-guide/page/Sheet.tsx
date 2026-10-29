// The gallery labels (?sheet): every work with its label's QR code, for a
// screen or a printer, so the tour can be tried anywhere. Point the phone at
// a code (the tour scans it) or at a picture (ask "What is this?").
import qrcode from 'qrcode-generator';
import { EXHIBITS } from '../engine/catalogue.ts';
import { labelUrl, TOUR_PATH } from '../engine/labels.ts';
import { exhibitImage } from './images.ts';
import { Wordmark } from './Lobby.tsx';

function Qr({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return <img className="mr-qr" src={qr.createDataURL(4, 2)} alt={label} />;
}

export function Sheet() {
  const tour = `${location.origin}${TOUR_PATH}`;
  return (
    <div className="mr-sheet">
      <header className="mr-sheet-top">
        <Wordmark />
        <div className="mr-sheet-intro">
          <h1>Gallery labels</h1>
          <p>Open the tour on your phone (scan this code), begin it, then point the phone at a label's code, or at a painting and ask Edmund what it is.</p>
        </div>
        <Qr text={tour} label="Open the tour on your phone" />
      </header>
      <ol className="mr-labels">
        {EXHIBITS.map((e) => (
          <li key={e.id}>
            <img className="mr-work" src={exhibitImage(e)} alt={`${e.title}, ${e.artist}`} />
            <div className="mr-label">
              <div>
                <p className="mr-card-where">{e.gallery}</p>
                <h2>{e.title}</h2>
                <p>{e.artist}<br />{e.date}<br /><i>{e.medium}</i></p>
              </div>
              <Qr text={labelUrl(location.origin, e.id)} label={`Label code for ${e.title}`} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
