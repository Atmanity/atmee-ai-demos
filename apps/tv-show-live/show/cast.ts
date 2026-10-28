// The Gilded Reel's cast and tonight's film. Everything here is invented: the
// show, the host, the film AMBERFALL and its designer.
//
// Jada has two cameras, two avatars of the same set: camera 1 facing the lens
// (studio/cam1.jpg), camera 2 turned toward her guest (studio/cam2.jpg).
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
