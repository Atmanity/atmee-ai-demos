// The people in the mall. Each has clues the seller can read (never demographics: only
// what they wear, carry, or how they talk), and a pool of real reasons to buy, one per run.
/** A clue, and where it is on the photo in percent: x and y are the centre, w and h the size. A clue you can only hear has none. */
export interface Clue { id: string; label: string; x: number; y: number; w: number; h: number; points: string }
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
  counter?: number;   // the price this guest names when bargaining, when it is fixed
  /** The clue that points to this motive. */
  clue: string;
  /** How many pens they take once the seller has found the need: a bulk order. */
  quantity?: number;
}
export interface Guest {
  id: string;
  name: string;
  role: string;
  avatarId: string;
  image: string;
  /** Where the seller finds them in the mall. */
  spotted: string;
  /** Their looks point the wrong way: only on the harder levels. */
  falseClue?: boolean;
  clues: Clue[];
  motives: Motive[];
}

export const GUESTS: Guest[] = [
  {
    id: 'ray', name: 'Ray', role: 'Site foreman', avatarId: '7b3e60f3-376f-477b-82e9-8f37baeb60e1', image: 'ray',
    spotted: 'Someone in a hi-vis vest, walking fast, clipboard in hand.',
    clues: [
      { id: 'pencil', label: 'Pencil behind the ear', x: 34, y: 19, w: 13, h: 17, points: 'He writes all day, and he has given up on pens.' },
      { id: 'vest', label: 'Hi-vis vest', x: 76, y: 68, w: 30, h: 36, points: 'He works outdoors, in the wet and the cold.' },
      { id: 'clipboard', label: 'Clipboard of site notes', x: 49, y: 93, w: 48, h: 21, points: 'Paper records he signs and has to trust.' },
    ],
    motives: [
      { id: 'weather', label: 'A pen that works outdoors in the wet', need: 'Pens die on you at work in the cold and the rain, so you use a pencil. A pen that writes on a wet clipboard would actually help.', top: 22, objection: "A pencil's free.", haggles: true, clue: 'pencil' },
      { id: 'signoff', label: 'A pen for permanent site sign-offs', need: 'Inspectors now refuse pencil on the safety sheets you sign off. You need ink that does not smudge in the rain.', top: 24, objection: 'Any cheap pen signs a sheet.', haggles: false, clue: 'clipboard' },
    ],
  },
  {
    id: 'marisol', name: 'Marisol', role: 'Night-shift nurse', avatarId: '82437255-abfc-4687-9fa6-8ab6b307a267', image: 'marisol',
    spotted: 'Someone in scrubs, walking slowly, looking half asleep.',
    clues: [
      { id: 'pens', label: 'Four cheap pens in the pocket', x: 67, y: 67, w: 17, h: 15, points: 'She carries spares because pens keep failing or vanishing.' },
      { id: 'eyes', label: 'Tired eyes', x: 51, y: 24, w: 28, h: 12, points: 'End of a long shift: she wants less hassle, not a speech.' },
      { id: 'lanyard', label: 'Staff lanyard', x: 61, y: 78, w: 12, h: 22, points: 'Hospital staff: she writes charts all night.' },
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
      { id: 'letters', label: 'Handwritten envelopes', x: 54, y: 93, w: 35, h: 16, points: 'He still writes letters by hand, every week.' },
      { id: 'glasses', label: 'Reading glasses on a chain', x: 52, y: 81, w: 31, h: 11, points: 'He reads and writes a lot, and small print matters to him.' },
      { id: 'hands', label: 'He takes his time', x: 0, y: 0, w: 0, h: 0, points: 'He tests whether you will listen before he buys.' },
    ],
    motives: [
      { id: 'letters', label: 'A better pen for his weekly letters', need: 'You write to your granddaughter every week, and it is the best hour you have. A pen that flows well would make it nicer.', top: 23, objection: "I've had mine thirty years.", haggles: false, clue: 'letters' },
      { id: 'grip', label: 'A comfortable grip for stiff hands', need: 'Your hands have grown stiff and thin pens hurt after a page. A wide soft grip would let you keep writing.', top: 25, objection: 'My old pen does the job.', haggles: true, clue: 'glasses' },
    ],
  },
  {
    id: 'helen', name: 'Helen', role: 'Partner at a law firm', avatarId: 'b9b62691-d3f8-4164-979d-531c1c236f76', image: 'helen',
    spotted: 'Someone in a tailored suit, leather folder in hand.',
    clues: [
      { id: 'clip', label: 'Silver pen in the breast pocket', x: 72, y: 80, w: 11, h: 17, points: 'She already cares what she writes with.' },
      { id: 'folder', label: 'Leather document folder', x: 49, y: 91, w: 50, h: 21, points: 'Papers to sign, in front of clients.' },
      { id: 'suit', label: 'Tailored suit', x: 24, y: 72, w: 26, h: 26, points: 'Appearances matter in her work.' },
    ],
    motives: [
      { id: 'clients', label: 'A pen that looks right in front of clients', need: 'Clients watch what you sign with at closings. Your good pen stays at the office, and you are often caught without it.', top: 25, objection: 'I own a Montblanc.', haggles: false, clue: 'folder' },
      { id: 'permanent', label: 'Ink that will not smudge on signed documents', need: 'A smudged signature on a contract cost you an afternoon last month. Ink that dries clean matters to you.', top: 24, objection: 'Any decent pen signs a contract.', haggles: true, clue: 'clip' },
    ],
  },
  {
    id: 'theo', name: 'Theo', role: 'Startup founder', avatarId: '528e3e99-d035-4065-80a2-07955f20e3e5', image: 'theo', falseClue: true,
    spotted: 'Someone in a worn hoodie, clutching a battered laptop.',
    clues: [
      { id: 'hoodie', label: 'Worn hoodie', x: 14, y: 76, w: 24, h: 24, points: 'A false clue: it reads as no budget, and he has plenty.' },
      { id: 'laptop', label: 'Stickered laptop', x: 48, y: 90, w: 72, h: 20, points: 'He is building something: a company, with a team.' },
      { id: 'earbuds', label: 'Earbuds in, between calls', x: 66, y: 40, w: 9, h: 12, points: 'Busy and in charge, with no time for small talk.' },
    ],
    motives: [
      { id: 'gifts', label: '40 welcome gifts for his team', need: 'Your company just hit forty people and you want a small gift for each of them this week. You have the budget and no time to shop.', top: 24, objection: 'Nobody uses pens.', haggles: true, counter: 20, clue: 'laptop', quantity: 40 },
    ],
  },
  {
    id: 'daniel', name: 'Daniel', role: 'Between jobs', avatarId: 'afb3f1b7-0ae2-4aa9-90ff-4c315926df34', image: 'daniel', falseClue: true,
    spotted: 'Someone in a sharp suit and a big steel watch.',
    clues: [
      { id: 'watch', label: 'Big steel watch', x: 54, y: 94, w: 14, h: 12, points: 'A false clue: it reads as easy money, and he is careful with every dollar.' },
      { id: 'resume', label: 'Folder of résumés', x: 52, y: 75, w: 46, h: 31, points: 'He is looking for work, not closing deals.' },
      { id: 'pause', label: 'He goes quiet about work', x: 0, y: 0, w: 0, h: 0, points: 'The confident voice stops when you ask what he does.' },
    ],
    motives: [
      { id: 'interview', label: 'A pen to look the part at an interview', need: 'You were laid off last month and have an interview tomorrow. You want to look like you still belong, but money is tight.', top: 14, objection: "What's your best price?", haggles: true, clue: 'resume' },
    ],
  },
];

export const guestById = (id: string) => GUESTS.find((g) => g.id === id);

// An avatar lives on one server: the same guests, built again on staging.
const STAGING_AVATARS: Record<string, string> = {
  ray: '02d68dc0-ae64-4eb7-919b-8bb7e3c1fd41',
  marisol: '34f57f93-c23e-4d0c-a3f7-0348d3927ed1',
  walter: '8761ba2a-71bf-4e05-a6cc-f82fc8a7f362',
  helen: '251ec953-1200-41f1-899d-fa2b62de4e9b',
  theo: '188fcfbc-2b13-4fdc-913d-6096b062a355',
  daniel: '0931603a-aa3b-4a17-8d26-92231daf3d03',
};

/** The guest's avatar on the server this app talks to. */
export const avatarIdOf = (guest: Guest, baseUrl = '') => (baseUrl.includes('staging') ? STAGING_AVATARS[guest.id] : guest.avatarId);

