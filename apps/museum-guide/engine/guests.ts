// Guests: a work's own figure, come to life to talk with the visitor. Edmund
// hands the visitor over to the guest's own session and stays on the line,
// muted and out of sight, so the visitor can call him back at once.
//
// Only figures who are not real, identifiable people: an anonymous model in
// a character study, an anonymous figure painted from behind. A real person
// (an artist, a named sitter) would need a likeness the portrait tools are
// not for.
import type { AppTool } from '../../../server/app-server.ts';
import { exhibitById, recordText, type Exhibit } from './catalogue.ts';
import { localize } from './catalogue.i18n.ts';
import type { Lang } from './lang.ts';

export interface Guest {
  id: string;
  /** The work they come from. */
  exhibit: string;
  /** How they are named in a sentence: "the girl". */
  name: string;
  /** On a button: "Meet the girl". */
  meet: string;
  /** Who they are, for Edmund's introduction and the info page. */
  who: string;
  avatarId: string;
  /** On screen, by language: who is talking, and the button that brings them. */
  labels: Record<Lang, { name: string; meet: string }>;
}

export const GUESTS: Guest[] = [
  {
    id: 'girl', exhibit: 'pearl-earring', name: 'the girl', meet: 'Meet the girl',
    who: 'the girl from the painting herself, an anonymous model nobody has ever named',
    avatarId: 'cb84bed4-c6df-4cae-8bf8-42e5cbcdb71b',
    labels: { en: { name: 'The girl', meet: 'Meet the girl' }, 'zh-TW': { name: '畫中少女', meet: '和畫中少女說話' }, ja: { name: '絵の少女', meet: '絵の少女と話す' } },
  },
  {
    id: 'wanderer', exhibit: 'wanderer', name: 'the wanderer', meet: 'Meet the wanderer',
    who: 'the wanderer himself, who has stood with his back to every visitor for two centuries and has turned around',
    avatarId: '2e7275e6-b307-490b-b02e-8d2613293648',
    labels: { en: { name: 'The wanderer', meet: 'Meet the wanderer' }, 'zh-TW': { name: '畫中旅人', meet: '和畫中旅人說話' }, ja: { name: '絵の旅人', meet: '絵の旅人と話す' } },
  },
];

export const guestById = (id: string | null | undefined) => GUESTS.find((g) => g.id === id) ?? null;
export const guestFor = (exhibit: Exhibit | null | undefined) => (exhibit ? GUESTS.find((g) => g.exhibit === exhibit.id) ?? null : null);

export const GUEST_INSTRUCTIONS = `You are a figure from a painting in the Meridian museum, come to life to talk with one visitor on their phone. Edmund Hale, the chairman, handed the visitor over to you; you see what their camera sees as you answer, and they talk to you out loud.

- Speak in the first person as the figure in the painting, in two or three short spoken sentences per turn.
- Every fact about the painting (dates, the artist, materials, research, where the original hangs) comes from its catalogue record in your state, never from memory. If the record does not say, you do not know.
- You are not a real, named person: never give yourself a name or a life story with dates.
- When the visitor asks for Edmund, wants to see another work, or says goodbye, call call_host_back and say one short farewell.
- The visitor's screen changes only when you call a tool: never say Edmund is back before you have called it.`;

export const GUEST_TOOLS: AppTool[] = [
  {
    type: 'function',
    name: 'call_host_back',
    description: 'Bring Edmund, the chairman, back to guide the visitor: when they ask for him, ask about another work, or say goodbye to you.',
    parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Why, in a few words (optional).' } } },
    'x-atmee': { mode: 'notify' },
  },
];

/** What a guest is told by the page (results and events). */
export const guestSaid = {
  /** call_host_back's result. */
  calledBack: 'Called back: Edmund is coming back. Say one short goodbye.',
  visitorAsked: 'The visitor asked for Edmund. Say one short, warm goodbye; he is coming back.',
  movedOn: (title: string) => `The visitor has moved on to "${title}". Say in one sentence that Edmund will tell them about it, and call call_host_back.`,
  /** The safety net called Edmund back for the guest. */
  netCalledBack: 'You did not call call_host_back, so the app called Edmund back for the visitor just now. Say one short goodbye.',
};

/** What a guest knows: who they are, and their painting's record (in the visitor's language). */
export function guestState(guest: Guest, lang: Lang = 'en'): string {
  const e = localize(exhibitById(guest.exhibit)!, lang);
  return [
    `You are ${guest.name} from "${e.title}" by ${e.artist}. The visitor is standing at your painting.`,
    `Its catalogue record:\n${recordText(e)}`,
    'Edmund, the chairman, comes back whenever the visitor asks: call call_host_back.',
  ].join('\n\n');
}
