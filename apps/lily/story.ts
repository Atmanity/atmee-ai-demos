// Where Are You, Lily? Your little sister FaceTimes you at 1:12 a.m. She woke up somewhere dark and
// does not know where she is; her phone is at 9% and maps will not load. You find her by asking:
// what she hears, what she sees, and by having her turn the camera. Every clue rules places out on
// your map. Send the police to the right place before her battery dies.
//
// One true place (the old Harlan Textile Mill). The decoys are built so no single clue is enough.

export type Clue = 'train' | 'water' | 'brick' | 'machines' | 'sign' | 'tower';
export type View = 'room' | 'sign' | 'window' | 'door';

export interface Place { id: string; name: string; note: string; x: number; y: number; has: Clue[] }
export const PLACES: Place[] = [
  { id: 'mill', name: 'Harlan Textile Mill', note: 'Closed 1998. On the river, beside the freight line.', x: 70, y: 47, has: ['train', 'water', 'brick', 'machines', 'sign', 'tower'] },
  { id: 'foundry', name: 'Kessler Iron Works', note: 'Disused foundry by the rail yard.', x: 74, y: 30, has: ['train', 'brick', 'machines'] },
  { id: 'pump', name: 'Reservoir Pump House', note: 'Old brick pump station at the dam.', x: 22, y: 20, has: ['water', 'brick', 'machines'] },
  { id: 'storage', name: 'Harlow Self Storage', note: 'Steel units along the tracks.', x: 82, y: 56, has: ['train', 'sign'] },
  { id: 'yard', name: 'Ashford Rail Yard', note: 'Freight sidings, tin sheds.', x: 70, y: 18, has: ['train', 'machines'] },
  { id: 'grain', name: 'Grain Elevator', note: 'Concrete silos on the spur line.', x: 88, y: 38, has: ['train'] },
  { id: 'motel', name: 'Riverside Motel', note: 'Open all night, by the river bridge.', x: 44, y: 62, has: ['water', 'tower'] },
  { id: 'boathouse', name: 'Marina Boathouse', note: 'Wooden boathouse on the river.', x: 34, y: 74, has: ['water'] },
  { id: 'church', name: "St. Mary's Basement", note: 'Old brick church, cellar hall.', x: 30, y: 44, has: ['brick'] },
  { id: 'depot', name: 'Bus Depot', note: 'Last bus 12:40 a.m.', x: 50, y: 30, has: [] },
  { id: 'school', name: 'Ashford High Gym', note: "Where tonight's party was.", x: 16, y: 58, has: [] },
  { id: 'quarry', name: 'Quarry Road', note: 'Gravel pits, no buildings.', x: 12, y: 84, has: [] },
];
export const TRUTH = 'mill';

/** What each clue means, as a line in your notes. */
export const CLUE_NOTE: Record<Clue, string> = {
  train: 'Hears a train, close',
  water: 'Rushing water outside',
  brick: 'Old red-brick walls',
  machines: 'Huge rusted machines',
  sign: 'Painted on the wall: "HARL…"',
  tower: 'A water tower across a river',
};

/** What she says that gives a clue away. */
const SAID: [Clue, RegExp][] = [
  ['train', /\b(train|horn|tracks?|railroad|rail)\b/i],
  ['water', /\b(water|river|rushing|stream|weir|dam)\b/i],
  ['brick', /\bbricks?\b/i],
  ['machines', /\b(machines?|looms?|spools?|gears?|rusty|rusted)\b/i],
  ['sign', /\bharl/i],
  ['tower', /\bwater ?tower\b/i],
];
export const cluesIn = (text: string): Clue[] => SAID.filter(([, re]) => re.test(text)).map(([c]) => c);

/** What each view of the back camera shows (and so gives away). */
export const VIEWS: Record<View, { clues: Clue[]; event: string }> = {
  room: { clues: ['brick', 'machines'], event: 'You turned your phone around to show the room: a huge dark brick hall full of old rusted machines with spools on them. Say what you are showing, scared.' },
  sign: { clues: ['sign'], event: 'You turned your phone around to show the wall: big faded painted letters, most flaked off. You can read "HARL" and then it is gone. Read it out.' },
  window: { clues: ['water', 'tower'], event: 'You turned your phone around to show the broken window high up: a river rushing over a weir below, and a lit water tower on the other side. Say what you see.' },
  door: { clues: [], event: 'You turned your phone around to show the door: heavy steel, and through the gap there is a chain on the outside. Someone locked it. Say so, terrified.' },
};
const VIEW_WORDS: [View, RegExp][] = [
  ['sign', /\b(sign|writing|letters|words|wall says|name)\b/i],
  ['window', /\b(window|outside|out there)\b/i],
  ['door', /\b(door|way out|exit|locked)\b/i],
  ['room', /\b(room|around you|place|where you are)\b/i],
];
const ASKS_TO_SEE = /\b(turn (the |your )?(camera|phone)|flip|show me|let me see|can i see|point (it|the camera|your phone))\b/i;
/** Did you ask her to show you something, and what? The next unseen view when you did not say. */
export function viewAsked(text: string, seen: View[]): View | null {
  if (!ASKS_TO_SEE.test(text)) return null;
  const named = VIEW_WORDS.find(([, re]) => re.test(text))?.[0];
  if (named) return named;
  return (['room', 'window', 'sign', 'door'] as View[]).find((v) => !seen.includes(v)) ?? 'room';
}

/** Places still possible given the clues found. */
export const possible = (found: Clue[]) => PLACES.filter((p) => found.every((c) => p.has.includes(c)));

// ---- the battery: 9% at 1:12, about 25 s a percent; each flip of the camera costs a percent.
export const START_BATTERY = 9;
export const SECONDS_PER_PERCENT = 26;
export const FLIP_COST = 1;

export type Ending = 'found' | 'wrong' | 'dead';
export const ENDINGS: Record<Ending, { title: string; line: (place: string) => string }> = {
  found: { title: 'Found', line: () => 'The police cut the chain at the Harlan Mill at 1:31 a.m. Lily was wrapped in a foil blanket, holding your hand on the phone the whole way to the hospital.' },
  wrong: { title: 'Not there', line: (p) => `The police searched ${p}. Lily was two miles away, in the old Harlan Mill. A rail worker heard her at dawn.` },
  dead: { title: '0%', line: () => 'Her phone died at 1:16 a.m. You were still on the map when the screen went dark.' },
};

// ---- the live call
export function instructions(): string {
  return [
    "You are Lily, 19, a college freshman. You are on a FaceTime call with your older sibling, the person you trust most. Never use their name; call them nothing, or 'hey'.",
    'You went to a party in town tonight, at a house near the old high school. The last thing you remember is a drink someone handed you. You just woke up on a cold concrete floor somewhere dark. Your head hurts. You do not know where you are or how you got here. Your phone is almost dead and maps will not load.',
    'You are terrified but trying to hold it together for your sibling. Speak softly and quickly, one or two short sentences at a time, then listen. Sometimes ask them to stay on the line.',
    'You sit on the floor with your back to the wall, holding the phone in front of your face. Answer what they ask about where you are, honestly and only what you notice when asked: what you hear (a freight train passing close, every few minutes; water rushing somewhere outside), what you feel and smell (cold concrete, oil, wet dust), what you see by the light of your phone (old red-brick walls, huge rusted machines with spools on them). You do not know the name of the place.',
    'If they ask you to show them, say okay and that you are turning the camera.',
    'Never mention being an AI, a story or a game.',
  ].join('\n');
}
export const OPENING = "Your sibling just picked up. Whisper urgently: 'Oh thank God, you picked up. Please don't hang up. I don't know where I am.'";
export const FOOTSTEPS = 'You just heard footsteps, slow, somewhere above you, and a door bang. Go silent for a moment, then whisper that someone is here, and that you are scared. From now on whisper.';
export const FINALE: Record<Ending, string> = {
  found: 'You hear sirens outside, coming closer, and men shouting your name. Cry with relief and tell your sibling they are here, they found you.',
  wrong: 'Your sibling sent the police somewhere else. Long minutes pass and nobody comes. Whisper that nobody is here, nobody is coming, and that your phone is dying.',
  dead: 'Your phone is about to die. Whisper quickly that you love them, please find me.',
};

export const TOOLS = [{
  type: 'function' as const, name: 'noticed',
  description: 'Call this, without mentioning it, when you notice something new about the place. Keep talking normally.',
  parameters: { type: 'object', properties: { what: { type: 'string', description: 'What you noticed' } }, required: [] },
  'x-atmee': { mode: 'notify' as const },
}];
