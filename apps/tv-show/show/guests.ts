// Tonight's possible guests: avatars on the demo account whose own persona
// fits a talk-show chair and that carry no agenda (a conductor would pull them
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
    id: 'lumi',
    name: 'Lumi Brook',
    billing: 'a travel writer who has slow-travelled half the world',
    avatarId: '8c589918-2e54-498e-8662-cb0fc3ca9bd5',
    subject: 'the trips that changed her',
    rundown: ['The trip that changed her', 'A city best seen on foot', 'The best meal she ever had abroad', 'One tip for a first solo trip'],
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
