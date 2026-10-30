// The languages a tour can be in: the ones the Atmee frontend offers. The
// platform routes speech recognition and replies for en, zh-TW and ja; for the
// others it detects the language, so they are heard as well as it can.
import { TRANSLATIONS } from './translations.ts';

export type Lang = 'en' | 'zh-TW' | 'zh-CN' | 'ja' | 'ko' | 'de' | 'vi' | 'es' | 'ru';

/** In the frontend's order, each named in its own language. */
export const LANGS: { id: Lang; name: string; english: string }[] = [
  { id: 'en', name: 'English', english: 'English' },
  { id: 'zh-TW', name: '繁體中文', english: 'Traditional Chinese' },
  { id: 'zh-CN', name: '简体中文', english: 'Simplified Chinese' },
  { id: 'ja', name: '日本語', english: 'Japanese' },
  { id: 'ko', name: '한국어', english: 'Korean' },
  { id: 'de', name: 'Deutsch', english: 'German' },
  { id: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
  { id: 'es', name: 'Español', english: 'Spanish' },
  { id: 'ru', name: 'Русский', english: 'Russian' },
];

export const isLang = (value: unknown): value is Lang => LANGS.some((l) => l.id === value);

const SPOKEN: Record<Exclude<Lang, 'en'>, string> = {
  'zh-TW': 'Traditional Chinese, as spoken in Taiwan (繁體中文)',
  'zh-CN': 'Simplified Chinese, as spoken in mainland China (简体中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  de: 'German (Deutsch)',
  vi: 'Vietnamese (Tiếng Việt)',
  es: 'Spanish (Español)',
  ru: 'Russian (Русский)',
};

/**
 * The standing note that keeps a guide in the visitor's language: the app's own
 * notes, events and tool results stay in English, the catalogue records come in
 * the visitor's language, and the names are the ones the screen uses (live, in
 * Chinese he made up 美利堅博物館, "the America museum", and called himself 主席).
 * Null for English.
 */
export function languageRule(lang: Lang): string | null {
  if (lang === 'en') return null;
  const n = TRANSLATIONS[lang].names;
  return `The visitor's language is ${SPOKEN[lang]}. Speak only in it, every turn, whatever language the app's notes, events and tool results to you are in. The catalogue records are given to you in it: tell them faithfully in your own spoken words, and use the works' titles and names as the records give them. The museum is ${n.museum} (the Meridian); Edmund Hale is ${n.hostFull}, its ${n.title} (chairman): use exactly these names and this title, never another (live, in Korean he called himself 이사장 where the screen says 관장).`;
}
