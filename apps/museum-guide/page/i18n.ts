// Everything the tour says on screen, in each of its languages: the English
// here, the others from translations/<lang>.json (engine/translations.ts). The
// visitor picks one at the front door; it is kept for their next visit.
// `{name}`-style holes are filled by t().
import { createContext, useContext } from 'react';
import { isLang, LANGS, type Lang } from '../engine/lang.ts';
import { TRANSLATIONS } from '../engine/translations.ts';

const en = {
  // The front door
  eyebrow: 'A private tour with the chairman',
  headline: 'Every work has a story. Edmund knows them all.',
  lede: 'Hold up your phone in the galleries. Point it at a painting, or at the code on its label, and Edmund Hale, the Meridian\'s chairman, tells you what you\'re looking at. Ask him anything, out loud.',
  opening: 'You\'re at {title}, {gallery}.',
  language: 'Language',
  begin: 'Begin the tour',
  starting: 'Starting…',
  uses: 'Uses your camera and microphone while you\'re with Edmund. Earbuds are best in the galleries.',
  sheetLink: 'Not at the Meridian? Open the gallery labels on another screen',
  sheetAfter: ' and point your phone at them.',
  cameraBlocked: 'The camera is blocked. Allow it for this site in your browser\'s settings, then begin again.',
  cameraMissing: 'No camera could be opened on this device.',
  // The call
  calling: 'Calling {name}…', callingDetail: 'This takes a few seconds.',
  warming: '{name} is getting ready', warmingDetail: 'Every guide is busy. Waiting for one…',
  connecting: 'Connecting to {name}…',
  arriving: '{name} is joining…', arrivingDetail: 'Almost there.',
  ended: 'Call ended',
  failed: 'Couldn\'t reach {name}', failedDetail: 'Please try again in a moment.',
  tryAgain: 'Try again',
  end: 'End',
  tapToHear: 'Tap to hear {name}',
  // The camera
  cameraOff: 'Turn the camera off', cameraOn: 'Turn the camera on',
  cameraOffNote: 'The camera is off. {name} can\'t see what you\'re looking at.',
  cameraBlockedToast: 'The camera is blocked: allow it in your browser\'s settings, then try again.',
  cameraOffAtStart: 'The camera is off: allow it in your browser\'s settings to point at works. You can still talk with {name}.',
  looking: 'Looking…',
  label: 'Label: {title}',
  notAWork: 'Not one of the Meridian\'s works',
  // Guests
  onTheWay: '{name} is on the way…',
  hostOnTheWay: '{name} is on the way back…',
  hostCouldNotComeBack: '{name} could not come back just now. Try again in a moment.',
  talkingWith: 'Talking with', fromWork: 'from {title}',
  callBack: 'Call {name} back',
  // The panel
  youAreAt: 'You are at',
  pointHint: 'Point the camera at a work, or at the code on its label.',
  askHint: 'Hold the mic and ask {name} anything.',
  you: 'You',
  conversation: 'Conversation with {name}', done: 'Done', askPlaceholder: 'Ask {name}…',
  chatEmpty: 'Type here when the gallery is too loud to talk.',
  map: 'Map', type: 'Type', holdToTalk: 'Hold to talk', listening: 'Listening…', whatIsThis: 'What is this?',
  callHost: 'Call {name}', info: 'Info', larger: 'Show {name} larger', smaller: 'Show {name} smaller',
  mapLabel: 'Museum map, {n} of {total} seen',
  // A work's entry
  backToCamera: 'Back to camera', allWorks: '‹ All works', youAreHere: 'You are here · ',
  originalHangs: 'The original hangs in {where}.', theStory: 'The story', lookFor: 'Look for',
  nextOnRoute: 'Next on the route · {room}', askAbout: 'Ask Edmund about it', markSeen: 'Mark as seen', seen: 'Seen',
  // The map
  museumMap: 'Museum map', seenCount: '{n} of {total} works seen', close: 'Close', entrance: 'Entrance',
  gallery: 'Gallery {n}', hereSuffix: ' · you are here', notSeenYet: 'Not seen yet', floorPlan: 'Floor plan of the Meridian',
  // The visit
  thanks: 'Thank you for visiting', visitOne: 'Your visit: one work', visitMany: 'Your visit: {n} works', comeBack: 'Come back soon',
  noneSeen: 'You didn\'t stop at any work this time. Edmund will be here.', newTour: 'Begin a new tour', seeMap: 'See the museum map',
  theOriginal: 'The original: {where}',
};

type Strings = typeof en;

export type StringKey = keyof Strings;
export const STRINGS = Object.fromEntries(LANGS.map(({ id }) => [id, id === 'en' ? en : (TRANSLATIONS[id].ui as Strings)])) as Record<Lang, Strings>;
/** The English, as the reference every translation must match (for tests). */
export const ENGLISH: Strings = en;

/** The host's name as said in each language. */
export const HOST_NAME = Object.fromEntries(LANGS.map(({ id }) => [id, id === 'en' ? 'Edmund' : TRANSLATIONS[id].names.host])) as Record<Lang, string>;

export type T = (key: StringKey, vars?: Record<string, string | number>) => string;

export function translator(lang: Lang): T {
  return (key, vars) => STRINGS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
}

export const LangContext = createContext<{ lang: Lang; t: T }>({ lang: 'en', t: translator('en') });
export const useLang = () => useContext(LangContext);

const KEY = 'meridian-language';

/** The language last chosen here, or the browser's own if it is one of the tour's, or English. */
export function savedLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch { /* no storage */ }
  return browserLang(navigator.language || '');
}

/** The tour's language for a browser's: Chinese by script or region, the rest by their first part (de-AT is German). */
export function browserLang(tag: string): Lang {
  if (/^zh-(TW|HK|MO|Hant)/i.test(tag)) return 'zh-TW';
  if (/^zh\b/i.test(tag)) return 'zh-CN';
  const base = tag.split('-')[0].toLowerCase();
  return LANGS.find((l) => l.id === base)?.id ?? 'en';
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* not kept */ }
}
