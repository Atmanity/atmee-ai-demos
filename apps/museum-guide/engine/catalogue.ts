// The Meridian's catalogue: the only source of facts about a work. Edmund is
// told a work's record when the visitor scans its label or the camera finds
// it, and says nothing about it that the record does not.
//
// The Meridian is an invented museum. Its galleries hold eight famous
// public-domain works so that anyone can try the tour with the label sheet
// (?sheet): each record also says where the original hangs.

export interface Exhibit {
  id: string;
  title: string;
  /** Other names visitors use for it. */
  aka: string[];
  artist: string;
  date: string;
  medium: string;
  /** The Meridian's room, for directions. */
  gallery: string;
  /** Where the original hangs. */
  original: string;
  /** What the camera should see: for matching a photo, never said as a fact. */
  looks: string;
  /** The story, in short spoken sentences. */
  story: string[];
  /** Details to point at with words. */
  lookFor: string[];
  /** The work to suggest next. */
  next: string;
}

export const EXHIBITS: Exhibit[] = [
  {
    id: 'mona-lisa',
    title: 'Mona Lisa',
    aka: ['La Gioconda', 'La Joconde', 'Mona Lisa painting'],
    artist: 'Leonardo da Vinci',
    date: 'about 1503 to 1519',
    medium: 'oil on a poplar wood panel, 77 by 53 centimetres',
    gallery: 'Gallery 1, the Renaissance room',
    original: 'the Louvre, Paris',
    looks: 'Half-length portrait of a woman with dark hair and a faint smile, hands folded, a hazy winding landscape behind her.',
    story: [
      'The sitter is widely identified as Lisa Gherardini, the wife of a Florentine silk merchant, Francesco del Giocondo.',
      'Leonardo kept working on it for years and never handed it over to the family.',
      'He softened every edge with sfumato, thin glazes that melt light into shadow, which is why the smile seems to come and go.',
      'In 1911 it was stolen from the Louvre by Vincenzo Peruggia, a handyman who worked there, and it was recovered in Florence in 1913.',
    ],
    lookFor: ['the corners of her mouth, where the smile lives', 'the landscape behind her, with a winding road and a bridge', 'her hands, resting one over the other'],
    next: 'birth-of-venus',
  },
  {
    id: 'birth-of-venus',
    title: 'The Birth of Venus',
    aka: ['Nascita di Venere', 'Venus on the shell'],
    artist: 'Sandro Botticelli',
    date: 'about 1484 to 1486',
    medium: 'tempera on canvas, about 1.7 by 2.8 metres',
    gallery: 'Gallery 1, the Renaissance room',
    original: 'the Uffizi Gallery, Florence',
    looks: 'A nude goddess with long red-gold hair standing on a giant scallop shell at sea; winged wind figures blow from the left, a woman on the right holds out a flowered cloak.',
    story: [
      'Venus, the goddess of love, arrives at the shore on a scallop shell, fully grown from the sea.',
      'On the left, Zephyr, the west wind, blows her to land, carried with a female companion.',
      'On the right, one of the Horae, the goddesses of the seasons, rushes to wrap her in a cloak covered in flowers.',
      'It is painted in tempera, pigment bound with egg, which gives it that pale, chalky light.',
    ],
    lookFor: ['the roses drifting through the air around the wind gods', 'the scallop shell under her feet', 'her long hair, which she gathers to cover herself'],
    next: 'pearl-earring',
  },
  {
    id: 'pearl-earring',
    title: 'Girl with a Pearl Earring',
    aka: ['Meisje met de parel', 'the girl with the pearl'],
    artist: 'Johannes Vermeer',
    date: 'about 1665',
    medium: 'oil on canvas, 44.5 by 39 centimetres',
    gallery: 'Gallery 2, the Dutch Golden Age room',
    original: 'the Mauritshuis, The Hague',
    looks: 'A girl looking over her shoulder at the viewer, lips parted, wearing a blue and yellow turban and a large pearl earring, against a dark background.',
    story: [
      'It is not a portrait of a known person: it is a tronie, a Dutch study of a face, a character or an expression.',
      'Nobody knows who the girl was.',
      'The blue of her turban is ultramarine, made from ground lapis lazuli and more costly than gold.',
      'The earring is only a few brushstrokes of light with no hook painted at all, and some scholars think it is too large to be a real pearl.',
      'Research in 2018 found that a green curtain once hung behind her; it has faded into the dark background.',
    ],
    lookFor: ['the single highlight on the earring', 'the tiny white point of light in the corner of her lips', 'the ultramarine of the turban against the yellow cloth falling from it'],
    next: 'night-watch',
  },
  {
    id: 'night-watch',
    title: 'The Night Watch',
    aka: ['Militia Company of District II under the Command of Captain Frans Banninck Cocq', 'Nachtwacht'],
    artist: 'Rembrandt van Rijn',
    date: '1642',
    medium: 'oil on canvas, about 3.8 by 4.5 metres',
    gallery: 'Gallery 2, the Dutch Golden Age room',
    original: 'the Rijksmuseum, Amsterdam',
    looks: 'A huge, dark group painting of a militia company setting off: a captain in black with a red sash, a lieutenant in pale yellow, a girl lit up in gold, muskets, pikes and a banner.',
    story: [
      'It is a group portrait of a civic militia company, painted for the hall of the musketeers in Amsterdam.',
      'Rembrandt shows them in motion, setting off, instead of standing in neat rows like most group portraits of the time.',
      'It is not a night scene at all: darkened varnish made it look like night, and the nickname came later.',
      'In 1715 it was cut down on all sides to fit a wall in the Amsterdam town hall, so some figures were lost.',
    ],
    lookFor: ['the captain in black with a red sash, in the centre', 'the shadow of his hand on the lieutenant\'s yellow coat', 'the girl in gold on the left, with a chicken hanging from her belt'],
    next: 'wanderer',
  },
  {
    id: 'wanderer',
    title: 'Wanderer above the Sea of Fog',
    aka: ['Der Wanderer über dem Nebelmeer', 'man on the mountain'],
    artist: 'Caspar David Friedrich',
    date: 'about 1818',
    medium: 'oil on canvas, 94.8 by 74.8 centimetres',
    gallery: 'Gallery 3, the Romantic and Modern room',
    original: 'the Hamburger Kunsthalle, Hamburg',
    looks: 'A man in a dark coat seen from behind, standing on a rocky peak with a walking stick, looking out over a landscape covered in fog with distant mountains.',
    story: [
      'It is one of the great images of German Romanticism.',
      'Friedrich often painted a figure from behind, so that we stand where he stands and look with him.',
      'The rocks and peaks come from sketches of real mountains, the Elbe Sandstone Mountains in Saxony, put together into a landscape that exists nowhere.',
    ],
    lookFor: ['the figure\'s back, right in the centre', 'his walking stick', 'the layers of fog between the peaks'],
    next: 'starry-night',
  },
  {
    id: 'starry-night',
    title: 'The Starry Night',
    aka: ['Starry Night', 'De sterrennacht'],
    artist: 'Vincent van Gogh',
    date: 'June 1889',
    medium: 'oil on canvas, 73.7 by 92.1 centimetres',
    gallery: 'Gallery 3, the Romantic and Modern room',
    original: 'the Museum of Modern Art, New York',
    looks: 'A swirling blue night sky with a yellow crescent moon and glowing stars over a small village with a church spire, a dark flame-like cypress tree on the left.',
    story: [
      'Van Gogh painted it while he was staying at the asylum of Saint-Paul-de-Mausole, in Saint-Rémy-de-Provence.',
      'It is the view from his east-facing window, just before sunrise.',
      'He wrote to his brother Theo that he had seen the countryside from his window before dawn, with nothing but the morning star, which looked very big.',
      'The village is not in the view from his window: he added it from imagination.',
    ],
    lookFor: ['the great swirl in the middle of the sky', 'the dark cypress on the left, rising like a flame', 'the church spire in the village'],
    next: 'the-kiss',
  },
  {
    id: 'the-kiss',
    title: 'The Kiss',
    aka: ['Der Kuss', 'Lovers'],
    artist: 'Gustav Klimt',
    date: '1907 to 1908',
    medium: 'oil and gold leaf on canvas, 180 by 180 centimetres',
    gallery: 'Gallery 3, the Romantic and Modern room',
    original: 'the Belvedere, Vienna',
    looks: 'A square golden painting of an embracing couple in patterned golden robes, kneeling on a meadow of flowers.',
    story: [
      'It comes from what is called Klimt\'s golden period, when he laid real gold leaf into his paintings.',
      'The Austrian state bought it in 1908, when it was first shown in Vienna.',
      'The two lovers are wrapped in one golden cloak, but their patterns stay apart.',
    ],
    lookFor: ['the man\'s robe of black and white rectangles', 'the woman\'s robe of circles and flowers', 'the edge of the flower meadow under her feet, where it drops away'],
    next: 'great-wave',
  },
  {
    id: 'great-wave',
    title: 'The Great Wave off Kanagawa',
    aka: ['Under the Wave off Kanagawa', 'Kanagawa oki nami ura', 'the great wave'],
    artist: 'Katsushika Hokusai',
    date: 'about 1830 to 1832',
    medium: 'a colour woodblock print, ink and colour on paper, about 26 by 38 centimetres',
    gallery: 'Gallery 4, the Japanese print room',
    original: 'many museums, since it was printed in thousands of copies; one is in the Metropolitan Museum of Art, New York',
    looks: 'A Japanese woodblock print of an enormous blue and white wave with claw-like foam curling over three long boats, a small snow-capped Mount Fuji in the distance.',
    story: [
      'It is the most famous print in Hokusai\'s series Thirty-six Views of Mount Fuji.',
      'Hokusai was about seventy when he made it.',
      'The deep blue is Prussian blue, a pigment that had only just begun to arrive in Japan.',
      'Because it is a woodblock print, thousands of copies were pulled from the same carved blocks, and it sold cheaply at the time.',
    ],
    lookFor: ['Mount Fuji, tiny, in the hollow of the wave', 'the foam at the crest, curling like claws', 'the rowers crouched in the three boats'],
    next: 'mona-lisa',
  },
];

const byId = new Map(EXHIBITS.map((e) => [e.id, e]));

export const exhibitById = (id: string | null | undefined): Exhibit | null => (id ? byId.get(id) ?? null : null);

const words = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'of', 'off', 'by', 'with', 'above', 'under', 'painting', 'picture', 'print', 'one', 'that', 'this']);
const keyWords = (text: string) => words(text).split(' ').filter((w) => w && !STOP.has(w));

/**
 * The work some words name: "the Mona Lisa", "Vermeer's girl", "starry night",
 * "the wave". By id, title, other names or artist; the best overlap of the
 * words that matter wins. Null when nothing fits.
 */
export function findExhibit(text: string): Exhibit | null {
  const asked = words(text);
  if (!asked) return null;
  if (byId.has(asked.replace(/ /g, '-'))) return byId.get(asked.replace(/ /g, '-'))!;
  const wanted = new Set(keyWords(text));
  let best: { exhibit: Exhibit; score: number } | null = null;
  for (const exhibit of EXHIBITS) {
    const names = [exhibit.title, ...exhibit.aka];
    if (names.some((n) => words(n) === asked)) return exhibit;
    const surname = words(exhibit.artist).split(' ').pop()!;
    const vocabulary = new Set([...names.flatMap(keyWords), surname]);
    const hits = [...wanted].filter((w) => vocabulary.has(w) || vocabulary.has(w.replace(/s$/, ''))).length;
    const score = hits / Math.max(1, wanted.size);
    if (hits && (!best || score > best.score)) best = { exhibit, score };
  }
  return best && best.score >= 0.34 ? best.exhibit : null;
}

/** A work's catalogue record as Edmund is given it. */
export function recordText(e: Exhibit): string {
  return [
    `"${e.title}" by ${e.artist}, ${e.date}; ${e.medium}.`,
    `At the Meridian: ${e.gallery}. The original hangs in ${e.original}.`,
    `Story: ${e.story.join(' ')}`,
    `Look for: ${e.lookFor.join('; ')}.`,
    `Suggested next: "${exhibitById(e.next)?.title}" (${exhibitById(e.next)?.gallery}).`,
  ].join('\n');
}
