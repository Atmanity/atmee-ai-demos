// The sky's content: bright stars, constellation figures, and what to say.
// Ported from the original `catalog.py`; the tables are copied row for row.
//
// Hand-authored and STATIC: a bright-star catalogue has not changed in a human
// lifetime, and there is no network here. Positions are J2000 right ascension
// in decimal HOURS and declination in decimal DEGREES; magnitude is visual,
// smaller is brighter (Sirius is -1.46). No proper motion and no precession:
// over a human lifetime both are far below the half-degree a star is drawn at.
//
// `FACTS` is the app's content, and the reason the guide is forbidden from
// answering about a star out of the model's memory: everything the avatar says
// about a star has to come from here, where it can be read and corrected.
//
// There is ONE copy of this, and every sky the app shows or tells is computed
// from it by one SkyChart (chart.ts): the chart on screen, the avatar's state
// and every event are projections of the same snapshot, so the guide can never
// describe a sky the user is not looking at.

export interface Star { id: string; name: string; raH: number; decDeg: number; mag: number; con: string }

/** [id, name, ra_hours, dec_degrees, magnitude, constellation abbreviation].
 *  Roughly the naked-eye sky: every star brighter than about magnitude 2.7,
 *  plus the fainter ones needed to draw a figure that would otherwise have a
 *  hole in it (the Little Dipper is mostly fourth magnitude). */
const ROWS: [string, string, number, number, number, string][] = [
  ['sirius', 'Sirius', 6.7525, -16.716, -1.46, 'CMa'],
  ['canopus', 'Canopus', 6.3992, -52.696, -0.74, 'Car'],
  ['rigil_kentaurus', 'Rigil Kentaurus', 14.66, -60.834, -0.27, 'Cen'],
  ['arcturus', 'Arcturus', 14.261, 19.182, -0.05, 'Boo'],
  ['vega', 'Vega', 18.6156, 38.784, 0.03, 'Lyr'],
  ['capella', 'Capella', 5.2782, 45.998, 0.08, 'Aur'],
  ['rigel', 'Rigel', 5.2423, -8.202, 0.13, 'Ori'],
  ['procyon', 'Procyon', 7.655, 5.225, 0.34, 'CMi'],
  ['achernar', 'Achernar', 1.6286, -57.237, 0.46, 'Eri'],
  ['betelgeuse', 'Betelgeuse', 5.9195, 7.407, 0.5, 'Ori'],
  ['hadar', 'Hadar', 14.0637, -60.373, 0.61, 'Cen'],
  ['altair', 'Altair', 19.8464, 8.868, 0.76, 'Aql'],
  ['acrux', 'Acrux', 12.4433, -63.099, 0.76, 'Cru'],
  ['aldebaran', 'Aldebaran', 4.5987, 16.509, 0.86, 'Tau'],
  ['antares', 'Antares', 16.4901, -26.432, 0.96, 'Sco'],
  ['spica', 'Spica', 13.4199, -11.161, 1.04, 'Vir'],
  ['pollux', 'Pollux', 7.7553, 28.026, 1.14, 'Gem'],
  ['fomalhaut', 'Fomalhaut', 22.9608, -29.622, 1.16, 'PsA'],
  ['deneb', 'Deneb', 20.6905, 45.28, 1.25, 'Cyg'],
  ['mimosa', 'Mimosa', 12.7953, -59.689, 1.25, 'Cru'],
  ['regulus', 'Regulus', 10.1395, 11.967, 1.35, 'Leo'],
  ['adhara', 'Adhara', 6.977, -28.972, 1.5, 'CMa'],
  ['castor', 'Castor', 7.5767, 31.888, 1.58, 'Gem'],
  ['shaula', 'Shaula', 17.5601, -37.104, 1.62, 'Sco'],
  ['gacrux', 'Gacrux', 12.5194, -57.113, 1.63, 'Cru'],
  ['bellatrix', 'Bellatrix', 5.4188, 6.35, 1.64, 'Ori'],
  ['elnath', 'Elnath', 5.4382, 28.608, 1.65, 'Tau'],
  ['miaplacidus', 'Miaplacidus', 9.22, -69.717, 1.67, 'Car'],
  ['alnilam', 'Alnilam', 5.6036, -1.202, 1.69, 'Ori'],
  ['alnair', 'Alnair', 22.1372, -46.961, 1.74, 'Gru'],
  ['alnitak', 'Alnitak', 5.6793, -1.943, 1.77, 'Ori'],
  ['alioth', 'Alioth', 12.9005, 55.96, 1.77, 'UMa'],
  ['dubhe', 'Dubhe', 11.0621, 61.751, 1.79, 'UMa'],
  ['mirfak', 'Mirfak', 3.4054, 49.861, 1.79, 'Per'],
  ['regor', 'Regor', 8.1587, -47.337, 1.83, 'Vel'],
  ['wezen', 'Wezen', 7.1399, -26.393, 1.83, 'CMa'],
  ['kaus_australis', 'Kaus Australis', 18.4029, -34.385, 1.85, 'Sgr'],
  ['sargas', 'Sargas', 17.622, -42.998, 1.86, 'Sco'],
  ['avior', 'Avior', 8.3752, -59.51, 1.86, 'Car'],
  ['alkaid', 'Alkaid', 13.7923, 49.313, 1.86, 'UMa'],
  ['menkalinan', 'Menkalinan', 5.9924, 44.947, 1.9, 'Aur'],
  ['atria', 'Atria', 16.811, -69.028, 1.91, 'TrA'],
  ['alhena', 'Alhena', 6.6285, 16.399, 1.93, 'Gem'],
  ['peacock', 'Peacock', 20.4275, -56.735, 1.94, 'Pav'],
  ['delta_velorum', 'Delta Velorum', 8.7451, -54.709, 1.96, 'Vel'],
  ['mirzam', 'Mirzam', 6.3783, -17.956, 1.98, 'CMa'],
  ['alphard', 'Alphard', 9.4598, -8.659, 1.98, 'Hya'],
  ['polaris', 'Polaris', 2.5303, 89.264, 1.98, 'UMi'],
  ['hamal', 'Hamal', 2.1195, 23.462, 2.0, 'Ari'],
  ['diphda', 'Diphda', 0.7265, -17.987, 2.04, 'Cet'],
  ['nunki', 'Nunki', 18.9211, -26.297, 2.05, 'Sgr'],
  ['menkent', 'Menkent', 14.1114, -36.37, 2.06, 'Cen'],
  ['mirach', 'Mirach', 1.1622, 35.621, 2.06, 'And'],
  ['alpheratz', 'Alpheratz', 0.1398, 29.091, 2.06, 'And'],
  ['saiph', 'Saiph', 5.7959, -9.67, 2.06, 'Ori'],
  ['algieba', 'Algieba', 10.3329, 19.841, 2.08, 'Leo'],
  ['rasalhague', 'Rasalhague', 17.5822, 12.56, 2.08, 'Oph'],
  ['kochab', 'Kochab', 14.8451, 74.156, 2.08, 'UMi'],
  ['algol', 'Algol', 3.1361, 40.956, 2.12, 'Per'],
  ['denebola', 'Denebola', 11.8177, 14.572, 2.14, 'Leo'],
  ['tiaki', 'Tiaki', 22.7113, -46.885, 2.15, 'Gru'],
  ['muhlifain', 'Muhlifain', 12.6919, -48.96, 2.2, 'Cen'],
  ['aspidiske', 'Aspidiske', 9.285, -59.275, 2.21, 'Car'],
  ['naos', 'Naos', 8.0597, -40.003, 2.21, 'Pup'],
  ['alphecca', 'Alphecca', 15.5781, 26.715, 2.22, 'CrB'],
  ['suhail', 'Suhail', 9.1332, -43.433, 2.23, 'Vel'],
  ['mintaka', 'Mintaka', 5.5334, -0.299, 2.23, 'Ori'],
  ['sadr', 'Sadr', 20.3705, 40.257, 2.23, 'Cyg'],
  ['eltanin', 'Eltanin', 17.9435, 51.489, 2.23, 'Dra'],
  ['mizar', 'Mizar', 13.3988, 54.925, 2.23, 'UMa'],
  ['schedar', 'Schedar', 0.6751, 56.537, 2.24, 'Cas'],
  ['almach', 'Almach', 2.065, 42.33, 2.26, 'And'],
  ['caph', 'Caph', 0.1531, 59.15, 2.28, 'Cas'],
  ['dschubba', 'Dschubba', 16.0055, -22.622, 2.29, 'Sco'],
  ['larawag', 'Larawag', 16.836, -34.293, 2.29, 'Sco'],
  ['merak', 'Merak', 11.0307, 56.382, 2.37, 'UMa'],
  ['izar', 'Izar', 14.7498, 27.074, 2.37, 'Boo'],
  ['ankaa', 'Ankaa', 0.4381, -42.306, 2.38, 'Phe'],
  ['enif', 'Enif', 21.7364, 9.875, 2.38, 'Peg'],
  ['girtab', 'Girtab', 17.7089, -39.03, 2.39, 'Sco'],
  ['scheat', 'Scheat', 23.0629, 28.083, 2.42, 'Peg'],
  ['sabik', 'Sabik', 17.173, -15.725, 2.43, 'Oph'],
  ['phecda', 'Phecda', 11.8972, 53.695, 2.44, 'UMa'],
  ['aludra', 'Aludra', 7.4014, -29.303, 2.45, 'CMa'],
  ['alderamin', 'Alderamin', 21.3096, 62.586, 2.45, 'Cep'],
  ['markab', 'Markab', 23.0793, 15.205, 2.49, 'Peg'],
  ['navi', 'Navi', 0.9451, 60.717, 2.47, 'Cas'],
  ['markeb', 'Markeb', 9.368, -55.011, 2.47, 'Vel'],
  ['aljanah', 'Aljanah', 20.7702, 33.97, 2.48, 'Cyg'],
  ['menkar', 'Menkar', 3.038, 4.09, 2.53, 'Cet'],
  ['zosma', 'Zosma', 11.2351, 20.524, 2.56, 'Leo'],
  ['acrab', 'Acrab', 16.0906, -19.805, 2.56, 'Sco'],
  ['gienah', 'Gienah', 12.2634, -17.542, 2.59, 'Crv'],
  ['ascella', 'Ascella', 19.0436, -29.88, 2.6, 'Sgr'],
  ['zubeneschamali', 'Zubeneschamali', 15.283, -9.383, 2.61, 'Lib'],
  ['unukalhai', 'Unukalhai', 15.7378, 6.426, 2.63, 'Ser'],
  ['sheratan', 'Sheratan', 1.9106, 20.808, 2.64, 'Ari'],
  ['kraz', 'Kraz', 12.5736, -23.397, 2.65, 'Crv'],
  ['muphrid', 'Muphrid', 13.9114, 18.398, 2.68, 'Boo'],
  ['ruchbah', 'Ruchbah', 1.4303, 60.235, 2.68, 'Cas'],
  ['kaus_media', 'Kaus Media', 18.3499, -29.828, 2.7, 'Sgr'],
  ['tarazed', 'Tarazed', 19.7709, 10.613, 2.72, 'Aql'],
  ['porrima', 'Porrima', 12.6943, -1.449, 2.74, 'Vir'],
  ['zubenelgenubi', 'Zubenelgenubi', 14.8479, -16.042, 2.75, 'Lib'],
  ['kornephoros', 'Kornephoros', 16.5036, 21.49, 2.78, 'Her'],
  ['rastaban', 'Rastaban', 17.5072, 52.301, 2.79, 'Dra'],
  ['delta_crucis', 'Delta Crucis', 12.2528, -58.749, 2.79, 'Cru'],
  ['kaus_borealis', 'Kaus Borealis', 18.4661, -25.422, 2.81, 'Sgr'],
  ['zeta_herculis', 'Zeta Herculis', 16.6882, 31.603, 2.81, 'Her'],
  ['vindemiatrix', 'Vindemiatrix', 13.0362, 10.959, 2.83, 'Vir'],
  ['algenib', 'Algenib', 0.2206, 15.184, 2.83, 'Peg'],
  ['alcyone', 'Alcyone', 3.7914, 24.105, 2.87, 'Tau'],
  ['fawaris', 'Fawaris', 19.7495, 45.131, 2.87, 'Cyg'],
  ['ras_elased', 'Ras Elased', 9.764, 23.774, 2.98, 'Leo'],
  ['zeta_tauri', 'Zeta Tauri', 5.6273, 21.143, 3.0, 'Tau'],
  ['seginus', 'Seginus', 14.5348, 38.308, 3.03, 'Boo'],
  ['albireo', 'Albireo', 19.5121, 27.96, 3.05, 'Cyg'],
  ['pherkad', 'Pherkad', 15.3453, 71.834, 3.05, 'UMi'],
  ['megrez', 'Megrez', 12.2571, 57.033, 3.31, 'UMa'],
  ['chertan', 'Chertan', 11.2372, 15.43, 3.32, 'Leo'],
  ['tau_sagittarii', 'Tau Sagittarii', 19.1153, -27.67, 3.32, 'Sgr'],
  ['sulafat', 'Sulafat', 18.9824, 32.69, 3.24, 'Lyr'],
  ['phi_sagittarii', 'Phi Sagittarii', 18.746, -26.991, 3.17, 'Sgr'],
  ['wasat', 'Wasat', 7.3353, 21.982, 3.53, 'Gem'],
  ['meissa', 'Meissa', 5.5855, 9.934, 3.39, 'Ori'],
  ['segin', 'Segin', 1.9065, 63.67, 3.35, 'Cas'],
  ['sheliak', 'Sheliak', 18.834, 33.363, 3.52, 'Lyr'],
  ['nekkar', 'Nekkar', 15.032, 40.39, 3.49, 'Boo'],
  ['alshain', 'Alshain', 19.9219, 6.407, 3.71, 'Aql'],
  ['zeta_lyrae', 'Zeta Lyrae', 18.7461, 37.605, 4.36, 'Lyr'],
  ['delta_lyrae', 'Delta Lyrae', 18.9083, 36.899, 4.3, 'Lyr'],
  ['yildun', 'Yildun', 17.5369, 86.586, 4.35, 'UMi'],
  ['epsilon_ursae_minoris', 'Epsilon Ursae Minoris', 16.7661, 82.037, 4.21, 'UMi'],
  ['zeta_ursae_minoris', 'Zeta Ursae Minoris', 15.7345, 77.794, 4.29, 'UMi'],
  ['eta_ursae_minoris', 'Eta Ursae Minoris', 16.2917, 75.755, 4.95, 'UMi'],
];

/** Full names of the constellations a star can belong to. Every abbreviation in
 *  the rows appears here; a missing one would leave the panel printing "CMa". */
export const CONSTELLATION_NAMES: Record<string, string> = {
  And: "Andromeda", Aql: "Aquila", Ari: "Aries", Aur: "Auriga",
  Boo: "Boötes", CMa: "Canis Major", CMi: "Canis Minor", Car: "Carina",
  Cas: "Cassiopeia", Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus",
  CrB: "Corona Borealis", Crv: "Corvus", Cru: "Crux", Cyg: "Cygnus",
  Dra: "Draco", Eri: "Eridanus", Gem: "Gemini", Gru: "Grus",
  Her: "Hercules", Hya: "Hydra", Leo: "Leo", Lib: "Libra",
  Lyr: "Lyra", Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo",
  Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", PsA: "Piscis Austrinus",
  Pup: "Puppis", Sco: "Scorpius", Ser: "Serpens", Sgr: "Sagittarius",
  Tau: "Taurus", TrA: "Triangulum Australe", UMa: "Ursa Major", UMi: "Ursa Minor",
  Vel: "Vela", Vir: "Virgo",
};

/** The joined-up figures, as pairs of star ids. Only these can be lit: a
 *  constellation with no figure is refused rather than drawn as nothing while
 *  the avatar says it is on screen. Every id must exist in the rows (tested):
 *  a typo silently drops one line out of a shape. */
export const FIGURES: Record<string, [string, string][]> = {
  Ori: [['betelgeuse', 'bellatrix'], ['bellatrix', 'mintaka'], ['mintaka', 'alnilam'], ['alnilam', 'alnitak'], ['alnitak', 'saiph'], ['saiph', 'rigel'], ['rigel', 'mintaka'], ['betelgeuse', 'alnitak'], ['betelgeuse', 'meissa'], ['meissa', 'bellatrix']],
  UMa: [['dubhe', 'merak'], ['merak', 'phecda'], ['phecda', 'megrez'], ['megrez', 'dubhe'], ['megrez', 'alioth'], ['alioth', 'mizar'], ['mizar', 'alkaid']],
  UMi: [['polaris', 'yildun'], ['yildun', 'epsilon_ursae_minoris'], ['epsilon_ursae_minoris', 'zeta_ursae_minoris'], ['zeta_ursae_minoris', 'kochab'], ['kochab', 'pherkad'], ['pherkad', 'eta_ursae_minoris'], ['eta_ursae_minoris', 'zeta_ursae_minoris']],
  Cas: [['segin', 'ruchbah'], ['ruchbah', 'navi'], ['navi', 'schedar'], ['schedar', 'caph']],
  Cyg: [['deneb', 'sadr'], ['sadr', 'albireo'], ['aljanah', 'sadr'], ['sadr', 'fawaris']],
  Cru: [['acrux', 'gacrux'], ['mimosa', 'delta_crucis']],
  Leo: [['regulus', 'algieba'], ['algieba', 'ras_elased'], ['regulus', 'chertan'], ['chertan', 'denebola'], ['denebola', 'zosma'], ['zosma', 'algieba'], ['chertan', 'zosma']],
  Sco: [['acrab', 'dschubba'], ['dschubba', 'antares'], ['antares', 'larawag'], ['larawag', 'sargas'], ['sargas', 'girtab'], ['girtab', 'shaula']],
  Lyr: [['vega', 'zeta_lyrae'], ['zeta_lyrae', 'sheliak'], ['sheliak', 'sulafat'], ['sulafat', 'delta_lyrae'], ['delta_lyrae', 'zeta_lyrae']],
  Tau: [['elnath', 'aldebaran'], ['zeta_tauri', 'aldebaran'], ['aldebaran', 'alcyone']],
  Gem: [['castor', 'pollux'], ['pollux', 'wasat'], ['wasat', 'alhena']],
  CMa: [['sirius', 'mirzam'], ['sirius', 'wezen'], ['wezen', 'adhara'], ['wezen', 'aludra'], ['adhara', 'sirius']],
  Sgr: [['kaus_borealis', 'kaus_media'], ['kaus_media', 'kaus_australis'], ['kaus_australis', 'ascella'], ['ascella', 'tau_sagittarii'], ['tau_sagittarii', 'nunki'], ['nunki', 'phi_sagittarii'], ['phi_sagittarii', 'kaus_media'], ['nunki', 'ascella']],
  Peg: [['markab', 'scheat'], ['scheat', 'alpheratz'], ['alpheratz', 'algenib'], ['algenib', 'markab'], ['markab', 'enif']],
  And: [['alpheratz', 'mirach'], ['mirach', 'almach']],
  Boo: [['arcturus', 'izar'], ['izar', 'nekkar'], ['nekkar', 'seginus'], ['seginus', 'arcturus'], ['arcturus', 'muphrid']],
  Aql: [['altair', 'tarazed'], ['altair', 'alshain']],
  Cen: [['rigil_kentaurus', 'hadar'], ['hadar', 'muhlifain'], ['muhlifain', 'menkent']],
};

/** Two lines at most per star, and only for the ones worth stopping at. The
 *  guide is told never to answer about a star from its own memory, so anything
 *  it says about one has to be readable here. */
export const FACTS: Record<string, string[]> = {
  sirius: [
    "The brightest star in the night sky, and one of the closest — about eight and a half light years away.",
    "It twinkles violently when it is low, because it is bright enough to show what the air is doing.",
  ],
  canopus: [
    "The second brightest star, and a genuine giant — far away and enormously luminous.",
    "Spacecraft have used it as a navigation reference for exactly that reason.",
  ],
  polaris: [
    "The pole star: it sits almost exactly above the Earth's north axis, so it barely moves all night.",
    "Its height above the horizon is your latitude, which is how sailors found their way north of the equator.",
  ],
  betelgeuse: [
    "A red supergiant so large it would swallow the orbit of Mars.",
    "It is near the end of its life and will end as a supernova — though nobody can say in which century.",
  ],
  rigel: [
    "A blue supergiant, and the brightest star in Orion despite being the beta star.",
    "It is far more luminous than Betelgeuse and much hotter, which is why it looks blue-white.",
  ],
  vega: [
    "The bright blue-white star overhead on northern summer nights, in the Summer Triangle.",
    "It was the pole star twelve thousand years ago and will be again in another fourteen thousand.",
  ],
  arcturus: [
    "An orange giant, the brightest star in the northern half of the sky.",
    "You find it by following the curve of the Plough's handle — arc to Arcturus.",
  ],
  capella: [
    "Actually two yellow giant stars orbiting closely, which is why it looks so steady and golden.",
    "It is far enough north to never set from most of Europe and northern Asia.",
  ],
  antares: [
    "The red heart of the Scorpion — a supergiant whose name means the rival of Mars.",
    "The two do look alike when Mars is nearby, which is where the name came from.",
  ],
  aldebaran: [
    "The orange eye of Taurus, sitting in front of the Hyades cluster but not part of it.",
    "It is a giant star, well along in life and swollen.",
  ],
  spica: [
    "A hot blue pair of stars so close together they are pulled into egg shapes.",
    "Follow the arc of the Plough past Arcturus and you spike Spica.",
  ],
  deneb: [
    "The tail of the Swan, and one of the most luminous stars anyone can see with the eye.",
    "It looks ordinary only because it is so remarkably far away.",
  ],
  altair: [
    "It spins so fast — a full rotation in about nine hours — that it is visibly flattened.",
    "The third corner of the Summer Triangle, with Vega and Deneb.",
  ],
  regulus: [
    "The heart of the Lion, and it sits almost exactly on the path the Sun and planets follow.",
    "So the Moon passes close to it, and sometimes right in front of it.",
  ],
  procyon: [
    "One of our nearest neighbours, about eleven light years away.",
  ],
  fomalhaut: [
    "Alone in a bare patch of autumn sky, which earned it the name the solitary one.",
    "It is ringed by a vast belt of dust that has been photographed directly.",
  ],
  acrux: [
    "The brightest star of the Southern Cross, and the southernmost first-magnitude star.",
    "Nothing this bright is ever seen from far northern latitudes.",
  ],
  rigil_kentaurus: [
    "The nearest star system to the Sun, about four light years away.",
    "A small red companion in the same system, Proxima, is nearer still.",
  ],
  algol: [
    "The Demon Star: it dims noticeably every two days and twenty-one hours.",
    "A dimmer companion passes in front of it, and people noticed long before anyone knew why.",
  ],
  mizar: [
    "A double star you can split with good eyesight — Mizar and its faint neighbour Alcor.",
    "It was the first star ever photographed as a double, and each half is itself a pair.",
  ],
  castor: [
    "Six stars in one system, all bound together, though the eye sees one.",
  ],
  pollux: [
    "The brighter of the twins, an orange giant with a known planet.",
  ],
  alcyone: [
    "The brightest of the Pleiades, the little knot of blue stars in Taurus.",
  ],
  albireo: [
    "In a small telescope it splits into a gold star and a blue one — the prettiest pair in the sky.",
  ],
  dubhe: [
    "One of the two pointers: the line from it through Merak runs straight to Polaris.",
  ],
  merak: [
    "The other pointer to the north star, alongside Dubhe.",
  ],
  alnilam: [
    "The middle star of Orion's Belt, and a supergiant far beyond the other two.",
  ],
  mintaka: [
    "The westernmost belt star, sitting almost exactly on the celestial equator.",
  ],
  alnitak: [
    "The eastern belt star, next to the Flame and Horsehead nebulae.",
  ],
  shaula: [
    "The stinger of the Scorpion — its name means exactly that.",
  ],
  achernar: [
    "The end of the river Eridanus, and the flattest star known, spun nearly oval.",
  ],
  adhara: [
    "Faint-looking now, but a few million years ago it passed close enough to be the brightest star in the sky.",
  ],
  eltanin: [
    "The head of the Dragon, and it passes directly overhead in London.",
  ],
  denebola: [
    "The tail of the Lion, young and surrounded by a disc of dust.",
  ],
  gacrux: [
    "The top of the Southern Cross, and the nearest red giant to us.",
  ],
  alphard: [
    "The solitary one in Hydra — there is nothing bright anywhere near it.",
  ],
  kochab: [
    "It was the pole star in Roman times, before Polaris drifted into place.",
  ],
  hamal: [
    "The brightest star of Aries, and where the spring equinox pointed two thousand years ago.",
  ],
  peacock: [
    "The brightest star of Pavo, deep in the southern sky.",
  ],
  sadr: [
    "The heart of the Cross of Cygnus, sitting in a dense patch of the Milky Way.",
  ],
};
/** The catalogue, brightest first. Order is load-bearing: the visible list is
 *  capped, and a cap that dropped Sirius to keep a fourth-magnitude filler star
 *  would be worse than no cap at all. (Array sort is stable, as Python's is.) */
export const STARS: readonly Star[] = ROWS
  .map(([id, name, raH, decDeg, mag, con]) => ({ id, name, raH, decDeg, mag, con }))
  .sort((a, b) => a.mag - b.mag);

export const BY_ID: ReadonlyMap<string, Star> = new Map(STARS.map((s) => [s.id, s]));

/** Lower-case, with every separator collapsed to an underscore. */
export function normalise(text: unknown): string {
  // Accents folded too (new in this port): "Bootes" finds Boötes, as speech
  // recognisers and keyboards both spell it.
  return String(text ?? '').trim().toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
}

/**
 * A spoken name to a star, or null. Forgiving about how a name arrives from
 * speech-to-text ("kaus australis", "Kaus-Australis" and "kaus_australis" are
 * the same star) and deliberately NOT fuzzy beyond that: guessing which star
 * somebody meant is how an avatar confidently describes the wrong one.
 */
export function findStar(query: unknown): Star | null {
  const k = normalise(query);
  if (!k) return null;
  return BY_ID.get(k) ?? STARS.find((s) => normalise(s.name) === k) ?? null;
}

/** "the plough" and "the big dipper" are the same seven stars as Ursa Major,
 *  and a guide that refuses the name people actually use is a bad guide. */
export const CONSTELLATION_ALIASES: Record<string, string> = {
  the_plough: 'UMa', plough: 'UMa', big_dipper: 'UMa', the_big_dipper: 'UMa',
  little_dipper: 'UMi', the_little_dipper: 'UMi', southern_cross: 'Cru', the_southern_cross: 'Cru',
  the_hunter: 'Ori', the_scorpion: 'Sco', the_swan: 'Cyg', the_teapot: 'Sgr',
  the_lion: 'Leo', the_bull: 'Tau', the_twins: 'Gem',
};

/** A spoken constellation name or abbreviation to its abbreviation, or null. */
export function findConstellation(query: unknown): string | null {
  const k = normalise(query);
  if (!k) return null;
  for (const [abbr, name] of Object.entries(CONSTELLATION_NAMES)) {
    if (k === normalise(abbr) || k === normalise(name)) return abbr;
  }
  return CONSTELLATION_ALIASES[k] ?? null;
}

/** The stars of a constellation, brightest first. */
export const starsIn = (abbr: string) => STARS.filter((s) => s.con === abbr);

/** How bright a star looks, in words: the catalogue's own description, so the
 *  avatar never has to reach for one. */
export function brightnessWord(mag: number): string {
  if (mag < 0) return 'one of the very brightest in the sky';
  if (mag < 1.5) return 'brilliant';
  if (mag < 2.5) return 'bright';
  if (mag < 3.5) return 'easy enough once your eyes adjust';
  return 'faint, but part of a shape you would know';
}

export interface Fact { title: string; lines: string[] }

/**
 * What the avatar is allowed to say about a star. A star with no authored lines
 * still gets a fact, built out of the catalogue row rather than left empty,
 * because the alternative is the model filling the silence from memory, which
 * is the one thing this app forbids.
 */
export function factFor(starId: string): Fact | null {
  const star = BY_ID.get(starId);
  if (!star) return null;
  const constellation = CONSTELLATION_NAMES[star.con] ?? star.con;
  return {
    title: star.name,
    lines: [...(FACTS[starId] ?? []), `In ${constellation}, at magnitude ${star.mag.toFixed(2)} — ${brightnessWord(star.mag)}.`],
  };
}
