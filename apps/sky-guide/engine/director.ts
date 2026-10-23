// What the host is told, and how it acts. The chart decides everything (what
// is up, where, when it rises); the host is the guide standing next to you.
// It reaches the chart only through its tools: every star it points out,
// figure it draws and move of the place or the clock comes back as a tool
// result it speaks from, so its first reply carries the chart's real answer.
//
// The one hard rule of the original survives intact: every fact about a star
// comes from the catalogue, now handed over in point_out's result and in the
// state's line about the marked star.
import type { AppTool } from '../../../server/app-server.ts';
import { CONSTELLATION_NAMES, FIGURES } from './catalog.ts';
import type { SkyView } from './types.ts';
import { figureAnchor, movement, risenAndGone, whereInSky } from './words.ts';

export const STATE_LIMIT = 3858;

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the stargazing guide in Lodestar, standing outside with one person beside a chart of the sky from the place and hour they choose. The chart is the app's: it works out what is up, where, and when things rise, from a catalogue of 135 naked-eye stars and 18 constellation figures. You reach it only through its tools.
- A star by name, "that bright one", or "tell me about Sirius": call point_out with the star as they said it, before saying anything about it, and answer only from the result.
- A constellation ("show me Orion", "where's the Plough?"): call show_constellation.
- Another place or another time ("the sky from Lisbon", "I'm in Sydney", "at midnight", "two hours later", "in December", "back to tonight"): call move_chart with their words; place and time together in one call when they ask for both.
- "Clear it", "hide the lines", "start over": call clear_chart, and only then.
- The chart changes only when you call a tool. Saying "let's look at midnight" or "there's Orion" without the call changes nothing and misleads them: call the tool every time, even when you think you know the answer. Never say whether something is up, where it is or when it rises before the result tells you.
- Questions about what is on the chart now (what's up, what's in the south, the brightest, the place, the hour, the marked star): answer from the live chart in your context, no tool needed. A star the chart does not list as up is below the horizon now.
- When the user moves the chart with its own controls, the app tells you what changed; carry on from that. You cannot see the screen.
FACTS, THE HARD RULE: everything you say about a particular star comes from a point_out result or the live chart's "fact about" line. You do not know distances, masses, temperatures or ages from memory: a remembered number is indistinguishable from an invented one. Say a fact in your own words but never change a number in it.
- The chart is stars only: no Sun, Moon or planets. Say so cheerfully if asked; it is a limit, not a failure.
- When a result says the chart refused something, say the reason plainly in one line and never claim the change happened.
- A result may say what you could offer next (the clock at an hour when something is up); offer it, and call the tool only if they say yes.
Speak like a person outside at night: ordinary directions (low in the south-east, high up, almost straight overhead), never degrees, magnitudes or coordinates. Say numbers as a person would: "eight and a half light years", "about half past two". The chart is one held instant; the clock moves only when someone moves it. One or two short spoken sentences, under 30 words, no lists.`;

const awaits = (seconds: number) => ({ mode: 'await' as const, timeoutSeconds: seconds });

/** The chart's tools. Each is answered by the page, which runs the chart. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'point_out',
    description: 'Marks a star on the user\'s chart and returns where it is and what the catalogue says about it, or why it cannot (below the horizon now, with when it rises; not in the catalogue). Call it whenever they ask where a star is, ask about a star by name, or say "that bright one", before you say anything about the star.',
    parameters: { type: 'object', properties: { star: { type: 'string', minLength: 1, maxLength: 60, description: 'The star as they said it: "Vega", "the north star", "that bright one".' } }, required: ['star'], additionalProperties: false },
    'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'show_constellation',
    description: 'Draws a constellation\'s figure on the chart and returns where to look for it, or why it cannot (not up at this hour, with when it rises; no figure for it). Call it when they ask to see or find a constellation: "show me Orion", "where\'s the Plough?", "the Southern Cross".',
    parameters: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60, description: 'The constellation as they said it: "Orion", "the Big Dipper", "Scorpio".' } }, required: ['name'], additionalProperties: false },
    'x-atmee': awaits(10),
  },
  {
    type: 'function', name: 'move_chart',
    description: 'Moves the chart to another place, another time, or both, and returns what is up then and what rose or set. Call it whenever they ask for the sky from somewhere else or at another hour or date: "the sky from Lisbon", "I\'m in Sydney", "at midnight", "two hours later", "in December", "back to tonight". Pass their words.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', maxLength: 80, description: 'A city, "the equator", or coordinates as they said them ("40.7 north 74 west"). Leave out to keep the place.' },
        time: { type: 'string', maxLength: 80, description: 'The time as they said it: "midnight", "3 am", "two hours later", "December 21st", "tonight". Leave out to keep the time.' },
      },
      additionalProperties: false,
    },
    'x-atmee': awaits(15),
  },
  {
    type: 'function', name: 'clear_chart',
    description: 'Removes the marked star, the drawn constellation, or both, from the chart. Only when the user asks to clear, hide or start over.',
    parameters: { type: 'object', properties: { what: { type: 'string', enum: ['star', 'constellation', 'everything'], description: 'What to clear; everything if they did not say.' } }, additionalProperties: false },
    'x-atmee': { mode: 'notify' },
  },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (names: string[]) => names.join(', ');
const quote = (lines: string[]) => `"${lines.join(' ')}"`;

/** Between about 7 in the morning and 5 in the afternoon on the place's clock. */
export const isDaytime = (view: SkyView) => view.night.hours < 17 || view.night.hours >= 31;

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
 * The live chart as the host's state: a plain-sentence description of what is
 * on the user's screen, so questions about it are answered without a tool.
 * Names and directions only, never coordinates (a model reads "alt 34.2, az
 * 128.5" back out as "high in the north-east" about as often as not).
 *
 * It must fit in 3,858 characters. Today's catalogue needs well under that
 * (every place, every hour, the longest fact; tested); if it ever grows past
 * the limit, the rise times go first, then the directions, and it still fits.
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
    `Lodestar, the live chart on their screen (ground truth; the clock is held, it does not tick). The sky from ${s.where.label}, at ${view.spokenWhen} (${s.when.label}, ${clock}).${isDaytime(view) ? ' It is daytime there; the chart leaves out the Sun.' : ''}`,
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

  const lit = s.figure;
  if (lit) {
    const anchor = figureAnchor(s, lit);
    parts.push(`Drawn on the chart: ${lit.name}${anchor ? `, ${whereInSky(anchor)} (by ${anchor.name})` : ''}.`);
  }
  const marked = s.selected ? s.visible.find((v) => v.id === s.selected) : null;
  if (marked && s.fact) {
    // Verbatim: this is the one place, besides point_out, the host may get the
    // marked star's fact from, so a paraphrase here is a paraphrase everywhere.
    parts.push(`Marked on the chart: ${marked.name}, ${whereInSky(marked)}. Fact about ${s.fact.title} (the catalogue's words; the only thing you know about it; never change a number): ${quote(s.fact.lines)}`);
  } else {
    parts.push(`No star is marked.`);
  }
  return parts.join(' ');
}

/** The chart at its new place or hour, with what rose and set: the original
 *  look_from and look_at_time cues. */
function skyNow(before: SkyView, after: SkyView, who: 'tool' | 'user'): string {
  const s = after.snapshot;
  const { risen, gone } = risenAndGone(before.snapshot, s);
  const moved = before.snapshot.where.label !== s.where.label;
  const brightest = s.visible.slice(0, 3).map((v) => v.name);
  const where = moved ? `the sky from ${s.where.label} at ${after.spokenWhen}` : `${after.spokenWhen} over ${s.where.label}`;
  const lead = who === 'tool' ? `The chart now shows ${where}` : `The user moved the chart to ${where}`;
  return `${lead} (${s.when.label}), with ${s.visible.length} stars up${brightest.length ? `; the brightest are ${list(brightest)}` : ''}. ${movement(risen, gone)}`;
}

const figureList = () => Object.keys(FIGURES).map((con) => CONSTELLATION_NAMES[con] ?? con).join(', ');

/** What a tool call did, in words the host speaks from. Short facts, then how
 *  to say them; never a request to act on its own initiative. */
export const said = {
  /** The opening, once the host is in the call (it greets as itself first). */
  opening(view: SkyView): string {
    const s = view.snapshot;
    const brightest = s.visible.slice(0, 3).map((v) => v.name);
    return `Lodestar is open on their screen: the sky from ${s.where.label} at ${view.spokenWhen}, with ${s.visible.length} stars up${brightest.length ? `, the brightest ${list(brightest)}` : ''}. Welcome them in one short, warm line: say which place and roughly what hour the chart shows, and invite them to ask about a star, a constellation, another place or another hour. Under 30 words.`;
  },

  marked(view: SkyView, brightest: boolean): string {
    const s = view.snapshot;
    const star = s.visible.find((v) => v.id === s.selected);
    const title = s.fact?.title ?? star?.name ?? 'The star';
    return `${brightest ? `The brightest star up now is ${title}; it is` : `${title} is`} marked on the chart, ${whereInSky(star)}. The catalogue says (the only thing you know about it): ${quote(s.fact?.lines ?? [])} Tell them where to look and one thing from that, in your own words, changing no number. Under 30 words.`;
  },

  /** A known star that is not up. Its catalogue lines still answer "tell me about it". */
  starDown(reason: string, lines: string[] | null, later: string | null): string {
    return `Not marked: ${reason}${lines?.length ? ` The catalogue says: ${quote(lines)}` : ''} Tell them plainly it is not up now${later ? `; it is well up ${later}, so offer to show the sky then, and move the clock only if they ask` : ''}. Under 30 words.`;
  },

  unknownStar(reason: string, brightest: string | null): string {
    return `Not marked: ${reason} Say so in one short line in your own voice, and say nothing about that star from memory${brightest ? `; you could offer the brightest star up now, ${brightest}` : ''}.`;
  },

  notAStar(words: string, brightest: string | null): string {
    return `"${words}" is not on the chart: it carries stars only, no Sun, Moon or planets. Say so cheerfully in one line${brightest ? `, and offer the brightest star up now, ${brightest}` : ''}. Do not say where it is.`;
  },

  drawn(view: SkyView): string {
    const s = view.snapshot;
    // Where it is has to come from the chart: a direction is the one thing the
    // user can check by standing outside.
    const anchor = figureAnchor(s, s.figure);
    const where = anchor ? ` Its brightest star on the chart is ${anchor.name}, ${whereInSky(anchor)}.` : '';
    return `${s.figure?.name ?? 'The figure'} is drawn on the chart now.${where} Tell them where to look for it and what shape to look for, using that direction and no other. Under 25 words.`;
  },

  figureDown(reason: string, later: string | null): string {
    return `Not drawn: ${reason} Say that plainly in one line${later ? `; it is well up ${later}, so offer to show the sky then, and move the clock only if they ask` : ''}. Under 30 words.`;
  },

  noFigure(reason: string): string {
    return `Not drawn: ${reason} Say so in one short line and describe nothing from memory. The figures this chart can draw: ${figureList()}.`;
  },

  /** A move of the place, the clock or both: the chart's new sky. */
  moved(before: SkyView, after: SkyView): string {
    return `${skyNow(before, after, 'tool')} Say one short line about that sky, naming only stars given here; do not list them all or read the date out.`;
  },

  unchanged(view: SkyView): string {
    return `The chart already shows that: the sky from ${view.snapshot.where.label} at ${view.spokenWhen}. Say so in a few words.`;
  },

  daytime(view: SkyView): string {
    return `It is daytime there (${view.spokenWhen}); the chart leaves out the Sun. Mention it, and offer tonight's sky instead; move the clock only if they ask.`;
  },

  refused(reason: string): string {
    const r = reason.trim();
    return `The chart refused: ${cap(r)}${/[.!?]$/.test(r) ? '' : '.'} Say that in one short line, in your own voice, and do not claim it happened.`;
  },

  unreadTime(words: string): string {
    return `"${words}" is not a time the chart can read, so the clock did not move. Ask them for an hour, "midnight", "two hours later" or a date.`;
  },

  nothingToMove(): string {
    return `No place or time was given, so nothing moved. Ask them where or when they would like to look.`;
  },

  noName(what: 'star' | 'constellation'): string {
    return `No ${what} was named, so nothing changed. Ask them which ${what} they mean.`;
  },

  cleared(what: 'star' | 'constellation' | 'everything'): string {
    const gone = what === 'star' ? 'no star is marked' : what === 'constellation' ? 'no constellation is drawn' : 'no star is marked and no constellation is drawn';
    return `Cleared: ${gone}. Acknowledge it in a few words.`;
  },
};

/** A change made with the chart's own controls, told to the host (it cannot
 *  see the screen). Coalesced by the narrator, so a drag is one line. */
export const told = {
  tapped(view: SkyView): string {
    const s = view.snapshot;
    const star = s.visible.find((v) => v.id === s.selected);
    return `The user tapped ${s.fact?.title ?? 'a star'} on the chart; it is ${whereInSky(star)}. The catalogue says: ${quote(s.fact?.lines ?? [])} Say one short line about it from that only, changing no number. Under 25 words.`;
  },

  figure(view: SkyView): string {
    const s = view.snapshot;
    const anchor = figureAnchor(s, s.figure);
    const where = anchor ? ` Its brightest star is ${anchor.name}, ${whereInSky(anchor)}.` : '';
    return `The user lit ${s.figure?.name ?? 'a figure'} on the chart.${where} Say one short line about where to look and the shape, using that direction only. Under 25 words.`;
  },

  placeMoved(before: SkyView, after: SkyView): string {
    return `${skyNow(before, after, 'user')} Say one short line about that sky, naming only stars given here. Do not list every star.`;
  },

  timeMoved(before: SkyView, after: SkyView): string {
    return `${skyNow(before, after, 'user')} Say one short line about that, naming only those stars. Do not read the date out.`;
  },

  refused(what: string, reason: string): string {
    return `The user ${what} on the chart, and it refused: ${reason} Say that to them in one short line; nothing changed.`;
  },
};

/** A figure's name for the chart's buttons and the host, by abbreviation. */
export const figureName = (con: string) => CONSTELLATION_NAMES[con] ?? con;
