// What Edmund is told: his tools and their rules, the tour's state, and the
// texts for what happens on the visitor's screen (a label scanned, a work
// found by the camera). Every fact he gives about a work comes from its
// catalogue record, handed to him here; his own eyes (the visitor's camera,
// which he sees as he answers) are for pointing, never for facts.
import type { AppTool } from '../../../server/app-server.ts';
import { EXHIBITS, recordText, type Exhibit } from './catalogue.ts';

export const INSTRUCTIONS = `You are guiding one visitor through the Meridian on their phone. They hold the phone up as they walk, so you see what their camera sees when you answer, and they talk to you out loud, usually on earbuds.

The museum app tells you which work they are at: when they scan the QR code on a label, or when the camera recognises a work. It then gives you that work's catalogue record.

- Every fact about a work (who, when, what, where, any story) comes from its catalogue record, never from memory. If the record does not say, you are not sure, and you say so.
- What you see in the camera image is for pointing ("look at her hands", "see the tiny mountain in the hollow of the wave"), not for facts.
- When they ask what something is, or they point at something and the app has not told you what it is, call identify_exhibit first and speak from its result.
- When they ask about another work, where something is, or you suggest what to see next, call show_exhibit with its title, so its card is on their screen.
- Tool results begin with their outcome. Follow it: if a work was not identified, say so honestly and offer to try again or to scan its label.
- Keep each turn to two to four short spoken sentences. No lists, no stage directions, no reading out the record.`;

export const TOOLS: AppTool[] = [
  {
    type: 'function',
    name: 'identify_exhibit',
    description: 'Look through the visitor\'s camera right now and find which work in the Meridian\'s catalogue it shows. Returns that work\'s catalogue record, or says it is not one of the museum\'s works. Call it whenever the visitor asks what they are looking at and the app has not told you.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'What the visitor asked, in their words (optional).' } },
    },
    'x-atmee': { mode: 'await', timeoutSeconds: 20 },
  },
  {
    type: 'function',
    name: 'show_exhibit',
    description: 'Put a work\'s card on the visitor\'s screen and get its catalogue record: for a work they ask about that is not in front of them, where to find something, or the work you suggest next.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: 'The work\'s title or what the visitor called it, e.g. "the Mona Lisa", "Vermeer\'s girl".' } },
      required: ['title'],
    },
    'x-atmee': { mode: 'await', timeoutSeconds: 8 },
  },
];

export type ToolName = 'identify_exhibit' | 'show_exhibit';
export const isToolName = (name: string): name is ToolName => TOOLS.some((t) => t.name === name);

/** The museum's floor plan, in one line per room. */
export const floorPlan = () => {
  const rooms = new Map<string, string[]>();
  for (const e of EXHIBITS) rooms.set(e.gallery, [...(rooms.get(e.gallery) ?? []), `"${e.title}" (${e.artist})`]);
  return [...rooms].map(([room, works]) => `${room}: ${works.join(', ')}`).join('\n');
};

/** What is true on the visitor's screen now (the session's state). */
export function tourState(at: { current: Exhibit | null; seen: Exhibit[]; camera: boolean }): string {
  return [
    at.camera ? 'The visitor\'s camera is on: you see what they point it at.' : 'The visitor\'s camera is off: you cannot see anything.',
    at.current ? `They are at: "${at.current.title}". Its catalogue record:\n${recordText(at.current)}` : 'They are not at any work yet.',
    at.seen.length ? `Seen so far: ${at.seen.map((e) => `"${e.title}"`).join(', ')}.` : 'They have not seen any work yet.',
    `The Meridian's rooms:\n${floorPlan()}`,
  ].join('\n\n');
}

/** How the app came to know where the visitor is. */
export type Found = 'label' | 'camera' | 'link';

/** The event when the visitor arrives at a work by themselves (a label scanned, a link opened). */
export function arrived(e: Exhibit, how: Found, again: boolean): string {
  const by = how === 'label' ? 'just scanned the label of' : how === 'link' ? 'opened the tour at' : 'is pointing the camera at';
  return again
    ? `The visitor ${by} "${e.title}" again. Ask what they would like to know about it, in one sentence.`
    : `The visitor ${by} "${e.title}" by ${e.artist}. Tell them about it from its catalogue record, which is in your state now, and point out one thing to look for. Two to four spoken sentences.`;
}

export const said = {
  /**
   * The opening, once Edmund is in the room. He greets the visitor on his own
   * as he arrives (live, the greeting came first and an opening that also
   * asked for a welcome made him welcome them twice), so this only adds what
   * the greeting cannot know.
   */
  opening: (current: Exhibit | null) => current
    ? `Without greeting again: the visitor began the tour standing at "${current.title}". Tell them about it from its catalogue record.`
    : 'Without greeting again: in one sentence, tell the visitor how the tour works: point the camera at any work, or at the QR code on its label, and ask you anything.',
  identified: (e: Exhibit) => `Identified: "${e.title}" by ${e.artist}. Its card is on the visitor's screen. Catalogue record:\n${recordText(e)}`,
  notInCatalogue: (seen: string) => `Not identified: the camera shows ${seen || 'something'}, which is not one of the Meridian's works. Say so; you may say what you see, but give no facts about it. Offer to try again closer, or to scan the label.`,
  unclear: (seen: string) => `Not identified: the picture is not clear enough to tell${seen ? ` (it looks like ${seen})` : ''}. Ask the visitor to hold the phone steady, closer to the work, and try again; or to scan the QR code on the label.`,
  noCamera: 'Not identified: the visitor\'s camera is not showing anything. Ask them to turn it on and point it at the work, or to scan the label.',
  failed: 'Not identified: the museum\'s recognition is not answering right now. Ask the visitor to scan the QR code on the label instead.',
  shown: (e: Exhibit) => `Shown: the card for "${e.title}" is on the visitor's screen. It is in ${e.gallery}. Catalogue record:\n${recordText(e)}`,
  notFound: (title: string) => `Not found: the Meridian has no work called "${title}". Its works are: ${EXHIBITS.map((e) => `"${e.title}"`).join(', ')}. Say so, and offer one of them.`,
};
