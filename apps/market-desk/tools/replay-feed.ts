// Serve recorded chart payloads so the board can be driven with no market
// feed at all (ported from the original's scripts/replay-feed.py).
//
//   npx tsx apps/market-desk/tools/replay-feed.ts &
//   MARKET_DESK_CHART_URL='http://127.0.0.1:8795/chart/{symbol}' npm run dev
//
// It stands in for the FALLBACK (Yahoo, which rate-limits laptops by IP); the
// desk still asks Nasdaq first, so this only answers when Nasdaq cannot (no
// network, or Nasdaq down).
//
// **What this serves is not the market.** It is whatever was recorded into
// engine/fixtures/, replayed with its original timestamps, so prices are as old
// as the recording. Only one symbol is real; every other one is that recording
// relabelled "<SYMBOL> — replay data" with its numbers shifted, so six cards are
// not six copies of one and nobody mistakes them for a quote. A symbol with no
// recording gets Yahoo's real 404 shape when there is none at all; `?status=429`
// forces the rate-limited path.
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { round2 } from '../engine/board.ts';

export const PORT = 8795;
const FIXTURES = fileURLToPath(new URL('../engine/fixtures/', import.meta.url));

const recordings = () => readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(FIXTURES + f, 'utf8')))
  .filter((body) => body?.chart?.result?.[0]?.meta?.symbol);

/** The recorded chart for a symbol, or another recording relabelled as it, or null. */
export function payloadFor(symbol: string): any | null {
  const sym = symbol.toUpperCase();
  const all = recordings();
  const own = all.find((body) => String(body.chart.result[0].meta.symbol).toUpperCase() === sym);
  if (own) return own;
  const body = all[0];
  if (!body) return null;
  // Relabel EVERY identifying field, not just the symbol: a board where MSFT
  // was priced at Apple's close and named "Apple Inc." read as a parser bug in
  // the app rather than a borrowed recording, and sent a real review down the
  // wrong hole. A stable, visible offset per symbol, never zero.
  const result = body.chart.result[0];
  const meta = result.meta;
  meta.symbol = sym;
  meta.longName = `${sym} — replay data`;
  meta.shortName = sym;
  const digest = [...sym].reduce((sum, c, i) => sum + c.charCodeAt(0) * (i + 1), 0);
  const factor = 1 + ((digest % 2 ? 1 : -1) * (3 + (digest % 18))) / 100;
  for (const key of ['regularMarketPrice', 'chartPreviousClose', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow']) {
    if (typeof meta[key] === 'number') meta[key] = round2(meta[key] * factor);
  }
  for (const series of Object.values<unknown>(result.indicators?.quote?.[0] ?? {})) {
    if (Array.isArray(series)) series.forEach((v, i) => { if (typeof v === 'number') series[i] = round2(v * factor); });
  }
  return body;
}

function serve() {
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const send = (status: number, body: unknown) => {
      const raw = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) });
      res.end(raw);
      console.log('[replay-feed] %s %s -> %d', req.method, req.url, status);
    };
    const match = /^\/chart\/([^/]+)$/.exec(url.pathname);
    if (!match) return send(404, { error: 'use /chart/<symbol>' });
    const forced = url.searchParams.get('status');
    if (forced) return send(Number(forced), { chart: { result: null, error: { code: forced } } });
    const symbol = decodeURIComponent(match[1]);
    const payload = payloadFor(symbol);
    if (!payload) return send(404, { chart: { result: null, error: { code: 'Not Found', description: `No data found, symbol may be delisted (${symbol})` } } });
    send(200, payload);
  }).listen(PORT, '127.0.0.1', () => {
    console.log('[replay-feed] REPLAY, NOT LIVE: recordings from %s', FIXTURES);
    console.log("[replay-feed] MARKET_DESK_CHART_URL='http://127.0.0.1:%d/chart/{symbol}'", PORT);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve();
