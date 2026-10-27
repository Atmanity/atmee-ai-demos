// The Supply window as a place: a concrete wall of steel shelving and bins, a
// caged hatch, a hanging work lamp, and the counter in front. Hester comes
// through the wall monitor, her picture laid onto its angled glass, so the
// call sits in the room instead of beside it. Decoration only: drawn in SVG,
// hidden from assistive technology.

const BINS = [0, 1, 2, 3, 4, 5];
const SHELF_YS = [70, 170, 270, 370];

function Shelving({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="0" y="40" width="10" height="440" fill="#3b4440" />
      <rect x="290" y="40" width="10" height="440" fill="#3b4440" />
      {SHELF_YS.map((y) => (
        <g key={y}>
          <rect x="0" y={y + 78} width="300" height="8" fill="#4a5550" />
          {BINS.map((b) => (
            <g key={b} transform={`translate(${16 + b * 46} ${y + 34})`}>
              <path d="M0 44 L4 0 H38 L42 44 Z" fill={(b + y / 100) % 3 < 1 ? '#5b5f4a' : (b + y / 100) % 3 < 2 ? '#4c5651' : '#62503c'} />
              <rect x="10" y="14" width="22" height="9" fill="#d9cfae" opacity=".55" />
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

export function SceneBackdrop() {
  return (
    <svg className="rq-backdrop" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="rq-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b201e" />
          <stop offset=".55" stopColor="#2a312d" />
          <stop offset="1" stopColor="#1a1e1c" />
        </linearGradient>
        <radialGradient id="rq-lamp" cx=".5" cy="0" r=".75">
          <stop offset="0" stopColor="#f2b24c" stopOpacity=".55" />
          <stop offset=".45" stopColor="#c9822a" stopOpacity=".16" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id="rq-concrete" width="120" height="60" patternUnits="userSpaceOnUse">
          <rect width="120" height="60" fill="none" stroke="#000" strokeOpacity=".22" strokeWidth="2" />
          <circle cx="30" cy="20" r="1.2" fill="#000" opacity=".25" />
          <circle cx="88" cy="41" r="1" fill="#000" opacity=".25" />
        </pattern>
        <pattern id="rq-cage" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="18" height="18" fill="none" stroke="#6b766f" strokeWidth="1.6" />
        </pattern>
      </defs>
      <rect width="1200" height="600" fill="url(#rq-wall)" />
      <rect width="1200" height="600" fill="url(#rq-concrete)" />
      {/* pipes along the ceiling */}
      <rect x="0" y="14" width="1200" height="12" fill="#3d4642" />
      <rect x="0" y="32" width="1200" height="6" fill="#33403a" />
      {[140, 520, 900].map((x) => <rect key={x} x={x} y="10" width="16" height="32" fill="#56605a" />)}
      <Shelving x={20} />
      <Shelving x={880} />
      {/* the caged hatch behind the monitor */}
      <rect x="380" y="70" width="440" height="330" fill="#121614" />
      <rect x="380" y="70" width="440" height="330" fill="url(#rq-cage)" opacity=".7" />
      <rect x="372" y="62" width="456" height="346" fill="none" stroke="#56605a" strokeWidth="14" />
      <text x="600" y="54" textAnchor="middle" fill="#e3a33c" fontSize="26" letterSpacing="6" fontFamily="Big Shoulders Stencil Display, Impact, sans-serif" fontWeight="800">SUPPLY</text>
      {/* the hanging lamp and its light */}
      <line x1="600" y1="0" x2="600" y2="18" stroke="#111" strokeWidth="3" />
      <rect width="1200" height="600" fill="url(#rq-lamp)" />
      {/* the counter */}
      <rect x="0" y="470" width="1200" height="130" fill="#3a332a" />
      <rect x="0" y="462" width="1200" height="14" fill="#5a4e3d" />
      <rect x="0" y="476" width="1200" height="4" fill="#000" opacity=".4" />
    </svg>
  );
}
