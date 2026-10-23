// One way to act on the board, for the host's tool calls and the user's
// buttons alike: the app decides everything (which country a place is in,
// whether a country is already on the route, which sight comes next) and
// returns what happened, in words the host speaks from.
import { continentsIn, countriesIn, norm } from './countries.ts';
import { say } from './director.ts';
import { titleCase } from './judge.ts';
import type { TravelState } from './state.ts';
import * as trip from './trip.ts';
import type { Lookups } from './trip.ts';
import type { Action } from './types.ts';

export const TOOL_NAMES = ['choose_destination', 'show_food', 'show_news', 'explore_near', 'next_sight', 'previous_sight', 'remember_name'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const isToolName = (name: unknown): name is ToolName => typeof name === 'string' && (TOOL_NAMES as readonly string[]).includes(name);

/** How long show_food waits for the built-in dishes' descriptions (they come from Wikipedia with the photos). */
export const DESCRIPTION_WAIT_MS = 2500;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A host's tool call. Arguments are what the host heard; everything else is the app's to decide. */
export async function runTool(state: TravelState, lookups: Lookups, name: ToolName, args: Record<string, unknown> = {}): Promise<string> {
  switch (name) {
    case 'choose_destination': return chooseDestination(state, lookups, text(args.place, 120));
    case 'show_food': return showFood(state);
    case 'show_news': return showNews(state);
    case 'explore_near': return trip.explorePlace(state, lookups, text(args.place, 120));
    case 'next_sight': return moveSight(state, lookups, 'next', args.from);
    case 'previous_sight': return moveSight(state, lookups, 'previous', args.from);
    case 'remember_name': return trip.rememberTraveler(state, titleCase(text(args.name, 60)));
  }
}

/** A button, a chip, a pin or a tap: the same actions as the tools where there is one. */
export function runAction(state: TravelState, lookups: Lookups, action: Action): Promise<string> {
  switch (action.kind) {
    case 'search': return chooseDestination(state, lookups, action.query);
    case 'destination': return chooseDestination(state, lookups, action.city ? `${action.city}, ${action.country}` : action.country);
    case 'revisit': return chooseDestination(state, lookups, action.country);
    case 'food': return showFood(state);
    case 'news': return showNews(state);
    case 'next': return moveSight(state, lookups, 'next');
    case 'previous': return moveSight(state, lookups, 'previous');
    default: return trip.apply(state, lookups, action);
  }
}

/**
 * A country, a city or region in one, or a continent. A country already on
 * the route comes back as it was (nothing fetched again); the one on screen
 * while its sights are showing brings its page back; a city finds its country.
 */
async function chooseDestination(state: TravelState, lookups: Lookups, place: string): Promise<string> {
  if (!place) return say.noDestination();
  const country = countriesIn(place)[0];
  if (!country) {
    const continent = continentsIn(place)[0];
    if (continent) return trip.chooseDestination(state, lookups, '', { continent });
    return trip.searchDestination(state, lookups, place);
  }
  // "Kyoto, Japan": the city goes with it.
  if (place.split(',').some((part) => part.trim() && !countriesIn(part).length)) return trip.searchDestination(state, lookups, place);
  if (state.country && norm(country) === norm(state.country)) {
    if (state.stage === 'around') return trip.apply(state, lookups, { kind: 'show', stage: 'planning' });
    return say.alreadyHere(state.country);
  }
  return trip.revisitCountry(state, lookups, country);
}

/** The dishes live on the country's page: showing them brings it back from the sights. */
async function showFood(state: TravelState): Promise<string> {
  const entry = state.here;
  if (entry) {
    leaveSights(state);
    const detail = state.detail.get(entry.country);
    if (detail) {
      await detail.dishes;
      // The built-in dishes get their one-line description with their photo: worth a short wait, not a long one.
      if (entry.dishes.some((d) => !d.description)) await Promise.race([detail.photos, sleep(DESCRIPTION_WAIT_MS)]);
    }
  }
  return trip.showDishes(state);
}

async function showNews(state: TravelState): Promise<string> {
  if (!state.newsAvailable) return 'There is no local news in Yonder, so nothing changed on screen. Say so in a few words and suggest the food instead.';
  if (state.here) leaveSights(state);
  return trip.showHeadlines(state);
}

function leaveSights(state: TravelState) {
  if (state.stage !== 'around') return;
  state.stage = 'planning';
  state.bump();
}

/**
 * The next sight or the one before. `from` is the safety net's: the sight it
 * saw on screen when the user asked. If the host has moved since, the move is
 * already made, and making it again would skip a sight nobody saw.
 */
async function moveSight(state: TravelState, lookups: Lookups, way: 'next' | 'previous', from?: unknown): Promise<string> {
  if (typeof from === 'number' && state.spots.length && from !== state.spotIndex) {
    const view = state.spotView()?.spot;
    return view ? `That is done already: sight ${state.spotIndex + 1} of ${state.spots.length} is on screen, ${view.name}. Carry on from it.` : say.nothingToShow();
  }
  if (state.spots.length && state.stage !== 'around') {
    state.stage = 'around';
    state.bump();
  }
  return way === 'next' ? trip.nextSpot(state, lookups) : trip.previousSpot(state, lookups);
}
