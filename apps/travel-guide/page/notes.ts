// What the trip gathered, kept on the page as the board shows it: the dishes
// and headlines each country showed, and every sight looked at. The board
// itself keeps only the current place's sights; the notes keep them all, for
// the trip summary and the notes to take away.
import type { Dish, Headline, Snapshot } from '../engine/types.ts';

export interface SightNote { place: string; name: string; category: string; distance: string; mapsUrl: string; summary: string }
export interface TripNotes {
  /** Per country, what was shown there. */
  countries: Record<string, { dishes: Dish[]; headlines: Headline[] }>;
  sights: SightNote[];
}

export const emptyNotes = (): TripNotes => ({ countries: {}, sights: [] });

/** The notes with whatever this snapshot shows added; the same object when it adds nothing. */
export function notesFrom(notes: TripNotes, s: Snapshot): TripNotes {
  let next = notes;
  const country = s.map?.country;
  if (country) {
    const had = notes.countries[country];
    const entry = {
      dishes: s.food?.shown && s.food.country === country && s.food.dishes.length ? s.food.dishes : had?.dishes ?? [],
      headlines: s.news?.shown && s.news.country === country && s.news.headlines.length ? s.news.headlines : had?.headlines ?? [],
    };
    if (!had || JSON.stringify(had) !== JSON.stringify(entry)) next = { ...next, countries: { ...next.countries, [country]: entry } };
  }
  const spot = s.spot?.spot;
  if (spot && s.spot) {
    const seen = next.sights.findIndex((x) => x.name === spot.name && x.place === s.spot!.place);
    const note: SightNote = { place: s.spot.place, name: spot.name, category: spot.category, distance: spot.distance, mapsUrl: spot.mapsUrl, summary: spot.summary };
    if (seen < 0) next = { ...next, sights: [...next.sights, note] };
    else if (JSON.stringify(next.sights[seen]) !== JSON.stringify(note)) next = { ...next, sights: next.sights.map((x, i) => (i === seen ? note : x)) };
  }
  return next;
}

/** How many things the trip holds: stops on the route and sights looked at. */
export const tripSize = (s: Snapshot | null, notes: TripNotes) => (s?.trip.visited.length ?? 0) + notes.sights.length;

/** The sights looked at, grouped by the place they were around, in the order first seen. */
export function sightsByPlace(notes: TripNotes): [string, SightNote[]][] {
  const groups = new Map<string, SightNote[]>();
  for (const sight of notes.sights) groups.set(sight.place, [...(groups.get(sight.place) ?? []), sight]);
  return [...groups];
}

/** The trip as plain text, to download and keep. */
export function tripText(s: Snapshot | null, notes: TripNotes, host: string, when: Date): string {
  const name = s?.travelerName;
  const date = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [`${name ? `${name}'s trip` : 'Your trip'}, from Yonder`, `Dreamt up with ${host} on ${date}`, ''];
  const stops = s?.trip.visited ?? [];
  if (stops.length) {
    lines.push('THE ROUTE');
    stops.forEach((stop, i) => {
      lines.push(`${i + 1}. ${stop.country}${stop.city ? `, ${stop.city}` : ''}`);
      const kept = notes.countries[stop.country];
      for (const dish of kept?.dishes ?? []) lines.push(`   Eat: ${dish.name}${dish.description ? `. ${dish.description}` : ''}`);
      if (!kept?.dishes.length && stop.dishes.length) lines.push(`   Eat: ${stop.dishes.join(', ')}`);
      for (const h of kept?.headlines ?? []) lines.push(`   In the news: ${h.title}${h.url ? ` (${h.url})` : ''}`);
    });
    lines.push('');
  }
  for (const [place, sights] of sightsByPlace(notes)) {
    lines.push(`AROUND ${place.toUpperCase()}`);
    for (const sight of sights) {
      lines.push(`- ${sight.name} (${sight.category}${sight.distance ? `, ${sight.distance}` : ''})`);
      if (sight.summary) lines.push(`  ${sight.summary}`);
      if (sight.mapsUrl) lines.push(`  ${sight.mapsUrl}`);
    }
    lines.push('');
  }
  if (!stops.length && !notes.sights.length) lines.push('Nothing on this trip yet.', '');
  lines.push('Maps and places: OpenStreetMap contributors. Photos and facts: Wikipedia.');
  return lines.join('\n');
}
