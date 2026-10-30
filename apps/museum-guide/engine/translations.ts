// The tour in its other languages, as data: translations/<lang>.json, one file a
// language, each with the same keys as the English (the screen's strings, the
// works' records, the floor plan's rooms and pin labels, the guests' labels,
// and the names the guides use). The Traditional Chinese and Japanese were
// written by hand; the rest were translated from the English by a model and
// checked against it (same keys, placeholders kept, lists the same length).
import zhTW from '../translations/zh-TW.json';
import zhCN from '../translations/zh-CN.json';
import ja from '../translations/ja.json';
import ko from '../translations/ko.json';
import de from '../translations/de.json';
import vi from '../translations/vi.json';
import es from '../translations/es.json';
import ru from '../translations/ru.json';
import type { Exhibit } from './catalogue.ts';
import type { Lang } from './lang.ts';

export type WorkText = Pick<Exhibit, 'title' | 'artist' | 'date' | 'medium' | 'gallery' | 'original' | 'story' | 'lookFor'>;

export interface Translation {
  ui: Record<string, string>;
  works: Record<string, WorkText>;
  rooms: Record<string, string[]>;
  pins: Record<string, string>;
  guests: Record<string, { name: string; meet: string }>;
  /** The museum's name, the host's full and first name, and his title, as the language says them. */
  names: { museum: string; hostFull: string; host: string; title: string };
}

export const TRANSLATIONS: Record<Exclude<Lang, 'en'>, Translation> = { 'zh-TW': zhTW, 'zh-CN': zhCN, ja, ko, de, vi, es, ru };
