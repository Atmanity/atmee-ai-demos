// Tonight's possible guests (all invented characters): avatars on the demo
// account whose own persona fits a talk-show chair and that carry no agenda (a conductor would pull them
// back to their own app's steps). AVATAR_TV_SHOW_GUEST_<ID> swaps one.
export interface Guest {
  id: string;
  name: string;
  /** How the host bills them: "a homicide detective with twenty years on the job". */
  billing: string;
  avatarId: string;
  /** The segment's subject, and the rundown the producer starts from. */
  subject: string;
  rundown: string[];
}

export const GUESTS: Guest[] = [
  {
    id: 'vivienne',
    name: 'Vivienne Lark',
    billing: 'screen legend and Oscar winner for The Velvet Hour',
    avatarId: '35d17006-0cf4-4675-9bd2-6f5a6e22358c',
    subject: 'the lion on her very first picture',
    rundown: ['The lion on her very first picture', 'Winning the Oscar for The Velvet Hour', 'Three husbands and a dentist', 'Doing her own sword fight in The Silver Veil', 'Life with Bogie and Bacall, her pugs'],
  },
  {
    id: 'lumi',
    name: 'Lumi Brook',
    billing: 'a travel writer who has slow-travelled half the world',
    avatarId: '8c589918-2e54-498e-8662-cb0fc3ca9bd5',
    subject: 'the trips that changed her',
    rundown: ['The trip that changed her', 'A city best seen on foot', 'The best meal she ever had abroad', 'One tip for a first solo trip'],
  },
  {
    id: 'draconia',
    name: 'Draconia Malvane',
    billing: 'Mistress of Spellcraft at Silverfell, the youngest in three centuries',
    avatarId: '425bd05c-5dfd-4459-8612-493f70e7501f',
    subject: 'what it takes to master spellcraft',
    rundown: ['What it takes to master spellcraft', 'Growing up in the House of Malvane', 'Her owl, Quillon', 'The worst spell a student ever cast in her class'],
  },
  {
    id: 'frank',
    name: 'Frank Malone',
    billing: 'a big-city homicide detective with twenty years on the job',
    avatarId: 'ff3b2fea-4af3-4cee-8657-2a5aec3c8121',
    subject: 'the case he still thinks about',
    rundown: ['The case he still thinks about', 'What TV gets wrong about detectives', 'Coffee, nights and the notebook', 'Advice for a rookie'],
  },
  {
    id: 'mira',
    name: 'Mira',
    billing: 'a stargazing guide who has spent years showing people the night sky',
    avatarId: '6ab2102c-3f72-4959-b1ee-f28215ff9339',
    subject: 'what to look for in the sky this season',
    rundown: ['What to look for this season', 'Why the sky matters to her', 'Her best night under the stars', 'How to start stargazing from a city'],
  },
];

export const guestById = (id: string) => GUESTS.find((g) => g.id === id);

export const firstName = (name: string) => name.split(' ')[0];
