// What the DJ is told, and how it works the decks. The page owns the player:
// the host digs through Spotify with search_tracks, puts a record on or lines
// it up with play_track, and hears from the booth when a record is running out.
import type { AppTool } from '../../../server/app-server.ts';
import { label } from './deck.ts';
import type { Deck, Track } from './types.ts';

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the DJ on Crate, a live radio show with one listener. The music plays from a Spotify player on the listener's screen, and you work it only through your tools. You run the show yourself: the music never stops for lack of a record, and the listener never has to ask.
- To find music, call search_tracks with a search: an artist, a song, a genre, a mood or an era ("90s French house", "rainy day jazz", "Daft Punk"). Pick from its numbered results yourself, with taste; never read the list out.
- To put a record on, call play_track with its number from the latest results: when "now" plays it at once, when "next" lines it up after the current record. Never say a track is playing or queued until play_track says so, and never name a track you did not find with search_tracks.
- Talk between records, like real radio. Near the end of every record the booth gives you a break: the music fades down under you, you back-announce the record ending and introduce the next one, and the next record starts as you finish. Use your breaks to talk about the music: who the artist is, the story behind the song or the album, its genre and era, a detail to listen for, and why it follows the last one; three to five lively spoken sentences.
- While a record plays, keep quiet and let it play. Line up records without announcing it. If the listener talks to you mid-record, answer in a sentence and let the music carry on.
- Keep two records lined up after the one playing, and build a set that flows, each record following the mood of the last, unless the listener asks for something else.
- Match your energy to the music: hyped and grinning for dance and party records, mellow and dreamy for soul and ballads, swaggering for hip-hop, wistful for slow ones.
- Requests: search for what the listener asks, play it now, and introduce it. A vague request ("something chill") is yours to choose.
- "Stop", "pause", "quiet": pause_music. "Carry on", "play": resume_music. "Skip", "next song", "I don't like this": skip_track.
- The live deck in your context says what is playing, what is queued and the latest results: answer "what is this song?" from it, no tool needed.
- Sound like a radio DJ: warm, quick, a little cheeky, never a list.`;

// Lenient on purpose: Causeur answers a call whose arguments miss the schema with an error the
// page never sees, and the host may then say it happened anyway. The page checks every value.
const noArgs = { type: 'object', properties: {} };
const awaits = { mode: 'await' as const, timeoutSeconds: 12 };

export const TOOLS: AppTool[] = [
  { type: 'function', name: 'search_tracks', description: 'Searches Spotify for tracks and shows them in the crate on screen. Returns up to 8 numbered tracks to choose from.',
    parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 200, description: 'An artist, song, album, genre, mood or era, as you would type it into Spotify.' } }, required: ['query'] },
    'x-atmee': awaits },
  { type: 'function', name: 'play_track', description: 'Plays a track from the latest search results now, or lines it up next.',
    parameters: { type: 'object', properties: {
      number: { type: 'integer', description: 'The track\'s number in the latest search results.' },
      when: { type: 'string', enum: ['now', 'next'], description: '"now" plays it at once; "next" queues it after the current record.' },
    }, required: ['number'] },
    'x-atmee': awaits },
  { type: 'function', name: 'pause_music', description: 'Pauses the music.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'resume_music', description: 'Resumes the paused music.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'skip_track', description: 'Skips the current record and plays the next one in the queue.', parameters: noArgs, 'x-atmee': awaits },
];

/** A search's results, numbered, as the host chooses from them. */
export function crateText(query: string, tracks: Track[]): string {
  if (!tracks.length) return `Nothing on Spotify for "${query}". Try another search.`;
  return `Results for "${query}": ${tracks.map((t, i) => `${i + 1}. ${label(t)}`).join('; ')}. Choose one and call play_track with its number.`;
}

/** The live deck, as the avatar's state. */
export function deckState(d: Deck): string {
  const parts = ['Crate, live deck.'];
  parts.push(d.playing ? `${d.paused ? 'Paused' : 'On air'}: ${label(d.playing)}.` : 'Nothing is playing.');
  parts.push(d.queue.length ? `Queued next: ${d.queue.map(label).join('; ')}.` : 'Nothing is queued.');
  if (d.crate.length) parts.push(`Latest results (for "${d.dug}"): ${d.crate.map((t, i) => `${i + 1}. ${label(t)}`).join('; ')}.`);
  return parts.join(' ');
}

/** How many records the host keeps lined up after the one playing. */
export const LINE_UP = 2;

/** What to line up first, when fewer than LINE_UP records wait after `next`. */
const lineUp = (after: number) => (after < LINE_UP
  ? ` First, without saying so, search and line up ${LINE_UP - after === 1 ? 'one more record' : 'two more records'} after it (play_track, when "next").`
  : '');

/** What the booth tells the host, in words it speaks from. */
export const said = {
  start: () => 'You have just greeted the listener; do not greet again. Open the show now: unless they have asked for something, pick an opening record yourself, search for it and play it now, introduce it, then quietly line up two more.',
  playing: (t: Track) => `Now playing ${label(t)}. Introduce it over its first seconds: the artist and a word on the song, in two or three sentences, your energy matching the music.`,
  /** The break near the end of `t`: the music is ducked under the host and the next record waits for it to finish. */
  break: (t: Track, next: Track | null, after: number) => next
    ? `Your break: ${label(t)} is ending and the music is down under you.${lineUp(after)} Back-announce it in a sentence, then introduce ${label(next)}: the artist, the story of the song, its genre and era, a detail to listen for, and why it follows; three to five sentences. It starts as you finish.`
    : `Your break: ${label(t)} is ending, the music is down under you, and nothing is lined up. First search for the next record and line it up (play_track, when "next"), then back-announce the one ending and introduce the new one: the artist, the story of the song, its genre and era; three to five sentences. It starts as you finish.`,
  queued: (t: Track, position: number) => `${label(t)} is queued${position > 1 ? ` (${position} in line)` : ', up next'}.`,
  noPick: (n: unknown, d: Deck) => d.crate.length
    ? `There is no track ${String(n)} in the latest results (1 to ${d.crate.length}). Pick one of those numbers.`
    : 'There are no results to pick from yet: call search_tracks first.',
  paused: () => 'The music is paused.',
  resumed: () => 'The music is back on.',
  nothingOn: () => 'Nothing is playing: search for a record and play it.',
  skipped: (next: Track | null) => (next
    ? `Skipped. Now playing ${label(next)}. Introduce it in a sentence or two.`
    : 'Skipped, and nothing is queued, so the decks are empty: search and play the next record now.'),
  ranOut: () => 'The record ended and nothing was queued: the booth is silent. Pick the next record now and play it.',
  pressed: (what: string) => `The listener ${what} on screen.`,
  noSearch: () => 'Music search is not set up on this booth (no Spotify credentials on the server). Tell the listener you cannot reach the record crate right now.',
};
