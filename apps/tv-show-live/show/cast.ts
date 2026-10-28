// The Late Line's cast: invented characters made for this show. The host's
// portrait is the studio, turned toward the big screen at her left; the guests
// call in from home and appear on that screen. AVATAR_TV_SHOW_LIVE swaps the host (avatar.json),
// AVATAR_TV_SHOW_LIVE_GUEST_<ID> a guest.
export interface Guest {
  id: string;
  name: string;
  /** How the host bills them, and where they are calling from. */
  billing: string;
  from: string;
  avatarId: string;
  rundown: string[];
}

export const HOST = { name: 'Jada Monroe', billing: 'Host, The Late Line' };
export const SHOW = 'The Late Line';

export const GUESTS: Guest[] = [
  {
    id: 'otto',
    name: 'Otto Brandt',
    billing: 'inventor of magnificent, mostly useless machines',
    from: 'his workshop above a bakery',
    avatarId: '9b4228cf-ca32-4b2a-8ac3-4cba3cd4e7c7',
    rundown: ['The Singing Toaster', 'The Umbrella That Remembers', 'Bernoulli the cat and his office', 'Fifty years of magnificent failure'],
  },
  {
    id: 'rosa',
    name: 'Rosa Quintero',
    billing: 'big-wave surfer turned taco-stand owner',
    from: 'her taco stand on Playa Larga',
    avatarId: '8c20336d-cbf8-4054-8013-be5b2af38835',
    rundown: ['The wave they called La Bestia', 'Why she quit competing', 'The secret mango salsa', 'Chancla, the napkin guard'],
  },
];

export const guestById = (id: string) => GUESTS.find((g) => g.id === id);
export const firstName = (name: string) => name.split(' ')[0];
