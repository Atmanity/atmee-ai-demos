// The words the app can recognise without a model: country names (and the
// other names people use for them), continents, a few destination ideas per
// region, and dishes to fall back on when no model is configured.
//
// Matching is longest-first on whole words, because the world is full of
// countries whose names contain one another: Niger/Nigeria, Guinea/Papua New
// Guinea, Sudan/South Sudan, Dominica/Dominican Republic, Ireland/Northern
// Ireland. A first-match scan put NIGERIA on the map for "back to Niger".

const NAMES = `Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bhutan|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burundi|Cambodia|Cameroon|Canada|Cape Verde|Central African Republic|Chad|Chile|China|Colombia|Comoros|Costa Rica|Croatia|Cuba|Cyprus|Czechia|Democratic Republic of the Congo|Denmark|Djibouti|Dominica|Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Greenland|Grenada|Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hungary|Iceland|India|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Ivory Coast|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kosovo|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Marshall Islands|Mauritania|Mauritius|Mexico|Micronesia|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nauru|Nepal|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Korea|North Macedonia|Norway|Oman|Pakistan|Palau|Palestine|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|Portugal|Puerto Rico|Qatar|Republic of the Congo|Romania|Russia|Rwanda|Saint Kitts and Nevis|Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|Sao Tome and Principe|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|Solomon Islands|Somalia|South Africa|South Korea|South Sudan|Spain|Sri Lanka|Sudan|Suriname|Sweden|Switzerland|Syria|Taiwan|Tajikistan|Tanzania|Thailand|Timor-Leste|Togo|Tonga|Trinidad and Tobago|Tunisia|Turkey|Turkmenistan|Tuvalu|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Vanuatu|Vatican City|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe|England|Scotland|Wales|Northern Ireland`.split('|');

/** Other names people say, to the name the map looks up. */
const ALIASES: Record<string, string> = {
  usa: 'United States', 'u s a': 'United States', 'u s': 'United States', 'united states of america': 'United States', america: 'United States', 'the states': 'United States', 'the us': 'United States',
  uk: 'United Kingdom', 'u k': 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  holland: 'Netherlands', 'the netherlands': 'Netherlands', 'czech republic': 'Czechia', "cote d'ivoire": 'Ivory Coast', 'cote divoire': 'Ivory Coast',
  burma: 'Myanmar', korea: 'South Korea', uae: 'United Arab Emirates', 'the emirates': 'United Arab Emirates', emirates: 'United Arab Emirates',
  drc: 'Democratic Republic of the Congo', 'dr congo': 'Democratic Republic of the Congo', congo: 'Republic of the Congo',
  'east timor': 'Timor-Leste', swaziland: 'Eswatini', 'cabo verde': 'Cape Verde', turkiye: 'Turkey', macedonia: 'North Macedonia',
  'the philippines': 'Philippines', 'the bahamas': 'Bahamas', 'the gambia': 'Gambia', 'the maldives': 'Maldives', 'the vatican': 'Vatican City', vatican: 'Vatican City',
  'viet nam': 'Vietnam', 'lao': 'Laos', persia: 'Iran',
};

export const CONTINENTS = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Central America', 'Latin America', 'Oceania', 'the Caribbean', 'the Middle East', 'Southeast Asia', 'Scandinavia'];

/** A few countries per region, for "surprise me" and the idea chips. */
export const IDEAS: Record<string, string[]> = {
  Europe: ['Portugal', 'Italy', 'Greece', 'Iceland', 'Croatia', 'Norway'],
  Asia: ['Japan', 'Vietnam', 'India', 'South Korea', 'Nepal', 'Indonesia'],
  Africa: ['Morocco', 'Kenya', 'South Africa', 'Tanzania', 'Egypt', 'Namibia'],
  'North America': ['Canada', 'Mexico', 'United States'],
  'Central America': ['Costa Rica', 'Guatemala', 'Belize', 'Panama'],
  'South America': ['Peru', 'Argentina', 'Chile', 'Colombia', 'Brazil', 'Ecuador'],
  'Latin America': ['Mexico', 'Peru', 'Costa Rica', 'Argentina', 'Colombia', 'Cuba'],
  Oceania: ['New Zealand', 'Australia', 'Fiji', 'Samoa'],
  'the Caribbean': ['Cuba', 'Jamaica', 'Dominican Republic', 'Barbados'],
  'the Middle East': ['Jordan', 'Oman', 'United Arab Emirates', 'Turkey'],
  'Southeast Asia': ['Thailand', 'Vietnam', 'Indonesia', 'Philippines', 'Malaysia', 'Cambodia'],
  Scandinavia: ['Norway', 'Sweden', 'Denmark', 'Finland', 'Iceland'],
};
export const WORLD_IDEAS = ['Japan', 'Portugal', 'Peru', 'Morocco', 'New Zealand', 'Iceland', 'Vietnam', 'Mexico', 'Italy', 'Kenya', 'Greece', 'Argentina'];

/**
 * Dishes for when no model is configured: names (and the Wikipedia article
 * when the name alone would miss it). The description comes from Wikipedia.
 */
export const FALLBACK_DISHES: Record<string, { name: string; wiki?: string }[]> = {
  Japan: [{ name: 'Ramen' }, { name: 'Sushi' }, { name: 'Okonomiyaki' }],
  Italy: [{ name: 'Risotto' }, { name: 'Carbonara' }, { name: 'Gelato' }],
  Portugal: [{ name: 'Pastel de nata' }, { name: 'Bacalhau' }, { name: 'Francesinha' }],
  Spain: [{ name: 'Paella' }, { name: 'Tortilla española', wiki: 'Spanish omelette' }, { name: 'Gazpacho' }],
  France: [{ name: 'Croissant' }, { name: 'Ratatouille' }, { name: 'Coq au vin' }],
  Greece: [{ name: 'Moussaka' }, { name: 'Souvlaki' }, { name: 'Spanakopita' }],
  Mexico: [{ name: 'Tacos al pastor', wiki: 'Al pastor' }, { name: 'Mole' }, { name: 'Tamales', wiki: 'Tamale' }],
  Peru: [{ name: 'Ceviche' }, { name: 'Lomo saltado' }, { name: 'Ají de gallina' }],
  India: [{ name: 'Biryani' }, { name: 'Masala dosa' }, { name: 'Butter chicken' }],
  Thailand: [{ name: 'Pad thai' }, { name: 'Tom yum' }, { name: 'Som tam' }],
  Vietnam: [{ name: 'Phở', wiki: 'Pho' }, { name: 'Bánh mì' }, { name: 'Bún chả' }],
  China: [{ name: 'Peking duck' }, { name: 'Xiaolongbao' }, { name: 'Mapo tofu' }],
  'South Korea': [{ name: 'Bibimbap' }, { name: 'Kimchi' }, { name: 'Tteokbokki' }],
  Morocco: [{ name: 'Tajine' }, { name: 'Couscous' }, { name: 'Pastilla' }],
  Turkey: [{ name: 'Döner kebab' }, { name: 'Baklava' }, { name: 'Menemen', wiki: 'Menemen (food)' }],
  'United States': [{ name: 'Hamburger' }, { name: 'Barbecue', wiki: 'Barbecue in the United States' }, { name: 'Apple pie' }],
  'United Kingdom': [{ name: 'Fish and chips' }, { name: 'Full breakfast' }, { name: 'Sunday roast' }],
  Argentina: [{ name: 'Asado' }, { name: 'Empanada' }, { name: 'Dulce de leche' }],
  Brazil: [{ name: 'Feijoada' }, { name: 'Pão de queijo' }, { name: 'Moqueca' }],
  Germany: [{ name: 'Pretzel' }, { name: 'Bratwurst' }, { name: 'Black Forest gâteau' }],
  Indonesia: [{ name: 'Nasi goreng' }, { name: 'Rendang' }, { name: 'Satay' }],
  Lebanon: [{ name: 'Hummus' }, { name: 'Tabbouleh' }, { name: 'Manakish' }],
  Nepal: [{ name: 'Momo', wiki: 'Momo (food)' }, { name: 'Dal bhat' }, { name: 'Sel roti' }],
  Kenya: [{ name: 'Ugali' }, { name: 'Nyama choma' }, { name: 'Sukuma wiki' }],
  Canada: [{ name: 'Poutine' }, { name: 'Butter tart' }, { name: 'Nanaimo bar' }],
  'New Zealand': [{ name: 'Pavlova' }, { name: 'Hāngī' }, { name: 'Hokey pokey', wiki: 'Hokey pokey (ice cream)' }],
  Iceland: [{ name: 'Skyr' }, { name: 'Plokkfiskur' }, { name: 'Kleina' }],
  Norway: [{ name: 'Fårikål' }, { name: 'Brunost' }, { name: 'Lefse' }],
  Cuba: [{ name: 'Ropa vieja' }, { name: 'Cuban sandwich' }, { name: 'Moros y cristianos' }],
  Colombia: [{ name: 'Bandeja paisa' }, { name: 'Arepa' }, { name: 'Ajiaco' }],
};

/** Lowercase, accents and punctuation gone, single spaces, padded for whole-word search. */
export function norm(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

interface Entry { key: string; name: string }
const ENTRIES: Entry[] = [
  ...NAMES.map((name) => ({ key: norm(name), name })),
  ...Object.entries(ALIASES).map(([alias, name]) => ({ key: norm(alias), name })),
].sort((a, b) => b.key.length - a.key.length);
const CONTINENT_ENTRIES = CONTINENTS.map((name) => ({ key: norm(name), name })).sort((a, b) => b.key.length - a.key.length);

/** Every name in `entries` found in `text`, longest first, each stretch of text matched once. */
function findAll(text: string, entries: Entry[]): { name: string; at: number; key: string }[] {
  let padded = ` ${norm(text)} `;
  const found: { name: string; at: number; key: string }[] = [];
  for (const { key, name } of entries) {
    let at = padded.indexOf(` ${key} `);
    while (at >= 0) {
      found.push({ name, at, key });
      // Blank it out so "Niger" cannot match inside an already-found "Nigeria".
      padded = padded.slice(0, at + 1) + '#'.repeat(key.length) + padded.slice(at + 1 + key.length);
      at = padded.indexOf(` ${key} `);
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** The continents or regions named, in the order said. */
export function continentsIn(text: string): string[] {
  return [...new Set(findAll(text, CONTINENT_ENTRIES).map((f) => f.name))];
}

/** The countries named, in the order said (a continent is never read as a country: "South America" is not the United States). */
export function countriesIn(text: string): string[] {
  let rest = ` ${norm(text)} `;
  for (const { key } of CONTINENT_ENTRIES) rest = rest.split(` ${key} `).join(' # ');
  return [...new Set(findAll(rest, ENTRIES).map((f) => f.name))];
}

/** The first country named, or null. */
export function countryIn(text: string): string | null {
  return countriesIn(text)[0] ?? null;
}

/** Whether `text` is a country name and nothing else ("Japan", "the UK"). */
export function isCountryName(text: string): boolean {
  const t = norm(text).replace(/^the /, '');
  return ENTRIES.some((e) => e.key === t || e.key === `the ${t}`);
}

/** The canonical name for a country the user named, or the text itself. */
export function canonicalCountry(text: string): string {
  const t = norm(text);
  return ENTRIES.find((e) => e.key === t)?.name ?? text.trim();
}

/** Destination ideas for a region (or the world), minus places already on the trip. */
export function ideasFor(continent: string, exclude: string[] = []): string[] {
  const pool = IDEAS[continent] ?? WORLD_IDEAS;
  const left = pool.filter((c) => !exclude.some((e) => norm(e) === norm(c)));
  return left.length ? left : pool;
}

/** One country to suggest, random within the region's ideas. */
export function pickCountry(continent: string, exclude: string[] = [], random: () => number = Math.random): string {
  const pool = ideasFor(continent, exclude);
  return pool[Math.floor(random() * pool.length) % pool.length];
}
