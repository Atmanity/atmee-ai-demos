// The game as a PGN scoresheet: the "done" moment's keepsake, readable by any
// chess program (import it into Lichess to have it analysed). Built from the
// snapshot alone: the moves, who sat where, and how it ended.
import type { ChessSnapshot } from '../engine/types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** "1-0", "0-1", "1/2-1/2", or "*" for a game still going. */
export function resultToken(s: Pick<ChessSnapshot, 'result' | 'user_color'>): string {
  if (!s.result) return '*';
  if (s.result.winner === 'draw') return '1/2-1/2';
  const whiteWon = (s.result.winner === 'opponent') === (s.user_color === 'white');
  return whiteWon ? '1-0' : '0-1';
}

const TERMINATION: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  insufficient_material: 'Insufficient material',
  threefold_repetition: 'Threefold repetition',
  fifty_moves: 'Fifty-move rule',
  resignation: 'Resignation',
};

const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Movetext wrapped at 80 columns, as the PGN export format asks. */
function wrap(tokens: string[]): string {
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > 80) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function pgnOf(s: ChessSnapshot, opts: { host: string; date?: Date }): string {
  const date = opts.date ?? new Date();
  const white = s.user_color === 'white' ? 'You' : opts.host;
  const black = s.user_color === 'white' ? opts.host : 'You';
  const result = resultToken(s);
  const tags: [string, string][] = [
    ['Event', 'Kibitz casual game'],
    ['Site', 'Kibitz'],
    ['Date', `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`],
    ['Round', '-'],
    ['White', white],
    ['Black', black],
    ['Result', result],
  ];
  if (s.opening) tags.push(['Opening', s.opening]);
  if (s.result) tags.push(['Termination', TERMINATION[s.result.reason] ?? s.result.reason]);
  const tokens: string[] = [];
  s.history.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);
  });
  tokens.push(result);
  return `${tags.map(([k, v]) => `[${k} "${quote(v)}"]`).join('\n')}\n\n${wrap(tokens)}\n`;
}

export const pgnFileName = (date: Date = new Date()) => `kibitz-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pgn`;

/** Hands the viewer the scoresheet as a file. */
export function downloadPgn(s: ChessSnapshot, host: string): void {
  const date = new Date();
  const url = URL.createObjectURL(new Blob([pgnOf(s, { host, date })], { type: 'application/x-chess-pgn' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = pgnFileName(date);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
