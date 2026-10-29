// The languages a tour can be in: the ones the platform both hears and answers
// in today (speech recognition and replies are routed for en, zh-TW and ja; any
// other tag falls back to detecting the language, so it is not offered).

export type Lang = 'en' | 'zh-TW' | 'ja';

export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'zh-TW', name: '繁體中文' },
  { id: 'ja', name: '日本語' },
];

export const isLang = (value: unknown): value is Lang => LANGS.some((l) => l.id === value);

const SPOKEN: Record<Exclude<Lang, 'en'>, string> = {
  'zh-TW': 'Traditional Chinese, as spoken in Taiwan (繁體中文)',
  ja: 'Japanese (日本語)',
};

/**
 * The names as the visitor's screen gives them, so the guide says the same (live, in
 * Chinese he made up 美利堅博物館, "the America museum", and called himself 主席).
 */
const NAMES: Record<Exclude<Lang, 'en'>, string> = {
  'zh-TW': 'The museum is 子午線美術館 (the Meridian); Edmund Hale is 艾德蒙·黑爾, its 館長 (chairman).',
  ja: 'The museum is メリディアン美術館 (the Meridian); Edmund Hale is エドマンド・ヘイル, its 館長 (chairman).',
};

/**
 * The standing note that keeps a guide in the visitor's language: the app's own
 * notes, events and tool results stay in English, the catalogue records come in
 * the visitor's language. Null for English.
 */
export function languageRule(lang: Lang): string | null {
  if (lang === 'en') return null;
  return `The visitor's language is ${SPOKEN[lang]}. Speak only in it, every turn, whatever language the app's notes, events and tool results to you are in. The catalogue records are given to you in it: tell them faithfully in your own spoken words, and use the works' titles and names as the records give them. ${NAMES[lang]}`;
}
