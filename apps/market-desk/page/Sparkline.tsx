import { useState } from 'react';

/**
 * The price line, as inline SVG (ported from the original panel unchanged).
 * Ninety points is a `<polyline>`; no chart library.
 *
 * The crosshair is VIEW STATE: which point the mouse is over is not something
 * the session would testify to, so it lives in `useState` and never leaves the page.
 */
export function Sparkline({ series, direction, width = 132, height = 40, label }: {
  series: number[];
  direction: 'up' | 'down' | 'flat';
  width?: number;
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (series.length < 2) {
    return <div className="spark spark-empty" aria-label={`${label} has no history`}>no history</div>;
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const x = (i: number) => i * step;
  const y = (value: number) => height - ((value - min) / span) * (height - 4) - 2;
  const points = series.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`);

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const ratio = (event.clientX - box.left) / box.width;
    const index = Math.round(ratio * (series.length - 1));
    setHover(Math.min(series.length - 1, Math.max(0, index)));
  };

  const hovered = hover === null ? null : series[hover];

  return (
    <div className="spark-wrap">
      <svg
        className={`spark spark-${direction}`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} price history, ${series.length} points`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <polyline className="spark-line" fill="none" strokeWidth={1.6} points={points.join(' ')} />
        {hover !== null && (
          <g className="spark-cross">
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} strokeWidth={0.8} />
            <circle cx={x(hover)} cy={y(series[hover])} r={2.2} />
          </g>
        )}
      </svg>
      {hovered !== null && <span className="spark-readout" aria-hidden="true">{hovered.toFixed(2)}</span>}
    </div>
  );
}
