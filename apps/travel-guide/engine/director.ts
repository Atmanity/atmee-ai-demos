// What the host is told, and how it acts. The app runs the board; the host
// talks, and reaches the board only through its tools: every country, dish,
// headline and sight it speaks about comes back as a tool result, so it never
// has to invent one. `say` holds those results (one per outcome, written as an
// instruction about a fact), `boardState` is what is on the user's screen.
import type { AppTool } from '../../../server/app-server.ts';
import type { Headline, Snapshot, Spot } from './types.ts';

/** The host's rules: the session's tool instructions (at most 4,000 characters). The news lines only when a news source is set up. */
export function instructions(news: boolean): string {
  return `You are the user's travel companion in Yonder, a trip-dreaming app. A live map is on their screen, with a guidebook beside it: the country they choose, its food${news ? ', its local news' : ''} and the sights around any place they name. You cannot see the screen. It shows only what the app's tools found, and you change it only through them.
- When they settle on a country, or a city or region in one ("Portugal", "Kyoto", "let's do Bali"), or want to go back to one already on their route, call choose_destination with it before saying anything about the place. If they ask you to choose, pick one country yourself, somewhere not on their route yet, and call choose_destination with it. A continent alone ("somewhere in Asia") can go to choose_destination too: it narrows the ideas on screen.
- "What should I eat there?": call show_food and recommend only the dishes it returns. For another country's food ("what do they eat in Peru?"), call choose_destination with that country first.
${news
    ? `- "What's in the news there?": call show_news and talk only about the headlines it returns. They are the newest the source has and may be days old: never call them today's or fresh, never put a date on them.`
    : `- There is no local news in Yonder: if they ask for news, say in a few words that you cannot pull local news here, and suggest the food instead.`}
- "What's worth seeing around Shibuya station", "near the Louvre", "in Alfama": call explore_near with that place. One sight shows at a time. "Another one", "what else": call next_sight. "The one before": call previous_sight.
- Never name, describe or guess a sight, a dish${news ? ', a headline' : ''} or a distance that a tool did not give you, even one you know well: the screen would not show it. Never say which sight comes next; only next_sight knows.
- You cannot see where they are and must never claim to. If they say "near me" without a place, ask which town, neighbourhood or station they are near; they can also press "Use my location" on screen.
- If they tell you their name, call remember_name with it.
- The screen changes only when you call a tool. Saying "here's Portugal" or "next up is the castle" without the call changes nothing and misleads them: call the tool every time, even when you think you already know the answer.
- Questions about what is already on screen (the country, the dishes${news ? ', the headlines' : ''}, the sight, their route): answer from the live board in your context, no tool needed.
- When they press something on screen, the app tells you what happened; carry on from that.
- Never start something on your own after a result: when a result says to ask whether they want more, ask, and act only on their answer.
You are a well-travelled friend, warm and unhurried. Talk about places as atmosphere and rhythm (food, weather, neighbourhoods, trains, cafés, long walks, ferry rides), not logistics. One or two short spoken sentences, at most one question, no lists, markdown, emoji or colons. Never mention tools, apps or how the board works. Warm is welcome; sexual content is not: decline kindly and steer back to travel.`;
}

const placeArg = (description: string) => ({
  type: 'object',
  properties: { place: { type: 'string', minLength: 1, maxLength: 120, description } },
  required: ['place'],
  additionalProperties: false,
});
const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const awaits = (timeoutSeconds: number) => ({ mode: 'await' as const, timeoutSeconds });

/** The board's tools. Each is answered by the app, which does the lookups. show_news only when a news source is set up. */
export function tools(news: boolean): AppTool[] {
  return [
    {
      type: 'function', name: 'choose_destination',
      description: 'Puts a country on the map (or goes back to one already on their route) and gets its food ready. Call it when the user settles on a country, a city or region in one, or a continent, or asks you to choose (then pass your own pick), before saying anything about the place.',
      parameters: placeArg('The country, or a city or region in one, as the user said it ("Portugal", "Kyoto, Japan", "Bali", "South America"); your own pick when they asked you to choose.'),
      'x-atmee': awaits(20),
    },
    {
      type: 'function', name: 'show_food',
      description: 'Shows three local dishes worth trying in the country on the map, with photos. Call it when the user asks what to eat there, or says yes to hearing about the food.',
      parameters: noArgs, 'x-atmee': awaits(20),
    },
    ...(news ? [{
      type: 'function' as const, name: 'show_news',
      description: 'Shows the newest local headlines for the country on the map. Call it when the user asks what is in the news there, or says yes to hearing it.',
      parameters: noArgs, 'x-atmee': awaits(16),
    }] : []),
    {
      type: 'function', name: 'explore_near',
      description: 'Finds what is worth seeing around a town, neighbourhood, station or landmark, and shows the closest sight with its photo and distance. Call it when the user names a place and asks what to see around it, or says where they are.',
      parameters: placeArg('The town, neighbourhood, station or landmark, as the user said it ("Shibuya station", "Alfama, Lisbon").'),
      'x-atmee': awaits(24),
    },
    {
      type: 'function', name: 'next_sight',
      description: 'Shows the next sight around the place being explored. Call it when the user asks for another one, the next one, or what else is around.',
      parameters: noArgs, 'x-atmee': awaits(12),
    },
    {
      type: 'function', name: 'previous_sight',
      description: 'Goes back to the sight before this one. Call it when the user asks for the previous one or the one before.',
      parameters: noArgs, 'x-atmee': awaits(12),
    },
    {
      type: 'function', name: 'remember_name',
      description: 'Writes the user\'s name on their trip. Call it when they tell you what to call them.',
      parameters: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60, description: 'Their name, as they said it.' } }, required: ['name'], additionalProperties: false },
      'x-atmee': { mode: 'notify' },
    },
  ];
}

/** The limit on `state`. */
export const STATE_LIMIT = 3858;

const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const listOf = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const headlineList = (hs: Headline[]) => hs.map((h, i) => `(${i + 1}) ${clip(h.title, 140)}`).join(' ');
const spotLine = (s: Spot) => `${s.name}, ${an(s.category)}, ${s.distance || 'nearby'}`;
const ask = (newsAvailable: boolean) => `ask whether they would like to hear what to eat there${newsAvailable ? ', or the latest headlines' : ''}; show it only if they say yes`;

/** The live board, as the host's state: what is on the user's screen. Never what is not shown yet (the host must ask the tool for it). */
export function boardState(s: Snapshot): string {
  const parts: string[] = ['Yonder, live board.'];
  if (s.travelerName) parts.push(`The traveller is called ${s.travelerName}; use it sparingly.`);

  if (s.stage === 'around') {
    const v = s.spot;
    if (!v) parts.push('The guidebook is on Wander and asks which place to look around: they have not said yet.');
    else if (v.lookupFailed) parts.push(`They asked what is around ${v.place}, but the places service is not answering right now.`);
    else if (!v.spot) parts.push(`They asked what is around ${v.place}, but nothing stands out there.`);
    else {
      parts.push(`Around ${v.place}, sight ${v.index + 1} of ${v.total} is on screen: ${spotLine(v.spot)}.`);
      if (v.spot.summary) parts.push(`About it: ${clip(v.spot.summary, 300)}`);
      parts.push(v.index + 1 < v.total ? 'There are more around it; only next_sight knows which comes next.' : 'It is the last one around there.');
    }
    if (s.map) parts.push(`${s.map.country} is the country on their route behind it.`);
  } else if (!s.map) {
    parts.push('The map shows the whole world: no country chosen yet.');
    if (s.continent) parts.push(`They are drawn to ${s.continent}, and ideas from there are on screen.`);
  } else {
    const country = s.map.country;
    parts.push(`On the map: ${country}${s.map.city ? `; they mentioned ${s.map.city}` : ''}.`);

    const food = s.food;
    const dishes = (food?.dishes ?? []).map((d) => (d.description ? `${d.name} (${clip(d.description, 150)})` : d.name)).join('; ');
    if (food?.shown && food.dishes.length) parts.push(`On screen, dishes from ${country}: ${dishes}.`);
    else if (food?.shown) parts.push(`No dish ideas came back for ${country}.`);
    else parts.push(`Its dishes are not on screen yet: call show_food when they ask what to eat.`);

    if (!s.newsAvailable) parts.push('There is no local news in Yonder.');
    else if (s.news?.shown && s.news.headlines.length) parts.push(`On screen, the newest headlines the source has for ${country} (they may be days old, never call them today's): ${headlineList(s.news.headlines)}`);
    else if (s.news?.shown) parts.push(`No headlines came back for ${country}.`);
    else parts.push('Its headlines are not on screen yet: call show_news when they ask about the news.');
  }

  const stops = s.trip.visited.map((t) => (t.city ? `${t.country} (${t.city})` : t.country));
  if (stops.length >= 2) parts.push(`Their route so far: ${listOf(stops.slice(-12))}. Any of them can be brought back with choose_destination; nothing is lost.`);

  let text = parts.join(' ');
  // The worst case (five long headlines, three long dishes, a long route) is
  // kept under the limit by the clips above; this is the backstop.
  if (text.length > STATE_LIMIT) text = `${text.slice(0, STATE_LIMIT - 1)}…`;
  return text;
}

/** What a tool call (or a button) did, in words the host speaks from. */
export const say = {
  opening(s: Snapshot) {
    const who = s.travelerName ? ` They are called ${s.travelerName}.` : '';
    const intro = `Yonder is open on the user's screen: a live map with a guidebook beside it.${who}`;
    if (s.stage === 'around' && s.spot?.spot) return `${intro} They are looking around ${s.spot.place}, with ${s.spot.spot.name} on screen. Welcome them in one short sentence that mentions it.`;
    if (s.map) return `${intro} They have already put ${s.map.country} on the map. Welcome them, say one warm, specific sentence about it, and ask what they would like to explore there.`;
    return `${intro} The map shows the whole world. Welcome them in one or two short sentences and ask where in the world they are dreaming of; say you can choose somewhere if they like.`;
  },
  named: (name: string) => `Their name, ${name}, is on their trip now. Use it sparingly, not every line.`,
  noName: () => 'That did not sound like a name, so nothing was written down. Do not ask again; just carry on warmly.',
  continentOnly: (continent: string) => `${continent} is not one country, so the map stays as it is, with ideas from ${continent} on screen. Ask which country there calls to them, or offer to choose one.`,
  noDestination: () => 'No destination was given. Ask which part of the world they are dreaming about, or offer to pick somewhere.',
  notFound: (place: string) => `Could not place ${place} on the map. Ask them to confirm the name, or to name the country it is in.`,
  destination(country: string, { city = '', newsAvailable = false, how = 'user' }: { city?: string; newsAvailable?: boolean; how?: 'user' | 'picked' } = {}) {
    if (how === 'picked') return `They asked to be surprised, and ${country} is your pick: it is on the map now. Present it as your own choice in one warm, specific sentence, then ${ask(newsAvailable)}.`;
    return `${country} is on the map now${city ? `, and they mentioned ${city}` : ''}. Say one warm, specific sentence about it, then ${ask(newsAvailable)}.`;
  },
  noCountryForNews: () => 'No country is chosen yet. Ask where they are dreaming of before talking about the news.',
  news: (country: string, headlines: Headline[]) => `${headlines.length} headline${headlines.length === 1 ? ' is' : 's are'} on screen from ${country}, the newest the source has; they may be days old, so never call them fresh or put a date on them: ${headlineList(headlines)} Mention the top one or two in a short sentence, adding nothing.`,
  noNews: (country: string) => `No headlines came back for ${country}. Say briefly that you could not pull the local news, and suggest the food instead.`,
  noCountryForFood: () => 'No country is chosen yet. Ask where they are dreaming of first.',
  food: (country: string, dishes: { name: string; description: string }[]) => `${dishes.length === 1 ? 'One dish' : `${dishes.length} dishes`} from ${country} ${dishes.length === 1 ? 'is' : 'are'} on screen now: ${dishes.map((d) => (d.description ? `${d.name} (${clip(d.description, 150)})` : d.name)).join('; ')}. Recommend one or two of them in your own words, adding no other dishes.`,
  noFood: (country: string) => `No dish ideas came back for ${country}, so nothing is on screen. Say so lightly and talk about its food from what you know, in one short sentence.`,
  revisited: (country: string, dishes: string[]) => `${country} is back on the map, exactly as they left it${dishes.length ? `, with ${listOf(dishes)} still there` : ''}. Say one warm sentence welcoming them back to it.`,
  alreadyHere: (country: string) => `They are already looking at ${country}. Say so lightly.`,
  notOnTrip: (places: string[]) => `That is not on the route yet. So far it has been ${listOf(places)}. Offer one of those, or to look somewhere new.`,
  nothingToGoBack: () => 'Nowhere has been looked at yet, so there is nothing to go back to. Ask where they are dreaming of.',
  askPlace: () => 'No place was given. Ask which town, neighbourhood or station they mean.',
  countryNotTown: (country: string) => `${country} is a whole country. Ask which town, neighbourhood or station there they would like to look around.`,
  placeNotFound: (place: string) => `Could not find ${place} on the map. Ask them to name the town or the nearest city instead.`,
  lookupDown: (place: string) => `They asked what is around ${place}, but the places service is not answering right now. Say so plainly; they can try again in a moment.`,
  quiet: (place: string) => `They asked what is around ${place}, but nothing stands out there. Say so kindly; they can name another place to look around.`,
  firstSpot: (place: string, spot: Spot, total = 1) => `Around ${place}, the closest of ${total} sight${total === 1 ? '' : 's'} is on screen: ${spotLine(spot)}.${spot.summary ? ` About it: ${clip(spot.summary, 240)}` : ''} Describe it in one or two sentences from this alone, naming no other sight. They can tap it to open it in maps, or ask for another.`,
  anotherSpot: (spot: Spot, position = 0, total = 0) => `Now on screen${position && total ? `, sight ${position} of ${total}` : ''}: ${spotLine(spot)}.${spot.summary ? ` About it: ${clip(spot.summary, 240)}` : ''} Describe it in one or two sentences from this alone, naming no other sight.`,
  lastSpot: () => 'That was the last standout spot around there: there is no next one. Say so; they can go back to an earlier one or name another place to look around.',
  firstAlready: (place: string) => `That is already the first spot around ${place}. Say so; they can ask for the next one.`,
  nothingQueued: (place: string) => `There is nothing to show around ${place}. They can name another place to look around.`,
  askWhereToLook: () => 'Nothing has been looked up yet. Ask which town or neighbourhood they would like to look around.',
  notLookedYet: () => 'Nothing has been looked up yet. Ask which town they would like to look around.',
  nothingToShow: () => 'Nothing to show. They can name another place to look around.',
  noCountryThere: () => 'There is no country right where they tapped the map. Ask them to tap on land, or to name a country.',
  badCoordinates: () => 'Their location could not be read. Ask which town or neighbourhood they are in instead.',
  showPlanning: (country: string) => (country
    ? `The guidebook is back on ${country}, with its map. Carry on from there in one short line.`
    : 'No country is chosen yet. Ask which part of the world they are dreaming about, or offer to pick somewhere.'),
  showAround: (place: string, spot: Spot | null) => (spot
    ? `The guidebook is back on the sights around ${place}, with ${spot.name} on screen. Carry on from there in one short line.`
    : 'The guidebook asks which place to look around. Ask which town, neighbourhood or station they would like to explore.'),
  /** A tool still working when the host can wait no longer: the page tells it the outcome later. */
  stillWorking: (what: string) => `Still working on it: ${what} is taking longer than usual. Tell them in a few words that you are still looking, and say nothing about the result yet: you will be told the moment it is on screen.`,
  landed: (result: string) => `The lookup you were waiting for has finished and is on screen now. ${result}`,
  lateFailed: () => 'The lookup you were waiting for failed, so nothing changed on screen. Say so in a few words; they can ask again in a moment.',
  serviceDown: () => 'The map service did not answer, so nothing changed on screen. Say so in a few words; they can ask again in a moment.',
  freshTrip: () => 'A new trip has started: the map is back to the whole world, with nothing on their route. Ask where they are dreaming of next.',
};

/** A button press, told to the host: it cannot see the screen. */
export const pressed = (button: string, outcome: string) => `The user pressed "${button}" on screen. ${outcome}`;
