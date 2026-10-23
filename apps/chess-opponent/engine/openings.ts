// Opening recognition, by move-order fingerprint. Ported from openings.py /
// openings.ts, which were two copies of one table: the label under the board
// and the name in the avatar's mouth must be one fact, so here there is one
// copy, on the snapshot, read by both the panel and the director.
//
// Fingerprints are matched as a PREFIX of the played history, longest wins,
// because several share their first moves.

export interface OpeningFingerprint {
  name: string;
  moves: string[];
}

export const OPENINGS: OpeningFingerprint[] = [
  { name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { name: 'Ruy López', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { name: 'Petrov Defence', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { name: "King's Gambit", moves: ['e4', 'e5', 'f4'] },
  { name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'] },
  { name: 'Open Game', moves: ['e4', 'e5'] },
  { name: 'Sicilian Defence', moves: ['e4', 'c5'] },
  { name: 'French Defence', moves: ['e4', 'e6'] },
  { name: 'Caro-Kann Defence', moves: ['e4', 'c6'] },
  { name: 'Scandinavian Defence', moves: ['e4', 'd5'] },
  { name: 'Pirc Defence', moves: ['e4', 'd6'] },
  { name: "Alekhine's Defence", moves: ['e4', 'Nf6'] },
  { name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { name: 'Slav Defence', moves: ['d4', 'd5', 'c4', 'c6'] },
  { name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { name: "King's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { name: 'Nimzo-Indian Defence', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { name: 'Indian Defence', moves: ['d4', 'Nf6'] },
  { name: 'Dutch Defence', moves: ['d4', 'f5'] },
  { name: 'English Opening', moves: ['c4'] },
  { name: 'Réti Opening', moves: ['Nf3'] },
];

/** The name of the longest fingerprint that prefixes this history, or null. */
export function detectOpening(history: readonly string[] | null | undefined): string | null {
  const played = (history ?? []).map(String);
  let best: OpeningFingerprint | null = null;
  for (const opening of OPENINGS) {
    if (opening.moves.length > played.length) continue;
    if (opening.moves.some((san, index) => played[index] !== san)) continue;
    if (!best || opening.moves.length > best.moves.length) best = opening;
  }
  return best?.name ?? null;
}
