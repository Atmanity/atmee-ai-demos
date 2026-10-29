// The catalogue in the tour's other languages (translations/<lang>.json): every
// field a visitor reads or a guide is told, with the same facts and each work's
// established title in that language. `looks` (for matching a photo), `aka`
// and `next` stay English.
import { addLocalNames, EXHIBITS, type Exhibit } from './catalogue.ts';
import type { Lang } from './lang.ts';
import { TRANSLATIONS } from './translations.ts';

// show_exhibit finds a work by the title Edmund says, in any language.
for (const tr of Object.values(TRANSLATIONS)) {
  for (const [id, w] of Object.entries(tr.works)) addLocalNames(id, [w.title, w.artist]);
}

/** A work in a language: its own record for English, the translated fields otherwise. */
export function localize(e: Exhibit, lang: Lang): Exhibit {
  return lang === 'en' ? e : { ...e, ...TRANSLATIONS[lang].works[e.id] };
}

/** Every work has its fields in every language (for tests). */
export const translatedIds = (lang: Exclude<Lang, 'en'>) => Object.keys(TRANSLATIONS[lang].works).sort();
export const allIds = () => EXHIBITS.map((e) => e.id).sort();

const EN_ROOMS: Record<number, string[]> = { 1: ['Renaissance'], 2: ['Dutch Golden Age'], 3: ['Romantic and Modern'], 4: ['Japanese', 'prints'] };

/** A floor-plan room's name, as one or two lines. */
export const roomName = (lang: Lang, n: number): string[] => (lang === 'en' ? EN_ROOMS[n] : TRANSLATIONS[lang].rooms[String(n)]);

/** A work's short label under its pin on the floor plan (null: the plan's English one). */
export const pinLabel = (lang: Lang, id: string): string | null => (lang === 'en' ? null : TRANSLATIONS[lang].pins[id]);
