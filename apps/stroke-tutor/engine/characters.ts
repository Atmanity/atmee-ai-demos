// The character set: SERVER ONLY. Never import this file (or strokes.ts,
// tutor.ts, lesson.ts, judge.ts, which import it) from page/: the reference
// points of every stroke are here, and a page that ships them lets a curious
// learner read the answer in devtools, which turns the drill into tracing.
// `bundle.test.ts` holds that line.
//
// Every word the teacher says about a stroke comes from THIS file. The avatar
// is never asked to remember which stroke of 永 comes third, or which way a 撇
// travels: it is handed `teach`, `hint`, `directionNote` or `startNote` and
// says it back. That is why the content is data rather than prompt: a tutor
// that invents "the vertical comes first" because it sounded plausible teaches
// a habit the learner then has to unlearn, and a prompt cannot be diffed.
//
// Coordinates are integers on a 1000x1000 grid with the origin at the TOP LEFT
// and y increasing downward, the same convention a canvas uses, so the page
// scales and never converts. Nothing here is in pixels.
//
// Stroke orders follow the standard teaching sequences (Japanese 筆順 for the
// kanji, the usual primary-school sequence for the two Latin capitals). 永 is
// the classic five-stroke exercise; its decomposition here is the dictionary
// one (点, 横折, 竖钩, 撇, 捺) rather than the eight 永字八法 techniques, because
// the app grades strokes and a technique is not a stroke.

/** The coordinate space every point in this file lives in. */
export const GRID = 1000;

export type Point = readonly [number, number];

/**
 * One stroke, with the four sentences it can be taught by.
 *
 * `points` is the answer as much as the shape, which is why the snapshot
 * withholds it until the stroke is earned. The four sentences are deliberately
 * separate: `teach` is the full lesson and is only ever heard once the stroke
 * is resolved; `hint`, `directionNote` and `startNote` are corrections for a
 * specific mistake and each says only as much as that mistake gave away.
 */
export interface Stroke {
  /** How the teacher refers to it once it is earned ("the long horizontal"). */
  name: string;
  points: readonly Point[];
  /** The full lesson, said when the stroke is resolved: right or revealed. */
  teach: string;
  /** A nudge after a wrong shape. Points at it; does not draw it. */
  hint: string;
  /** Said when the shape was right but the travel was backwards. Naming the direction is the teaching here, not a leak: they already drew the shape. */
  directionNote: string;
  /** Said when the shape and direction were right but it began in the wrong place. */
  startNote: string;
}

export interface Character {
  id: string;
  glyph: string;
  meaning: string;
  reading: string;
  /** The page labels the reading differently for each, and a learner with no Japanese needs somewhere to start. */
  script: 'kanji' | 'latin';
  strokes: readonly Stroke[];
}

export const ICHI: Character = {
  id: 'ichi',
  glyph: '一',
  meaning: 'one',
  reading: 'ichi',
  script: 'kanji',
  strokes: [
    {
      name: 'the single horizontal',
      points: [[150, 500], [500, 495], [850, 500]],
      teach: 'One stroke, left to right, with a small press at the finish. Every horizontal in this writing system travels left to right — there are no exceptions.',
      hint: 'One straight line across the middle of the square.',
      directionNote: 'Horizontals always travel left to right — start at the left edge.',
      startNote: 'Begin at the far left of the square, not partway in.',
    },
  ],
};

export const JUU: Character = {
  id: 'juu',
  glyph: '十',
  meaning: 'ten',
  reading: 'jū',
  script: 'kanji',
  strokes: [
    {
      name: 'the horizontal',
      points: [[150, 450], [500, 448], [850, 450]],
      teach: 'The horizontal comes first, left to right. Horizontal before vertical is the rule that decides most crossings in kanji.',
      hint: 'Something crosses the square from side to side.',
      directionNote: 'Left to right — that horizontal is going backwards.',
      startNote: 'Start at the left edge of the square.',
    },
    {
      name: 'the vertical',
      points: [[500, 120], [500, 500], [500, 880]],
      teach: 'Then the vertical, top to bottom, straight through the middle. Verticals always travel downward.',
      hint: 'Now something crosses the other way.',
      directionNote: 'Verticals travel top to bottom — start at the top.',
      startNote: 'Begin at the very top of the square.',
    },
  ],
};

export const KAWA: Character = {
  id: 'kawa',
  glyph: '川',
  meaning: 'river',
  reading: 'kawa',
  script: 'kanji',
  strokes: [
    {
      name: 'the short left stroke',
      points: [[190, 170], [175, 350], [155, 520]],
      teach: 'The short left stroke first, drawn downward with a slight lean to the left. Left before right — that is the second great ordering rule after horizontal before vertical.',
      hint: 'Three strokes, all going down. Which side does a river start?',
      directionNote: 'It travels downward — start at the top.',
      startNote: 'Start at the top of the leftmost stroke.',
    },
    {
      name: 'the middle stroke',
      points: [[480, 260], [480, 480], [480, 700]],
      teach: 'Then the middle stroke, straight down and shorter than the right one.',
      hint: 'Left is done. Work across the square.',
      directionNote: 'Downward — this one starts at the top too.',
      startNote: 'Begin at the top of the middle stroke.',
    },
    {
      name: 'the long right stroke',
      points: [[800, 150], [800, 520], [800, 880]],
      teach: 'The long right stroke last, top to bottom — the longest of the three.',
      hint: 'One left to draw, and it is the tallest.',
      directionNote: 'Downward, like the other two.',
      startNote: 'Begin at the very top of the right-hand stroke.',
    },
  ],
};

export const KI: Character = {
  id: 'ki',
  glyph: '木',
  meaning: 'tree',
  reading: 'ki',
  script: 'kanji',
  strokes: [
    {
      name: 'the horizontal',
      points: [[130, 380], [500, 376], [870, 380]],
      teach: 'Horizontal first, left to right — the branches before the trunk.',
      hint: 'Horizontal before vertical, every time.',
      directionNote: 'Left to right.',
      startNote: 'Start at the left edge.',
    },
    {
      name: 'the vertical trunk',
      points: [[500, 120], [500, 500], [500, 900]],
      teach: 'Then the trunk: straight down through the crossing, top to bottom.',
      hint: 'Now the trunk of the tree.',
      directionNote: 'Top to bottom.',
      startNote: 'Begin above the horizontal, at the top of the square.',
    },
    {
      name: 'the left-falling stroke',
      points: [[490, 430], [350, 640], [200, 860]],
      teach: 'The left-falling stroke — 撇 — sweeps down and out to the LEFT, starting from the trunk. Left root before right root.',
      hint: 'Two roots left, and one of them comes first.',
      directionNote: 'It falls away from the trunk — start high, near the crossing.',
      startNote: 'Start it on the trunk, just under the horizontal.',
    },
    {
      name: 'the right-falling stroke',
      points: [[510, 430], [660, 640], [800, 860]],
      teach: 'The right-falling stroke — 捺 — last, sweeping down to the RIGHT and pressing wider as it goes.',
      hint: 'One root left.',
      directionNote: 'It falls away from the trunk — start high, near the crossing.',
      startNote: 'Start it on the trunk, just under the horizontal.',
    },
  ],
};

export const EI: Character = {
  id: 'ei',
  glyph: '永',
  meaning: 'eternity',
  reading: 'ei',
  script: 'kanji',
  strokes: [
    {
      name: 'the dot',
      points: [[498, 70], [512, 115], [527, 158]],
      teach: 'The dot on top, pressed downward and slightly to the right. Top before bottom — 永 is the classic exercise because it drills all five stroke families in one character.',
      hint: 'Start at the very top of the character.',
      directionNote: 'A dot is pressed downward, not flicked upward.',
      startNote: 'It begins at the top of the square, on the centre line.',
    },
    {
      name: 'the shoulder',
      points: [[270, 275], [400, 258], [510, 252], [462, 380]],
      teach: 'The shoulder — 横折: a short horizontal to the right, then a turn down and to the left, all in ONE stroke without lifting.',
      hint: 'One stroke to the upper left, and it changes direction partway.',
      directionNote: 'It runs right along the top first — start at the left.',
      startNote: 'Begin at the left end of the shoulder, not at the turn.',
    },
    {
      name: 'the vertical hook',
      points: [[520, 250], [520, 500], [520, 760], [430, 712]],
      teach: 'The vertical hook — 竖钩: straight down the centre, then flick up and to the left at the bottom without lifting the brush.',
      hint: 'The spine of the character runs down the middle.',
      directionNote: 'Downward, then the flick — start at the top.',
      startNote: 'Begin under the dot, at the top of the spine.',
    },
    {
      name: 'the left sweep',
      points: [[505, 430], [360, 610], [210, 790]],
      teach: 'Then 撇, the left sweep: down and out to the left, thinning as it goes.',
      hint: 'Two sweeps left. Left before right.',
      directionNote: 'It sweeps away from the spine — start next to the spine.',
      startNote: 'Start it on the spine, then travel out.',
    },
    {
      name: 'the right sweep',
      points: [[530, 440], [690, 620], [840, 800]],
      teach: 'And 捺 last: down and out to the right, pressing wider, then a flat finish.',
      hint: 'One stroke left, and it balances the one before it.',
      directionNote: 'It sweeps away from the spine — start next to the spine.',
      startNote: 'Start it on the spine, then travel out.',
    },
  ],
};

export const LATIN_A: Character = {
  id: 'latin_a',
  glyph: 'A',
  meaning: 'the letter A',
  reading: 'A',
  script: 'latin',
  strokes: [
    {
      name: 'the left diagonal',
      points: [[500, 120], [350, 500], [200, 880]],
      teach: 'Left diagonal first, from the apex down to the left foot.',
      hint: 'Start at the point at the top.',
      directionNote: 'Down from the apex, not up from the foot.',
      startNote: 'Begin at the apex, at the top of the letter.',
    },
    {
      name: 'the right diagonal',
      points: [[500, 120], [650, 500], [800, 880]],
      teach: 'Right diagonal second, from the same apex down to the right foot.',
      hint: 'Back to the top, and down the other side.',
      directionNote: 'Down from the apex, not up from the foot.',
      startNote: 'Begin at the apex again, not at the foot.',
    },
    {
      name: 'the crossbar',
      points: [[290, 620], [500, 620], [710, 620]],
      teach: 'Crossbar last, left to right, a little below the middle.',
      hint: 'One short stroke left, and it joins the two legs.',
      directionNote: 'Left to right.',
      startNote: 'Begin on the left leg.',
    },
  ],
};

export const LATIN_E: Character = {
  id: 'latin_e',
  glyph: 'E',
  meaning: 'the letter E',
  reading: 'E',
  script: 'latin',
  strokes: [
    {
      name: 'the spine',
      points: [[250, 120], [250, 500], [250, 880]],
      teach: 'The vertical spine first, top to bottom.',
      hint: 'The upright comes before the arms.',
      directionNote: 'Top to bottom.',
      startNote: 'Begin at the top of the upright.',
    },
    {
      name: 'the top arm',
      points: [[250, 120], [515, 120], [780, 120]],
      teach: 'Then the top arm, left to right from the spine.',
      hint: 'Work down the letter from the top.',
      directionNote: 'Left to right, away from the spine.',
      startNote: 'Start on the spine, not out in the air.',
    },
    {
      name: 'the middle arm',
      points: [[250, 500], [465, 500], [680, 500]],
      teach: 'Then the middle arm, left to right and a touch shorter.',
      hint: 'Top to bottom: which arm has not been drawn?',
      directionNote: 'Left to right, away from the spine.',
      startNote: 'Start on the spine.',
    },
    {
      name: 'the bottom arm',
      points: [[250, 880], [515, 880], [780, 880]],
      teach: 'And the bottom arm last, left to right, as long as the top.',
      hint: 'One arm left.',
      directionNote: 'Left to right, away from the spine.',
      startNote: 'Start on the spine.',
    },
  ],
};

/** Ordered easiest first. The page draws this order and the teacher offers it, so a learner with no Japanese meets 一 and A before 永. */
export const CHARACTERS: readonly Character[] = [ICHI, JUU, KAWA, KI, EI, LATIN_A, LATIN_E];

export const CHARACTERS_BY_ID: Readonly<Record<string, Character>> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

export const DEFAULT_CHARACTER_ID = ICHI.id;

/** Said back verbatim when the learner asks for a character this app does not have. A sentence, not a rendering: it must not change shape when content moves. */
export const UNKNOWN_CHARACTER_REASON = "I don't have that one — I've got 一 one, 十 ten, 川 river, 木 tree, 永 eternity, and the capitals A and E.";

// The notes for mistakes that are ABOUT the sequence rather than about one
// stroke. None of them names the stroke the learner is being asked for: a
// refusal is not a hint, and the stroke's own words are earned by resolving it.

export const ORDER_LATER_NOTE = "That shape belongs later in the character. We're on stroke {position} of {total} — that one comes first.";
export const ORDER_EARLIER_NOTE = "You've drawn that one already. We're on stroke {position} of {total} now.";
export const SHAPE_FALLBACK_NOTE = "I couldn't match that to any stroke in this character.";
export const DEGENERATE_NOTE = "That's barely a mark — draw the stroke as one continuous line.";

/** The menu the page draws. */
export function catalog() {
  return CHARACTERS.map((c) => ({ id: c.id, glyph: c.glyph, meaning: c.meaning, strokes_total: c.strokes.length }));
}

const ALIASES: Record<string, Character> = {
  one: ICHI, '1': ICHI, '一': ICHI,
  ten: JUU, '10': JUU, juu: JUU, ju: JUU, '十': JUU,
  river: KAWA, '川': KAWA,
  tree: KI, wood: KI, '木': KI,
  eternity: EI, eternal: EI, forever: EI, ei: EI, '永': EI,
  a: LATIN_A, letter_a: LATIN_A, capital_a: LATIN_A,
  e: LATIN_E, letter_e: LATIN_E, capital_e: LATIN_E,
};

/** A character by id, tolerating spoken and written forms ("tree", "eternity", the glyph itself). */
export function find(characterId: string | null | undefined): Character | null {
  const raw = (characterId ?? '').trim();
  const key = raw.toLowerCase().replace(/ /g, '_').replace(/-/g, '_');
  if (Object.hasOwn(CHARACTERS_BY_ID, key)) return CHARACTERS_BY_ID[key];
  for (const character of CHARACTERS) if (raw === character.glyph) return character;
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : null;
}

/**
 * The next character in the teaching order, wrapping at the end. Wrapping
 * rather than refusing: "next" at the end of the set is a learner who wants
 * to keep going, and a dead end there would be a refusal with nothing to act on.
 */
export function nextAfter(characterId: string | null): Character {
  if (characterId === null) return CHARACTERS[0];
  const index = CHARACTERS.findIndex((c) => c.id === characterId);
  return index < 0 ? CHARACTERS[0] : CHARACTERS[(index + 1) % CHARACTERS.length];
}
