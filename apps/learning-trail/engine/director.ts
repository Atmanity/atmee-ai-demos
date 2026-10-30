// What Mochi is told, and how Mochi acts. The trail decides; Mochi performs:
// every change on the child's screen comes from a tool, and the results carry
// the facts Mochi speaks from.
import type { AppTool } from '../../../server/app-server.ts';
import { CLAIMS, cleared, finished, LAYERS, PUMPS, ROCKS, STOPS, type Trail } from './trail.ts';

/** Mochi's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Mochi, a small red panda explorer, walking one child aged six to ten along the Volcano Trail. A trail map, a big scene and a sticker backpack are on their screen. You reach them only through the trail's tools.
- The screen changes only when you call a tool, so call one for every action, even when you think you know what will happen. Nothing happened unless a result said so.
- Rumble Peak: when the child says to pump, push, add gas or make it erupt, call pump_volcano once. Each call is one pump.
- The Big Dig: when the child names a layer of the Earth, or says add one, call add_layer with the name they said.
- Silly Bridge: say the claim from the live board out loud, as if you are completely sure. Then stop. When the child says it is true or silly, call judge_claim with their words. A one-word answer such as "nope" or "yes" counts.
- Rock Camp: say the clue from the live board as the rock talking. When the child names a rock, call pick_rock.
- When a result says a sticker went into the backpack, celebrate in one line and ask if they are ready to walk on. When they say yes, next, go or let's go, call walk_on.
- If the child presses a button, the trail tells you what happened: carry on from that, and do not call a tool for it.
- Questions about volcanoes: answer in one simple sentence, then go back to the game. Questions about something else: answer kindly in a few words and go back to the trail.
Talk like a friendly picture book: one or two short spoken sentences, everyday words, no lists. Be amazed by what they do. A wrong answer is never bad: laugh with them and try again. Only the Silly Bridge claims are on purpose wrong; everything else you say must be true. Never ask for their name, age, school or anything personal.`;

// Lenient on purpose: a call that misses the schema never reaches the page. The trail checks every value.
const noArgs = { type: 'object', properties: {} };
const awaits = { mode: 'await' as const, timeoutSeconds: 8 };

export const TOOLS: AppTool[] = [
  { type: 'function', name: 'pump_volcano', description: 'One pump of gas into the volcano at Rumble Peak; the last pump makes it erupt. Call it each time the child says to pump or to make it erupt.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'add_layer', description: 'Adds the next layer of the Earth at The Big Dig. Layers go inner core, outer core, mantle, crust.',
    parameters: { type: 'object', properties: { layer: { type: 'string', description: 'The layer the child named, as they said it. Leave it out if they only said add one.' } } }, 'x-atmee': awaits },
  { type: 'function', name: 'judge_claim', description: 'Records whether the child says your claim at Silly Bridge is true or silly.',
    parameters: { type: 'object', properties: { verdict: { type: 'string', description: 'What the child said, such as true, silly, nope or yes.' } }, required: ['verdict'] }, 'x-atmee': awaits },
  { type: 'function', name: 'pick_rock', description: 'Records the rock the child thinks matches the clue at Rock Camp: pumice, obsidian or basalt.',
    parameters: { type: 'object', properties: { rock: { type: 'string', description: 'The rock the child named.' } }, required: ['rock'] }, 'x-atmee': awaits },
  { type: 'function', name: 'walk_on', description: 'Walks to the next stop on the trail once this stop\'s sticker is won and the child is ready.', parameters: noArgs, 'x-atmee': awaits },
];

/** What is on the child's screen, as Mochi's state. */
export function trailState(t: Trail): string {
  if (finished(t)) return `Volcano Trail, finished. The child has all ${STOPS.length} stickers and the Junior Volcanologist badge. ${t.caught} of ${CLAIMS.length} claims judged right.`;
  const stop = STOPS[t.stop];
  const parts = [`Volcano Trail, stop ${t.stop + 1} of ${STOPS.length}: ${stop.title}. Stickers: ${t.stickers.length}. What to teach here: ${stop.teach}`];
  if (cleared(t)) parts.push('This stop is done. Next: ask if they are ready to walk on.');
  else if (stop.id === 'boom') parts.push(`Pressure ${t.pressure} of ${PUMPS}. Next: get the child to pump.`);
  else if (stop.id === 'layers') parts.push(`Layers built: ${LAYERS.slice(0, t.layers).map((l) => l.name).join(', ') || 'none'}. Next layer: ${LAYERS[t.layers].name}.`);
  else if (stop.id === 'silly') parts.push(`Claim ${t.claim + 1} of ${CLAIMS.length}, to say as if you are sure: "${CLAIMS[t.claim].line}"`);
  else parts.push(`Rock ${t.rock + 1} of ${ROCKS.length}. The clue, in the rock's voice: "${ROCKS[t.rock].clue}" Do not name the rock.`);
  return parts.join(' ');
}

/** What Mochi is told when a stop comes on screen. */
export function arrival(t: Trail, again = false): string {
  if (finished(t)) return 'The child finished the trail and the Junior Volcanologist badge is on screen. Cheer in two short sentences, then ask them to tell you one thing they learned.';
  const stop = STOPS[t.stop];
  if (stop.id === 'boom') return `${again ? 'The child wants to walk the trail again.' : 'You have just greeted them; do not greet or introduce yourself again.'} You are at ${stop.title} and the volcano is rumbling. In two short sentences, say what is inside and ask them to pump it.`;
  if (stop.id === 'layers') return `You arrived at ${stop.title}. In two short sentences, say the Earth has layers like an egg, and ask them to build it from the very middle.`;
  if (stop.id === 'silly') return `You arrived at ${stop.title}. Say you know lots of volcano facts, then say this as if you are sure: "${CLAIMS[0].line}" Then stop.`;
  return `You arrived at ${stop.title}. Say the rocks are talking, then give the first clue in the rock's voice: "${ROCKS[0].clue}" Do not name the rock.`;
}

/** The next thing to say after a move on the trail, added to its outcome for the host. */
export function followUp(t: Trail): string {
  if (finished(t) || cleared(t)) return '';
  const stop = STOPS[t.stop];
  if (stop.id === 'silly') return ` Next, say this as if you are sure: "${CLAIMS[t.claim].line}" Then stop.`;
  if (stop.id === 'rocks') return ` Next clue, in the rock's voice: "${ROCKS[t.rock].clue}"`;
  return '';
}

/** A button press, told to Mochi. */
export const pressed = (outcome: string) => `The child pressed a button. ${outcome} React in one short sentence.`;
