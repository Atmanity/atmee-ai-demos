// The safety net's rules: the tool call the user's words clearly ask for,
// among those safe to make twice. Live, a host sometimes narrates a move
// ("let's look at midnight!") without calling the tool, and the chart never
// moves; if no call of that tool comes within a few seconds, the page makes it
// and tells the host (the kit's useToolNet).
//
// Safe to repeat: a named place, an absolute time ("midnight", "3 am",
// "December", "back to tonight": the second call lands where the first did),
// a constellation asked for with a command, and clearing. Never a relative
// move ("two hours later" twice is four hours), and never a star: "where's
// Vega?" is often answered rightly from the live chart, and marking it after
// the answer would only make the host say it again.
import { CONSTELLATION_NAMES } from './catalog.ts';
import { normalize, parse } from './judge.ts';
import type { Intent } from './types.ts';

export interface NetCall { name: 'move_chart' | 'show_constellation' | 'clear_chart'; arguments: Record<string, string> }

/** Words that make a request a command, not a remark ("my sister lives in Paris"). */
const COMMAND = /\b(?:show|draw|light up|highlight|outline|trace|take (?:me|us)|go to|go back|move|switch|jump|change|set|what about|how about|let'?s (?:see|look|go)|can (?:i|we|you) see|look(?:ing)? (?:at|from)|sky (?:from|over|above|in|at)|stars (?:from|over|above|in)|i'?m in|i am in|we'?re in|we are in|back to|reset|clear|hide|remove|turn off|switch off|get rid of|start over|unmark|deselect)\b/;

/** A short request is a command by itself: "Lisbon", "midnight please". */
const SHORT_WORDS = 3;

const isMove = (i: Intent) => i.kind === 'set_place' || i.kind === 'set_time';
const isClear = (i: Intent) => i.kind === 'clear_selection' || i.kind === 'clear_figure';
const isRelative = (i: Intent) => i.kind === 'set_time' && i.shiftHours !== undefined;

/** The call to make if the host does not, or null. `here` is the chart's
 *  longitude, for "the equator" and the poles. */
export function mustDo(text: string, here: { lon: number } = { lon: 0 }): NetCall | null {
  const parsed = parse(text, here);
  if (!parsed || parsed.unresolved || !parsed.intents.length) return null;
  const { intents } = parsed;
  const t = normalize(text);
  const commanded = COMMAND.test(t) || t.split(' ').length <= SHORT_WORDS;
  if (!commanded) return null;

  if (intents.every(isClear)) {
    const figure = intents.some((i) => i.kind === 'clear_figure');
    const star = intents.some((i) => i.kind === 'clear_selection');
    return { name: 'clear_chart', arguments: { what: figure && star ? 'everything' : figure ? 'constellation' : 'star' } };
  }
  if (intents.every(isMove)) {
    if (intents.some(isRelative)) return null;
    const place = intents.find((i) => i.kind === 'set_place');
    const args: Record<string, string> = {};
    if (place && place.kind === 'set_place') args.place = place.label ?? `${place.lat}, ${place.lon}`;
    // The time as said: the tool reads it with the same rules.
    if (intents.some((i) => i.kind === 'set_time')) args.time = text.trim().slice(0, 80);
    return { name: 'move_chart', arguments: args };
  }
  if (intents.length === 1 && intents[0].kind === 'show_constellation' && /\b(?:show|draw|light up|highlight|outline|trace|point out)\b/.test(t)) {
    const name = intents[0].name;
    return { name: 'show_constellation', arguments: { name: CONSTELLATION_NAMES[name] ?? name } };
  }
  return null;
}
