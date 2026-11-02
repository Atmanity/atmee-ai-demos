// The people in the mall. Each has clues the seller can read (never demographics: only
// what they wear, carry, or how they talk), and a pool of real reasons to buy, one per run.
export interface Clue { id: string; label: string; x: number; y: number; points: string }
export interface Motive {
  id: string;
  /** What the guest really wants, as the seller's read-check chip and the reveal say it. */
  label: string;
  /** Told to the guest: the need, in their own words. */
  need: string;
  /** The most they would pay for a pen that truly fits, in dollars. */
  top: number;
  objection: string;
  /** Asks for a better price once, even when they would pay more. */
  haggles: boolean;
  /** The clue that points to this motive. */
  clue: string;
}
export interface Guest {
  id: string;
  name: string;
  role: string;
  avatarId: string;
  image: string;
  /** Where the seller finds them in the mall. */
  spotted: string;
  clues: Clue[];
  motives: Motive[];
}

export const GUESTS: Guest[] = [
  {
    id: 'ray', name: 'Ray', role: 'Site foreman', avatarId: '7b3e60f3-376f-477b-82e9-8f37baeb60e1', image: 'ray',
    spotted: 'Someone in a hi-vis vest, walking fast, clipboard in hand.',
    clues: [
      { id: 'pencil', label: 'Pencil behind the ear', x: 33, y: 23, points: 'He writes all day, and he has given up on pens.' },
      { id: 'vest', label: 'Hi-vis vest', x: 73, y: 71, points: 'He works outdoors, in the wet and the cold.' },
      { id: 'clipboard', label: 'Clipboard of site notes', x: 47, y: 92, points: 'Paper records he signs and has to trust.' },
    ],
    motives: [
      { id: 'weather', label: 'A pen that works outdoors in the wet', need: 'Pens die on you on site in the cold and the rain, so you use a pencil. A pen that writes on a wet clipboard would actually help.', top: 22, objection: "A pencil's free.", haggles: true, clue: 'pencil' },
      { id: 'signoff', label: 'A pen for permanent site sign-offs', need: 'Inspectors now refuse pencil on the safety sheets you sign off. You need ink that does not smudge in the rain.', top: 24, objection: 'Any cheap pen signs a sheet.', haggles: false, clue: 'clipboard' },
    ],
  },
  {
    id: 'marisol', name: 'Marisol', role: 'Night-shift nurse', avatarId: '82437255-abfc-4687-9fa6-8ab6b307a267', image: 'marisol',
    spotted: 'Someone in scrubs, walking slowly, looking half asleep.',
    clues: [
      { id: 'pens', label: 'Four cheap pens in the pocket', x: 71, y: 89, points: 'She carries spares because pens keep failing or vanishing.' },
      { id: 'eyes', label: 'Tired eyes', x: 50, y: 28, points: 'End of a long shift: she wants less hassle, not a speech.' },
      { id: 'lanyard', label: 'Staff lanyard', x: 48, y: 73, points: 'Hospital staff: she writes charts all night.' },
    ],
    motives: [
      { id: 'stolen', label: "A pen that is hers and doesn't walk off", need: 'Colleagues keep walking off with your pens on the ward. You want one nice enough that it feels like yours and comes home with you.', top: 18, objection: 'The hospital gives us these.', haggles: true, clue: 'pens' },
      { id: 'refills', label: 'One reliable pen instead of four', need: "You are tired of cheap pens dying halfway through a chart at 4 a.m. One pen that keeps going would be a small relief.", top: 20, objection: "I've got four already.", haggles: false, clue: 'eyes' },
    ],
  },
  {
    id: 'walter', name: 'Walter', role: 'Retired teacher', avatarId: 'd5029255-040a-4d77-a1f0-a20b43bbc5c7', image: 'walter',
    spotted: 'Someone in a green cardigan, a bundle of envelopes in hand.',
    clues: [
      { id: 'letters', label: 'Handwritten envelopes', x: 53, y: 95, points: 'He still writes letters by hand, every week.' },
      { id: 'glasses', label: 'Reading glasses on a chain', x: 52, y: 84, points: 'He reads and writes a lot, and small print matters to him.' },
      { id: 'hands', label: 'He takes his time', x: 50, y: 28, points: 'He tests whether you will listen before he buys.' },
    ],
    motives: [
      { id: 'letters', label: 'A better pen for his weekly letters', need: 'You write to your granddaughter every week, and it is the best hour you have. A pen that flows well would make it nicer.', top: 23, objection: "I've had mine thirty years.", haggles: false, clue: 'letters' },
      { id: 'grip', label: 'A comfortable grip for stiff hands', need: 'Your hands have grown stiff and thin pens hurt after a page. A wide soft grip would let you keep writing.', top: 25, objection: 'My old pen does the job.', haggles: true, clue: 'glasses' },
    ],
  },
];

export const guestById = (id: string) => GUESTS.find((g) => g.id === id);
