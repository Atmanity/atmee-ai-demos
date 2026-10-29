// Everything the tour says on screen, in each of its languages. The visitor picks
// one at the front door; it is kept for their next visit. `{name}`-style holes
// are filled by t().
import { createContext, useContext } from 'react';
import { isLang, type Lang } from '../engine/lang.ts';

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
  showHost: 'Show {name}', callHost: 'Call {name}',
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

const zhTW: Strings = {
  eyebrow: '館長親自為你導覽',
  headline: '每件作品都有故事，艾德蒙全都知道。',
  lede: '在展廳裡舉起手機，對準一幅畫或它說明牌上的條碼，子午線美術館館長艾德蒙·黑爾就會告訴你眼前是什麼。有任何問題，直接開口問他。',
  opening: '你現在在{gallery}的《{title}》前。',
  language: '語言',
  begin: '開始導覽',
  starting: '準備中…',
  uses: '與艾德蒙交談時會使用你的相機和麥克風。在展廳裡最好戴上耳機。',
  sheetLink: '不在美術館？在另一個螢幕打開展品說明牌',
  sheetAfter: '，再用手機對準它們。',
  cameraBlocked: '相機被封鎖了。請在瀏覽器設定中允許這個網站使用相機，然後重新開始。',
  cameraMissing: '這台裝置無法開啟相機。',
  calling: '正在呼叫{name}…', callingDetail: '需要幾秒鐘。',
  warming: '{name}正在準備', warmingDetail: '導覽員都在忙，正在等候…',
  connecting: '正在連線到{name}…',
  arriving: '{name}即將加入…', arrivingDetail: '快好了。',
  ended: '通話已結束',
  failed: '無法聯絡{name}', failedDetail: '請稍後再試。',
  tryAgain: '再試一次',
  end: '結束',
  tapToHear: '點一下來聽{name}說話',
  cameraOff: '關閉相機', cameraOn: '開啟相機',
  cameraOffNote: '相機已關閉，{name}看不到你眼前的東西。',
  cameraBlockedToast: '相機被封鎖了：請在瀏覽器設定中允許，然後再試一次。',
  cameraOffAtStart: '相機沒有開啟：請在瀏覽器設定中允許，才能對準作品。你仍然可以和{name}交談。',
  looking: '辨識中…',
  label: '說明牌：《{title}》',
  notAWork: '這不是本館的館藏',
  onTheWay: '{name}正在過來…',
  hostOnTheWay: '{name}正在回來…',
  hostCouldNotComeBack: '{name}現在無法回來，請稍後再試。',
  talkingWith: '正在交談', fromWork: '來自《{title}》',
  callBack: '請{name}回來',
  youAreAt: '你在',
  pointHint: '把相機對準一件作品，或它說明牌上的條碼。',
  askHint: '按住麥克風，問{name}任何問題。',
  you: '你',
  conversation: '與{name}的對話', done: '完成', askPlaceholder: '問{name}…',
  chatEmpty: '展廳太吵不方便說話時，可以在這裡打字。',
  map: '地圖', type: '打字', holdToTalk: '按住說話', listening: '聆聽中…', whatIsThis: '這是什麼？',
  showHost: '顯示{name}', callHost: '請{name}回來',
  mapLabel: '館內地圖，已看 {n}/{total} 件',
  backToCamera: '回到相機', allWorks: '‹ 所有作品', youAreHere: '你在這裡 · ',
  originalHangs: '原作收藏於{where}。', theStory: '故事', lookFor: '細看這裡',
  nextOnRoute: '下一站 · {room}', askAbout: '問艾德蒙這件作品', markSeen: '標記為已看', seen: '已看',
  museumMap: '館內地圖', seenCount: '已看 {n}/{total} 件作品', close: '關閉', entrance: '入口',
  gallery: '第{n}展廳', hereSuffix: ' · 你在這裡', notSeenYet: '還沒看', floorPlan: '子午線美術館平面圖',
  thanks: '感謝你的參觀', visitOne: '你看了 1 件作品', visitMany: '你看了 {n} 件作品', comeBack: '歡迎再來',
  noneSeen: '這次你沒有停在任何一件作品前。艾德蒙會在這裡等你。', newTour: '開始新的導覽', seeMap: '查看館內地圖',
  theOriginal: '原作：{where}',
};

const ja: Strings = {
  eyebrow: '館長によるプライベートツアー',
  headline: 'どの作品にも物語がある。エドマンドはそのすべてを知っている。',
  lede: '展示室でスマートフォンをかざしてください。絵や解説ラベルのコードに向けると、メリディアン美術館の館長エドマンド・ヘイルが、目の前の作品について教えてくれます。何でも声に出して聞いてください。',
  opening: 'いま{gallery}の「{title}」の前にいます。',
  language: '言語',
  begin: 'ツアーを始める',
  starting: '準備しています…',
  uses: 'エドマンドと話している間、カメラとマイクを使います。展示室ではイヤホンがおすすめです。',
  sheetLink: '美術館にいない場合は、別の画面で作品ラベルを開き',
  sheetAfter: '、スマートフォンを向けてください。',
  cameraBlocked: 'カメラがブロックされています。ブラウザの設定でこのサイトにカメラを許可してから、もう一度始めてください。',
  cameraMissing: 'この端末ではカメラを開けませんでした。',
  calling: '{name}を呼んでいます…', callingDetail: '数秒かかります。',
  warming: '{name}が準備中です', warmingDetail: 'ガイドが全員対応中です。お待ちください…',
  connecting: '{name}に接続しています…',
  arriving: '{name}がまもなく来ます…', arrivingDetail: 'もうすぐです。',
  ended: '通話が終わりました',
  failed: '{name}につながりませんでした', failedDetail: '少し待ってから、もう一度お試しください。',
  tryAgain: 'もう一度',
  end: '終了',
  tapToHear: 'タップして{name}の声を聞く',
  cameraOff: 'カメラをオフ', cameraOn: 'カメラをオン',
  cameraOffNote: 'カメラがオフです。{name}にはあなたが見ているものが見えません。',
  cameraBlockedToast: 'カメラがブロックされています。ブラウザの設定で許可してから、もう一度お試しください。',
  cameraOffAtStart: 'カメラがオフです。作品に向けるにはブラウザの設定で許可してください。{name}とはそのまま話せます。',
  looking: '見ています…',
  label: 'ラベル：「{title}」',
  notAWork: '当館の所蔵作品ではありません',
  onTheWay: '{name}がこちらに向かっています…',
  hostOnTheWay: '{name}が戻ってきます…',
  hostCouldNotComeBack: '{name}は今戻れません。少し待ってからもう一度お試しください。',
  talkingWith: '話している相手', fromWork: '「{title}」より',
  callBack: '{name}を呼び戻す',
  youAreAt: 'いまの作品',
  pointHint: '作品か、そのラベルのコードにカメラを向けてください。',
  askHint: 'マイクを押したまま、{name}に何でも聞いてください。',
  you: 'あなた',
  conversation: '{name}との会話', done: '完了', askPlaceholder: '{name}に質問…',
  chatEmpty: '展示室がにぎやかで話せないときは、ここに入力してください。',
  map: '地図', type: '入力', holdToTalk: '押して話す', listening: '聞いています…', whatIsThis: 'これは何？',
  showHost: '{name}を表示', callHost: '{name}を呼ぶ',
  mapLabel: '館内マップ、{total}点中{n}点を鑑賞済み',
  backToCamera: 'カメラに戻る', allWorks: '‹ すべての作品', youAreHere: '現在地 · ',
  originalHangs: '原画は{where}にあります。', theStory: '物語', lookFor: '見どころ',
  nextOnRoute: '次の作品 · {room}', askAbout: 'エドマンドに聞く', markSeen: '鑑賞済みにする', seen: '鑑賞済み',
  museumMap: '館内マップ', seenCount: '{total}点中{n}点を鑑賞', close: '閉じる', entrance: '入口',
  gallery: '第{n}展示室', hereSuffix: ' · 現在地', notSeenYet: '未鑑賞', floorPlan: 'メリディアン美術館の平面図',
  thanks: 'ご来館ありがとうございました', visitOne: '鑑賞した作品：1点', visitMany: '鑑賞した作品：{n}点', comeBack: 'またのお越しを',
  noneSeen: '今回はどの作品にも立ち寄りませんでした。エドマンドはいつでもここにいます。', newTour: '新しいツアーを始める', seeMap: '館内マップを見る',
  theOriginal: '原画：{where}',
};

export const STRINGS: Record<Lang, Strings> = { en, 'zh-TW': zhTW, ja };
export type StringKey = keyof Strings;

/** The host's name as said in each language. */
export const HOST_NAME: Record<Lang, string> = { en: 'Edmund', 'zh-TW': '艾德蒙', ja: 'エドマンド' };

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
  const browser = navigator.language || '';
  if (/^zh-(TW|HK|Hant)/i.test(browser)) return 'zh-TW';
  if (/^ja\b/i.test(browser)) return 'ja';
  return 'en';
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* not kept */ }
}
