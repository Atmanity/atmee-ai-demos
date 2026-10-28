// The Gilded Reel's cast and tonight's film. Everything here is invented: the
// show, the host, the film AMBERFALL and its designer.
//
// The studio is one picture (studio/plate.jpg): an art-deco set with the host
// at her desk and a screen built into the back wall. Both of the host's faces
// are crops of that picture at STUDIO.host, so her live video sits exactly
// where she sits in the set; the screen's picture goes in at STUDIO.screen.
// AVATAR_TV_SHOW_LIVE swaps the host (avatar.json), AVATAR_TV_SHOW_LIVE_GUEST_<ID> a guest.
export interface Guest {
  id: string;
  name: string;
  /** How the host bills them, and where they are calling from. */
  billing: string;
  from: string;
  avatarId: string;
  rundown: string[];
}

export const SHOW = 'The Gilded Reel';
export const HOST = { name: 'Jada Monroe', billing: 'Host, The Gilded Reel' };
/**
 * Camera 1: Jada facing the lens, for when she speaks to the viewers. A face
 * only (a render of her voice; her conversation runs on the host avatar).
 * AVATAR_TV_SHOW_LIVE_FRONT swaps it.
 */
export const HOST_FRONT_AVATAR = 'bdaf5bd3-1698-4bc2-abfe-a26c69156794';

/** Where things are in the studio picture, in percent of its width and height. */
export const STUDIO = {
  /** The host's square: the crop both of her portraits were cut from (130, 250, 320 of 1376 × 768). */
  host: { left: 9.448, top: 32.552, width: 23.256, height: 41.667 },
  /** The screen in the back wall (748–1145 × 222–456 of 1376 × 768), grown a pixel each way to cover its edge. */
  screen: { left: 54.29, top: 28.78, width: 29.07, height: 30.86 },
};

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
    id: 'ines',
    name: 'Inès Valcour',
    billing: `costume and production designer of ${FILM.title}`,
    from: 'her atelier',
    avatarId: '5190aed1-124c-4447-adb8-7045d8b35fb1',
    rundown: ["The queen's amber veil", 'Four hundred caravan robes', 'Building the salt-glass monoliths', 'The glass palace and its lanterns'],
  },
];

export const guestById = (id: string) => GUESTS.find((g) => g.id === id);
export const firstName = (name: string) => name.split(' ')[0];
