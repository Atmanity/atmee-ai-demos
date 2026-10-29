// What the DJ is told, and how it works the decks. The page owns the player:
// the host digs through Spotify with search_tracks, puts a record on or lines
// it up with play_track, and hears from the booth when a record is running out.
import type { AppTool } from '../../../server/app-server.ts';
import { label } from './deck.ts';
import type { Deck, Track } from './types.ts';

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the DJ on Crate, a live radio show with one listener. The music plays from a Spotify player on the listener's screen, and you work it only through your tools. You run the show yourself: the music never stops for lack of a record, and the listener never has to ask.
- To find music, call search_tracks with a search: an artist, a song, a genre, a mood or an era ("90s French house", "rainy day jazz", "Daft Punk"). Pick from its numbered results yourself, with taste; never read the list out.
- To put a record on or line one up, call play_request with a precise search (the artist and the title, or a sharp mood): one call finds it and plays it ("now") or lines it up ("next"). Use search_tracks and then play_track (its number in the results) only when you want to choose among several. Make as few calls as you can: one per record. Never say a track is playing or queued until the tool says so, and never name a track no tool gave you.
- Talk between records, like real radio. Near the end of every record the booth gives you a break: the music fades down under you, you back-announce the record ending and introduce the next one, and the next record comes in under your last words. Use your breaks to talk about the music: who the artist is, the story behind the song, a detail to listen for; two or three lively spoken sentences, no more.
- You may talk over a record's first 20 seconds, as a DJ talks up to the vocal. After that keep quiet and let it play, and line up records without announcing it. If the listener talks to you, answer them whenever it is, then let the music carry on.
- Never pick a song that has already played tonight (the live deck lists them), unless the listener asks to hear it again: then play it.
- Keep ten records lined up after the one playing (line_up adds several in one call), and build a set that flows, each record following the mood of the last, unless the listener asks for something else.
- Match your energy to the music: hyped and grinning for dance and party records, mellow and dreamy for soul and ballads, swaggering for hip-hop, wistful for slow ones.
- Use when "now" only to open the show and for the listener's requests; every other record goes in line with when "next", so no record is cut off.
- Requests: when the listener asks for a song, an artist or a style, call play_request with their words at once, before you say anything about it; it finds the record and plays it. A vague request ("something chill") is play_request too, with your own search words.
- "Skip", "next song", "change the song", "I don't like this": call skip_track at once, before you say anything; never answer a skip with words alone, since only the tool changes the record. "Stop", "pause", "quiet": pause_music. "Carry on", "play": resume_music. The same rule: the tool first, then your words.
- The live deck in your context says what is playing, what is queued and the latest results: answer "what is this song?" from it, no tool needed.
- You cannot see the listener: there is no camera. Never say or imply you see them, their face, smile, room or reactions; you only hear what they say.
- Always speak English, even when the listener's words come through in another language: speech recognition over the music can mishear them.
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
  { type: 'function', name: 'play_request', description: 'Finds a record and plays it, in one step: searches Spotify and puts the best match on now (the record on fades out first) or lines it up next. For the listener\'s requests and for your own picks.',
    parameters: { type: 'object', properties: {
      query: { type: 'string', maxLength: 200, description: 'What the listener asked for, as a Spotify search: a song, an artist, a genre or a mood.' },
      when: { type: 'string', enum: ['now', 'next'], description: '"now" (default) plays it at once; "next" if they asked for it after the current record.' },
    }, required: ['query'] },
    'x-atmee': awaits },
  { type: 'function', name: 'line_up', description: 'Lines up several records at once after the current one, in one call: each search finds its best match, skipping any already on, in line or played tonight. Use it to keep the line full.',
    parameters: { type: 'object', properties: {
      records: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 }, description: 'Up to 10 searches, one per record, in the order to play them: an artist and a title, or a sharp mood.' },
    }, required: ['records'] },
    'x-atmee': awaits },
  { type: 'function', name: 'pause_music', description: 'Pauses the music.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'resume_music', description: 'Resumes the paused music.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'skip_track', description: 'Skips the current record and plays the next one in the queue.', parameters: noArgs, 'x-atmee': awaits },
];

/** A search's results, numbered, as the host chooses from them. */
export function crateText(query: string, tracks: Track[], played: (t: Track) => boolean = () => false): string {
  if (!tracks.length) return `Nothing on Spotify for "${query}". Try another search.`;
  const fresh = tracks.filter((t) => !played(t));
  return `Results for "${query}": ${tracks.map((t, i) => `${i + 1}. ${label(t)}${played(t) ? ' (played tonight)' : ''}`).join('; ')}. ${fresh.length ? 'Choose one not played tonight (unless the listener asked for one again) and call play_track with its number.' : 'All of these have played tonight: search for something else, unless the listener asked for one of them again.'}`;
}

/** The live deck, as the avatar's state. */
export function deckState(d: Deck): string {
  const parts = ['Crate, live deck.'];
  parts.push(d.playing ? `${d.paused ? 'Paused' : 'On air'}: ${label(d.playing)}.` : 'Nothing is playing.');
  parts.push(d.queue.length ? `Queued next: ${d.queue.map(label).join('; ')}.` : 'Nothing is queued.');
  if (d.played.length) parts.push(`Played tonight, never to be picked again: ${d.played.slice(-15).map(label).join('; ')}.`);
  if (d.crate.length) parts.push(`Latest results (for "${d.dug}"): ${d.crate.map((t, i) => `${i + 1}. ${label(t)}`).join('; ')}.`);
  return parts.join(' ');
}

/** How many records the host keeps lined up after the one playing. */
export const LINE_UP = 10;
/** Below this many in line, the host is asked to fill the line back up to LINE_UP. */
export const LINE_LOW = 5;

/** What to line up first, when fewer than LINE_UP records wait after `next`. */
const lineUp = (after: number) => (after < LINE_LOW
  ? ` First, without saying so, fill the line back up to ${LINE_UP} with one line_up call (${LINE_UP - after} records that follow this one).`
  : '');

/** What the booth tells the host, in words it speaks from. */
export const said = {
  start: () => 'You have just greeted the listener; do not greet again. Open the show now: unless they have asked for something, decide the style of tonight\'s set, pick one opening record for it yourself and put it on with play_request (when "now"). It waits for your opening words. Then fill the line with nine more in one line_up call, never with "now": the opener plays to its end.',
  /** The show's first record, held for the opening: the set's style, then the record. */
  opener: (t: Track) => `${label(t)} opens the show and waits for you: no music is playing yet. In one turn, first describe the style of music you will play tonight, the mood and the sound of the set, in a sentence or two; then introduce the opening record by name, saying its title "${t.title}" and its artist ${t.artist}, with a word on the song. It starts as you finish.`,
  playing: (t: Track) => `Now playing ${label(t)}. Introduce it over its first seconds: the artist and a word on the song, in two or three sentences, your energy matching the music.`,
  /** The break near the end of `t`: the music is ducked under the host and the next record waits for it to finish. */
  break: (t: Track, next: Track | null, after: number) => next
    ? `Your break: ${label(t)} is ending and the music is down under you.${lineUp(after)} Back-announce it in a sentence, then introduce ${label(next)}: the artist and the story of the song or a detail to listen for; two or three sentences. It comes in under your last words.`
    : `Your break: ${label(t)} is ending, the music is down under you, and nothing is lined up. First search for the next record and line it up (play_track, when "next"), then back-announce the one ending and introduce the new one: the artist and the story of the song; two or three sentences. It comes in under your last words.`,
  queued: (t: Track, position: number) => `${label(t)} is queued${position > 1 ? ` (${position} in line)` : ', up next'}.`,
  alreadyLined: (t: Track) => `${label(t)} is already on or in line: nothing changed. Pick a different record.`,
  alreadyPlayed: (t: Track) => `${label(t)} already played tonight: nothing changed. Pick a record that has not played yet.`,
  heldForOpener: (t: Track, position: number) => `A record is playing and you never cut one off on your own, so ${label(t)} went in line instead (${position} in line) and plays after it. If the listener asked you to change the record, call skip_track or play_request instead.`,
  noPick: (n: unknown, d: Deck) => d.crate.length
    ? `There is no track ${String(n)} in the latest results (1 to ${d.crate.length}). Pick one of those numbers.`
    : 'There are no results to pick from yet: call search_tracks first.',
  paused: () => 'The music is paused.',
  resumed: () => 'The music is back on.',
  nothingOn: () => 'Nothing is playing: search for a record and play it.',
  /** The listener (or the host) changed the record: the old one fades out, the new one waits for the host's intro. */
  /** Early in a record with the line short: fill it now, quietly, so a break never finds it empty. */
  topUp: (t: Track, queued: number) => `Not a break: ${label(t)} is playing and only ${queued || 'nothing'} ${queued === 1 ? 'record is' : 'is'} lined up. Quietly fill the line back up to ${LINE_UP}: one line_up call with ${LINE_UP - queued} searches for records that follow this one. Say nothing at all: the music is playing.`,
  linedUp: (added: Track[], missed: string[], inLine: number) =>
    `${added.length ? `Lined up: ${added.map(label).join('; ')}.` : 'Nothing new was lined up.'}${missed.length ? ` Not found, or already on, in line or played tonight: ${missed.join('; ')}.` : ''} ${inLine} in line now.`,
  /** After a change of vibe cleared the host's picks from the line. */
  newVibe: (cleared: number) => (cleared ? ` The ${cleared === 1 ? 'record' : `${cleared} records`} you had lined up ${cleared === 1 ? 'was' : 'were'} cleared for the listener's new direction: after your intro, quietly fill the line back up to ten with one line_up call, records that follow this one.` : ''),
  changeOver: (t: Track) => `The record on is fading out. Introduce ${label(t)} now: the artist and a word on the song, two or three sentences. It starts as you finish.`,
  skipped: (next: Track | null) => (next
    ? `Skipped: the record on is fading out. Introduce ${label(next)} in a sentence or two; it starts as you finish.`
    : 'Skipped, and nothing is queued, so the decks are empty: search and play the next record now.'),
  ranOut: () => 'The record ended and nothing was queued: the booth is silent. Pick the next record now and play it.',
  pressed: (what: string) => `The listener ${what} on screen.`,
  /** The listener's own hand on the decks, as a turn that cuts the host off: what it was saying no longer fits. */
  cutIn: (what: string, t: Track) => `(The listener just ${what} on screen, so ${label(t)} is coming in now. Stop what you were saying, and introduce ${label(t)} in a sentence or two: the artist and a word on the song.)`,
  chose: (what: string, t: Track) => `The listener ${what} on screen, and the record on is fading out. Introduce ${label(t)} in a sentence or two; it starts as you finish.`,
  noSearch: () => 'Music search is not set up on this booth (no Spotify credentials on the server). Tell the listener you cannot reach the record crate right now.',
};
