// The host's tools, answered. The host passes the words it heard ("the north
// star", "Lisbon", "two hours later"); the rules over the catalogue's own names
// turn them into intents (a model only when the rules cannot place a name);
// the chart validates and moves; and the result is the chart's real answer in
// words the host speaks from. One run for a tool call and for the safety net.
//
// Everything here is the chart's: whether a star is up, where, when it rises,
// what rose and set. The host is told, never asked.
import { factFor, FIGURES, findConstellation, findStar } from './catalog.ts';
import { BRIGHTEST_WORDS, type SkyChart } from './chart.ts';
import { isDaytime, said } from './director.ts';
import { apply } from './guide.ts';
import { normalize, parse, PLANETS } from './judge.ts';
import { whenUp } from './later.ts';
import { seenFigure, seenStar, type NightEntry } from './night.ts';
import { findPlace, PLACE_LABELS, spokenHour } from './sky.ts';
import type { Intent, SkyView } from './types.ts';

export const TOOL_NAMES = ['point_out', 'show_constellation', 'move_chart', 'clear_chart'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

/** What the chart says on screen after a refusal, when the thing is worth a
 *  look (for "Show the sky at 3:15 am"), and what to show then. */
export interface Notice { text: string; later: number | null; retry?: Intent }

export interface ToolRun {
  view: SkyView;
  /** What the host speaks from. */
  result: string;
  /** A refusal to show on the chart, or null. */
  notice: Notice | null;
  /** What was marked or drawn, for the night's list. */
  seen: NightEntry[];
}

export interface RunOptions {
  /** The real time now (unix seconds). */
  now?: number;
  /** A model's reading of words the rules could not place, or null without one. */
  interpret?: (text: string) => Promise<Intent[] | null>;
}

const WORDS_LIMIT = 120;
/** The first of these arguments the host filled, as plain words. The schemas
 *  are lenient (a call that does not fit them never reaches the page), so the
 *  app normalises: any case, stray whitespace, a near-miss of the field name. */
const wordsOf = (args: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ').slice(0, WORDS_LIMIT);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
};

/** Run one of the host's tools on the chart. Throws for a name that is not a tool. */
export async function runTool(chart: SkyChart, name: string, args: Record<string, unknown>, opts: RunOptions = {}): Promise<ToolRun> {
  const now = opts.now ?? Date.now() / 1000;
  switch (name) {
    case 'point_out': return look(chart, wordsOf(args, 'star', 'name', 'star_name'), 'select', opts, now);
    case 'show_constellation': return look(chart, wordsOf(args, 'name', 'constellation', 'figure'), 'show_constellation', opts, now);
    case 'move_chart': return move(chart, wordsOf(args, 'place', 'city', 'location'), wordsOf(args, 'time', 'when', 'date', 'hour'), opts, now);
    case 'clear_chart': return clear(chart, wordsOf(args, 'what', 'target'), now);
  }
  throw new Error(`there is no tool called ${name}`);
}

const nothing = (chart: SkyChart, result: string): ToolRun => ({ view: chart.view(), result, notice: null, seen: [] });
const brightestUp = (chart: SkyChart) => chart.brightestVisible()?.name ?? null;
/** "by about quarter past 3 in the morning", for a result. */
const laterWords = (chart: SkyChart, epoch: number | null) => (epoch === null ? null : `by ${spokenHour(epoch, chart.tz)}`);

type Looking = 'select' | 'show_constellation';

/** Stars and figures in what the rules (or a model) found; the asked-for kind
 *  first, and the other when only that was named ("point out Orion"). */
function pick(intents: Intent[], prefer: Looking): Intent[] {
  const own = intents.filter((i) => i.kind === prefer);
  return own.length ? own : intents.filter((i) => i.kind === 'select' || i.kind === 'show_constellation');
}

/** point_out and show_constellation: one star or one figure, by the words heard. */
async function look(chart: SkyChart, words: string, prefer: Looking, opts: RunOptions, now: number): Promise<ToolRun> {
  if (!words) return nothing(chart, said.noName(prefer === 'select' ? 'star' : 'constellation'));
  if (PLANETS.test(normalize(words))) return nothing(chart, said.notAStar(words, brightestUp(chart)));
  let intents = pick(parse(`show me ${words}`, { lon: chart.lon })?.intents ?? [], prefer);
  if (!intents.length && opts.interpret) intents = pick((await opts.interpret(`show me ${words}`)) ?? [], prefer);
  // Nothing the rules know: the chart refuses it by name, out loud.
  const intent: Intent = intents[0] ?? (prefer === 'select' ? { kind: 'select', star: words } : { kind: 'show_constellation', name: words });

  const out = apply(chart, [intent], { now });
  const reason = out.refusals[0];
  if (intent.kind === 'select') {
    if (!reason) return { view: out.view, result: said.marked(out.view, BRIGHTEST_WORDS.includes(intent.star.trim().toLowerCase())), notice: null, seen: [seenStar(out.view)].filter((e): e is NightEntry => e !== null) };
    const star = findStar(intent.star);
    if (!star) return { view: out.view, result: BRIGHTEST_WORDS.includes(intent.star.trim().toLowerCase()) ? said.refused(reason) : said.unknownStar(reason, brightestUp(chart)), notice: { text: reason, later: null }, seen: [] };
    const later = whenUp(chart, intent);
    return { view: out.view, result: said.starDown(reason, factFor(star.id)?.lines ?? null, laterWords(chart, later)), notice: { text: reason, later, retry: intent }, seen: [] };
  }
  if (intent.kind === 'show_constellation') {
    if (!reason) return { view: out.view, result: said.drawn(out.view), notice: null, seen: [seenFigure(out.view)].filter((e): e is NightEntry => e !== null) };
    const con = findConstellation(intent.name);
    if (!con || !FIGURES[con]) return { view: out.view, result: said.noFigure(reason), notice: { text: reason, later: null }, seen: [] };
    const later = whenUp(chart, intent);
    return { view: out.view, result: said.figureDown(reason, laterWords(chart, later)), notice: { text: reason, later, retry: intent }, seen: [] };
  }
  return nothing(chart, said.refused(reason ?? 'that is not a star or a constellation'));
}

const COORDINATE_PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*$/;

/** A place as heard: a listed city, "the equator", coordinates however said;
 *  else a model's reading; else the words, which the chart refuses by name. */
async function placeIntents(words: string, chart: SkyChart, opts: RunOptions): Promise<Intent[]> {
  const pair = COORDINATE_PAIR.exec(words);
  if (pair) return [{ kind: 'set_place', lat: Number(pair[1]), lon: Number(pair[2]) }];
  const parsed = parse(`the sky from ${words}`, { lon: chart.lon });
  const found = (parsed?.intents ?? []).filter((i) => i.kind === 'set_place');
  if (found.length) return found.slice(0, 1);
  if (opts.interpret) {
    const model = ((await opts.interpret(`the sky from ${words}`)) ?? []).filter((i) => i.kind === 'set_place');
    if (model.length) return model.slice(0, 1);
  }
  return [{ kind: 'set_place', label: words }];
}

const BACK_TO_TONIGHT = /^(?:back to )?(?:now|right now|tonight|this evening|the present|the start|reset|reset the clock)$/;

/** A time as heard: a preset, a clock hour, a shift, a date, a month or a
 *  season; else a model's reading; else nothing (the clock stays). */
async function timeIntents(words: string, opts: RunOptions): Promise<Intent[]> {
  const t = normalize(words);
  if (/^\d{4}-\d{2}-\d{2}$/.test(words.trim())) return [{ kind: 'set_time', date: words.trim() }];
  const hhmm = /^(?:at )?([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (hhmm) return [{ kind: 'set_time', clockHour: Number(hhmm[1]) + Number(hhmm[2]) / 60 }];
  if (BACK_TO_TONIGHT.test(t)) return [{ kind: 'set_time', preset: 'tonight' }];
  if (/^(?:at )?(?:noon|midday)$/.test(t)) return [{ kind: 'set_time', clockHour: 12 }];
  // A bare hour, read as a night-sky app reads one: 6 to 11 are the evening, 1 to 5 the small hours.
  const bare = /^(?:at )?(\d{1,2})$/.exec(t);
  if (bare && Number(bare[1]) <= 23) {
    const h = Number(bare[1]);
    return [{ kind: 'set_time', clockHour: h === 12 ? 0 : h >= 6 && h <= 11 ? h + 12 : h }];
  }
  for (const text of [words, `show me ${words}`, `in ${words}`]) {
    const found = (parse(text)?.intents ?? []).filter((i) => i.kind === 'set_time');
    if (found.length) return found;
  }
  if (opts.interpret) return ((await opts.interpret(`show me the sky at ${words}`)) ?? []).filter((i) => i.kind === 'set_time');
  return [];
}

/** move_chart: the place first (its clock decides what "midnight" means), then the time. */
async function move(chart: SkyChart, place: string, time: string, opts: RunOptions, now: number): Promise<ToolRun> {
  if (!place && !time) return nothing(chart, said.nothingToMove());
  const intents: Intent[] = place ? await placeIntents(place, chart, opts) : [];
  const times = time ? await timeIntents(time, opts) : [];
  intents.push(...times);
  const unread = time && !times.length ? said.unreadTime(time) : null;
  if (!intents.length) return nothing(chart, unread ?? said.nothingToMove());

  const out = apply(chart, intents, { now });
  const parts: string[] = [];
  const moved = out.before.snapshot.where.label !== out.view.snapshot.where.label || out.before.snapshot.when.epoch !== out.view.snapshot.when.epoch;
  if (moved) {
    parts.push(said.moved(out.before, out.view));
    if (isDaytime(out.view)) parts.push(said.daytime(out.view));
  } else if (out.accepted.length) {
    parts.push(said.unchanged(out.view));
  }
  // A city the chart does not have is answered with the cities it does.
  const unknown = intents.find((i): i is Extract<Intent, { kind: 'set_place' }> => i.kind === 'set_place' && Boolean(i.label) && !findPlace(i.label));
  for (const reason of out.refusals) parts.push(unknown && reason.includes(unknown.label!) ? said.unknownPlace(unknown.label!, [...PLACE_LABELS]) : said.refused(reason));
  if (unread) parts.push(unread);
  const notice = out.refusals.length || unread ? { text: [...out.refusals, ...(unread ? [`I couldn't read "${time}" as a time.`] : [])].join(' '), later: null } : null;
  return { view: out.view, result: parts.join(' '), notice, seen: [] };
}

const CLEAR_WORDS: [RegExp, 'star' | 'constellation' | 'everything'][] = [
  [/^(?:|all|both|everything|it all|the chart|chart|the lot|all of it|reset|start over)$/, 'everything'],
  [/^(?:the )?(?:star|selection|selected star|marked star|mark|marker|highlight)s?$/, 'star'],
  [/^(?:the )?(?:constellation|figure|lines|shape|outline|drawing|constellation lines)s?$/, 'constellation'],
];

/** clear_chart: safe to repeat, so the safety net may do it too. */
function clear(chart: SkyChart, what: string, now: number): ToolRun {
  const t = normalize(what);
  const which = CLEAR_WORDS.find(([words]) => words.test(t))?.[1];
  if (!which) return nothing(chart, said.clearWhat(what));
  const intents: Intent[] = which === 'star' ? [{ kind: 'clear_selection' }] : which === 'constellation' ? [{ kind: 'clear_figure' }] : [{ kind: 'clear_selection' }, { kind: 'clear_figure' }];
  const out = apply(chart, intents, { now });
  return { view: out.view, result: said.cleared(which), notice: null, seen: [] };
}
