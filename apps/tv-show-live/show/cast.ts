// The Gilded Reel's cast and tonight's film. Everything here is invented: the
// show, the host, the film AMBERFALL and its designer.
//
// Jada is one avatar: her conversation and her one render, turned toward the TV
// (studio/cam2.jpg). The page frames that render as the wide shot or a close-up.
// AVATAR_TV_SHOW_LIVE swaps the host (avatar.json), AVATAR_TV_SHOW_LIVE_GUEST_<ID> a guest.
export interface Guest {
  id: string;
  name: string;
  /** How the host bills them, and where they are calling from. */
  billing: string;
  from: string;
  avatarId: string;
  rundown: string[];
  /** On call: not an opening guest, but ready to join when the booth invites someone in this role. */
  onCall?: boolean;
}

export const SHOW = 'The Gilded Reel';
export const HOST = { name: 'Jada Monroe', billing: 'Host, The Gilded Reel' };

export const FILM = {
  title: 'AMBERFALL',
  logline: 'a desert epic on a world of moving amber dunes and colossal salt-glass monoliths, where a queen leads her caravan across the desert to the glass palace of her ancestors',
  /** The trailer: each still is held and pushed in on, with its card (if any) over it. */
  trailer: [
    { still: 1, card: '' },
    { still: 2, card: 'This winter' },
    { still: 3, card: 'Every empire' },
    { still: 4, card: 'is made of sand' },
    { still: 5, card: 'AMBERFALL', title: true },
  ],
};

export const GUESTS: Guest[] = [
  {
    id: 'theo',
    name: 'Theo Marlowe',
    billing: `costume and production designer of ${FILM.title}`,
    from: 'his atelier',
    avatarId: '5190aed1-124c-4447-adb8-7045d8b35fb1',
    rundown: ["The queen's amber veil", 'Four hundred caravan robes', 'Building the salt-glass monoliths', 'The glass palace and its lanterns'],
  },
  {
    // Built ahead of the show: an avatar built during it shares the render GPUs with the faces on air,
    // and their pictures jump and drift while it builds.
    id: 'mireille',
    name: 'Mireille Sunder',
    billing: `director of ${FILM.title}`,
    from: 'her stone workshop in Biarritz',
    avatarId: 'a779f510-caaf-4307-aa5d-4a933a9310b8',
    rundown: ['Taming the shifting amber dunes', 'Sculpting monoliths from rock salt', 'Filming in the twilight windows', "The queen's caravan in motion"],
    onCall: true,
  },
];

/** The on-call guest an invitation names, by the role in their billing ("the director"). */
export const onCallFor = (description: string, exclude: string[] = []) =>
  GUESTS.find((g) => g.onCall && !exclude.includes(g.id) && description.toLowerCase().includes(g.billing.split(' of ')[0].toLowerCase().split(' ').pop()!));

export const guestById = (id: string) => GUESTS.find((g) => g.id === id);
export const firstName = (name: string) => name.split(' ')[0];
