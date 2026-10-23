// Where the chart opens, and the red-light preference.
import { useEffect, useState } from 'react';
import { findPlace, PLACES } from '../engine/sky.ts';

/**
 * The place the chart opens on: `?place=Lisbon` if it names a listed place;
 * else the city in the browser's time zone ("Europe/Lisbon"); else the first
 * listed place on the same standard time; else Taipei (the original's).
 */
export function startingPlace(search: string, timeZone?: string, standardOffsetHours?: number): string {
  const asked = findPlace(new URLSearchParams(search).get('place'));
  if (asked) return asked.label;
  const city = timeZone?.split('/').pop()?.replace(/_/g, ' ');
  const here = city ? findPlace(city) : null;
  if (here) return here.label;
  const sameClock = standardOffsetHours === undefined ? null : PLACES.find((p) => p.tz === standardOffsetHours);
  return sameClock?.label ?? 'Taipei';
}

/** The browser's standard-time offset in hours east (the smaller of January's and July's). */
export function standardOffset(year = new Date().getFullYear()): number {
  const jan = -new Date(year, 0, 1).getTimezoneOffset() / 60;
  const jul = -new Date(year, 6, 1).getTimezoneOffset() / 60;
  return Math.min(jan, jul);
}

/** The place for this browser, from its address and clock. */
export function browserPlace(): string {
  let zone: string | undefined;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    zone = undefined;
  }
  return startingPlace(typeof location === 'undefined' ? '' : location.search, zone, standardOffset());
}

const RED_KEY = 'lodestar:red-light';

/**
 * Red light: the whole app in an observer's torch red, so eyes that have
 * adjusted to the dark stay adjusted. Remembered per browser (a convenience;
 * it works without storage) and set on <html> so the page behind turns too.
 */
export function useRedLight(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(RED_KEY) === 'on';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.light = on ? 'red' : 'night';
    try {
      localStorage.setItem(RED_KEY, on ? 'on' : 'off');
    } catch {
      // private window or blocked storage: the choice lasts this visit
    }
  }, [on]);
  return [on, setOn];
}
