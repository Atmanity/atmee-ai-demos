// What the avatar is told, and when. The chart decides everything (what is
// up, where, when it rises); the avatar is the guide standing next to you.
//
// Condensed from the original `persona.py`, `summary.py` and the tool cues.
// The one hard rule survives intact: every fact about a star comes from the
// catalogue. Because the avatar answers a spoken question before the app has
// heard it, the answers to the predictable questions are staged in advance:
// the catalogue's facts in the notes (static), and in the state everything
// that is up now, where to look for it, and which figures are down and when
// they rise. "Show me Orion" then gets the chart's answer, not the model's.
import { CONSTELLATION_NAMES, FACTS, STARS } from './catalog.ts';
import { figureAnchor, movement, risenAndGone, whereInSky } from './words.ts';
import type { SkyView } from './types.ts';

export const NOTE_LIMIT = 2000;
export const STATE_LIMIT = 3858;

const RULES = [
  `You are an astronomy guide standing outside with someone, showing them tonight's sky on the chart beside you. Keep whatever name and background you already have: the sky is the job, not your identity. Plain-spoken, unhurried, delighted by the sky and slightly allergic to jargon. Give ordinary directions (low in the south-east, high up, almost straight overhead), never degrees or coordinates; never say a magnitude or a right ascension out loud. You do not do the Sun, the Moon or the planets: the chart is stars only. Say so cheerfully if asked; it is a limit, not a failure. Speak only what you say aloud: no lists, labels or stage directions. One short sentence by default, two when a fact needs room, under 30 words. Say numbers as a person would: "eight and a half light years", "about half past two". The chart is one held instant, not a live feed: the clock moves only when the user moves it.`,
  `The app runs the chart, and its state is ground truth for where you are, what the clock reads and what is up. If the state does not list a star as up, it is below the horizon now: never call something visible because it usually is at this time of year. The user moves the place and the clock, marks stars and lights constellations with the chart's controls or by asking; you cannot move the chart yourself. You do not know the sky from another place or at another hour until the app tells you: when they ask for one, say only a few words like "let's have a look" and stop; the app tells you what changed a moment later. If it already has, carry on from it. When they ask where a star or a constellation is, answer only from the state (where to look, or that it is not up now); the app marks it on the chart. When the app says the chart refused something, say the reason plainly in one short line and offer an alternative. Never confirm a change that was refused: they are looking straight at the chart.`,
];

const FACT_RULE = `FACTS ABOUT STARS, THE ONE HARD RULE. Everything you say about a particular star comes from the catalogue lines in these notes, or from the state's "fact about" line. You do NOT know distances, masses, temperatures or spectral types from memory: a remembered number is indistinguishable from an invented one. If a star has no lines here, say only what the state says about it, and offer one you do have lines for. Say a fact in your own words but never change a number in it.`;

/** The catalogue's facts as notes: static, so they are sent once and the avatar
 *  can answer "tell me about Vega" at once, from the catalogue's own words. */
function factNotes(): string[] {
  const entries = Object.entries(FACTS).map(([id, lines]) => `${STARS.find((s) => s.id === id)!.name}: ${lines.join(' ')}`);
  const notes: string[] = [];
  let current = `${FACT_RULE}\nCatalogue lines (1):`;
  for (const entry of entries) {
    if (current.length + entry.length + 3 > NOTE_LIMIT) {
      notes.push(current);
      current = `Catalogue lines, continued (${notes.length + 1}); the same rule applies:`;
    }
    current += `\n${entry}`;
  }
  notes.push(current);
  return notes;
}

/** Standing context, sent once per session (each at most 2,000 characters). */
export const NOTES: readonly string[] = [...RULES, ...factNotes()];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (names: string[]) => names.join(', ');

/** Every star that is up, grouped by where to look, brightest group first. */
function starsByDirection(view: SkyView): string {
  const groups = new Map<string, string[]>();
  for (const star of view.snapshot.visible) {
    const where = whereInSky(star);
    groups.set(where, [...(groups.get(where) ?? []), star.name]);
  }
  return [...groups].map(([where, names]) => `${cap(where)}: ${list(names)}.`).join(' ');
}

/**
 * The live chart as the avatar's state: a plain-sentence description of what is
 * on the user's screen, and everything the guide may need to answer at once.
 * Names and directions only, never coordinates (a model reads "alt 34.2, az
 * 128.5" back out as "high in the north-east" about as often as not).
 *
 * It must fit in 3,858 characters. Today's catalogue needs at most about
 * 3,550 (every place, every hour, the longest fact); if it ever grows past the
 * limit, the rise times go first, then the directions, and the guarantee holds.
 */
export function skyState(view: SkyView): string {
  for (const detail of [2, 1, 0] as const) {
    const text = composeState(view, detail);
    if (text.length <= STATE_LIMIT) return text;
  }
  return composeState(view, 0).slice(0, STATE_LIMIT);
}

/** detail 2: everything; 1: no rise times; 0: names without directions. */
function composeState(view: SkyView, detail: 0 | 1 | 2): string {
  const { snapshot: s, figures } = view;
  const clock = view.solarTime ? 'local solar time' : 'local time';
  const parts = [
    `Sky guide, the live chart (ground truth; the clock is held, it does not tick). The sky from ${s.where.label}, at ${view.spokenWhen} (${s.when.label}, ${clock}).`,
  ];
  if (!s.visible.length) {
    parts.push(`No catalogue star is above the horizon.`);
  } else {
    parts.push(`${s.visible.length} of the catalogue's ${s.catalog_size} stars are up; the brightest are ${list(s.visible.slice(0, 6).map((v) => v.name))}.`);
    parts.push(detail > 0
      ? `Every star that is up, by where to look (any other star is below the horizon now): ${starsByDirection(view)}`
      : `Every star that is up (any other star is below the horizon now): ${list(s.visible.map((v) => v.name))}.`);
  }
  const up = figures.filter((f) => f.up);
  const down = figures.filter((f) => !f.up);
  if (up.length) parts.push(`Constellation figures up, with where to look: ${up.map((f) => `${f.name} ${whereInSky(f.anchor)} (by ${f.anchor!.name})`).join('; ')}.`);
  if (down.length) parts.push(`Figures not up now: ${down.map((f) => (f.rise && detail > 1 ? `${f.name} (${f.rise})` : f.name)).join('; ')}.`);
  parts.push(`Answer "where is" and "show me" from these lists only; the app marks or draws it.`);

  const lit = s.figure;
  if (lit) {
    const anchor = figureAnchor(s, lit);
    parts.push(`Lit on the chart: ${lit.name}${anchor ? `, ${whereInSky(anchor)} (by ${anchor.name})` : ''}.`);
  }
  const marked = s.selected ? s.visible.find((v) => v.id === s.selected) : null;
  if (marked && s.fact) {
    // Verbatim: this is the one place the avatar may get the marked star's
    // fact from, so a paraphrase here is a paraphrase everywhere.
    parts.push(`Marked on the chart: ${marked.name}, ${whereInSky(marked)}. Fact about ${s.fact.title} (the catalogue's words; the only thing you know about it; never change a number): "${s.fact.lines.join(' ')}"`);
  } else {
    parts.push(`No star is marked.`);
  }
  return parts.join(' ');
}

/** Event texts, one per outcome: instructions about facts, spoken in the
 *  avatar's own words once it has the floor. */
export const say = {
  /** The opening, once the chart is ready (the avatar greets as itself first). */
  start(view: SkyView): string {
    const s = view.snapshot;
    const brightest = s.visible.slice(0, 3).map((v) => v.name);
    return `The sky chart is open beside them: the sky from ${s.where.label} at ${view.spokenWhen}, with ${s.visible.length} stars up${brightest.length ? `, the brightest ${list(brightest)}` : ''}. In one short, warm line, say which place and roughly what hour the chart is showing, and invite them to tap a star or ask what is up. Under 30 words.`;
  },

  /** A star tapped on the chart (the narrator's line, ported). */
  tapped(view: SkyView): string {
    const s = view.snapshot;
    const star = s.visible.find((v) => v.id === s.selected);
    return `They just tapped ${s.fact?.title ?? 'a star'} on the chart, ${whereInSky(star)}. Say one short line about it using ONLY this, without changing any number in it — "${(s.fact?.lines ?? []).join(' ')}" Under 25 words.`;
  },

  /** A star asked for by name (the original point_out cue). */
  pointed(view: SkyView): string {
    const s = view.snapshot;
    const star = s.visible.find((v) => v.id === s.selected);
    return `${s.fact?.title ?? 'A star'} is marked on the chart, ${whereInSky(star)}. Say where to look and ONE thing about it, using only this and changing no number in it — "${(s.fact?.lines ?? []).join(' ')}" Under 30 words.`;
  },

  /** A figure lit (the original show_constellation cue, with its direction). */
  figure(view: SkyView): string {
    const s = view.snapshot;
    // Where it is has to come from the chart: a direction is the one thing the
    // user can check by standing outside.
    const anchor = figureAnchor(s, s.figure);
    const where = anchor ? `Its brightest star on the chart is ${anchor.name}, ${whereInSky(anchor)}. ` : '';
    return `${s.figure?.name ?? 'The figure'} is drawn on the chart now. ${where}Say one short line about where to look for it and what shape to look for, using that direction and no other. Under 25 words.`;
  },

  /** The observer moved (the original look_from cue, with what rose and set). */
  placeMoved(before: SkyView, after: SkyView): string {
    const s = after.snapshot;
    const { risen, gone } = risenAndGone(before.snapshot, s);
    const names = list(s.visible.slice(0, 3).map((v) => v.name));
    // The same instant, re-labelled: Taipei at 8 pm is Lisbon at noon, so the
    // place's own clock is part of the news.
    const clock = before.snapshot.when.epoch !== s.when.epoch ? `, at ${after.spokenWhen} there` : ` (the same instant: ${after.spokenWhen} there)`;
    return `The chart is now over ${s.where.label}${clock}, with ${s.visible.length} stars up — the brightest are ${names || 'none'}. ${movement(risen, gone)} Say one short line about that sky, naming only stars given here. Do not list every star.`;
  },

  /** The clock moved (the original look_at_time cue: the risen/gone diff, so the
   *  model is told what changed instead of being asked). */
  timeMoved(before: SkyView, after: SkyView): string {
    const s = after.snapshot;
    const { risen, gone } = risenAndGone(before.snapshot, s);
    return `The chart now shows ${after.spokenWhen} (${s.when.label}), with ${s.visible.length} stars up. ${movement(risen, gone)} Say one short line about that, naming only those stars. Do not read the date out.`;
  },

  /** A move that left the chart as it was (a typed "back to tonight" at tonight). */
  unchanged(view: SkyView): string {
    return `They asked to move the chart, but it already shows that: ${view.snapshot.where.label} at ${view.spokenWhen}. Say so in a few words.`;
  },

  /** The chart refused: the sentence it gave, to be said out loud. */
  refused(reason: string): string {
    const r = reason.trim();
    return `The chart refused that: ${cap(r)}${/[.!?]$/.test(r) ? '' : '.'} Say that to them in one short line, in your own voice, and do not claim anything happened.`;
  },
};

/** Several outcomes of one request, as one event. */
export function combine(parts: string[]): string | null {
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts.join(' ')} Keep it all to two short lines.`;
}

/** A figure's name for the chart's buttons and the state, by abbreviation. */
export const figureName = (con: string) => CONSTELLATION_NAMES[con] ?? con;
