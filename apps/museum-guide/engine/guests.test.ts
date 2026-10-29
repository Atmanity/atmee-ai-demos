import { describe, expect, it } from 'vitest';
import { exhibitById } from './catalogue.ts';
import { said, TOOLS, tourState } from './director.ts';
import { GUEST_TOOLS, GUESTS, guestById, guestFor, guestState } from './guests.ts';

describe('guests', () => {
  it('each comes from a work in the catalogue, at most one per work', () => {
    for (const g of GUESTS) expect(exhibitById(g.exhibit), g.id).not.toBeNull();
    expect(new Set(GUESTS.map((g) => g.exhibit)).size).toBe(GUESTS.length);
    expect(guestById('girl')?.exhibit).toBe('pearl-earring');
    expect(guestFor(exhibitById('pearl-earring'))?.id).toBe('girl');
    expect(guestFor(exhibitById('night-watch'))).toBeNull();
    expect(guestFor(exhibitById('mona-lisa'))?.id).toBe('mona');
    expect(guestFor(null)).toBeNull();
  });

  it('gives a guest their painting\'s record and the way back to Edmund', () => {
    const state = guestState(guestById('wanderer')!);
    expect(state).toContain('You are the wanderer from "Wanderer above the Sea of Fog"');
    expect(state).toContain('Elbe Sandstone Mountains');
    expect(state).toContain('call_host_back');
    expect(GUEST_TOOLS.map((t) => t.name)).toEqual(['call_host_back']);
  });

  it('tells Edmund who can be introduced, and only where they are', () => {
    const at = tourState({ current: exhibitById('pearl-earring'), seen: [], camera: true });
    expect(at).toContain('This work has a guest: the girl from the painting herself');
    expect(at.length).toBeLessThan(3858);
    expect(tourState({ current: exhibitById('night-watch'), seen: [], camera: true })).not.toContain('This work has a guest');
    expect(TOOLS.map((t) => t.name)).toContain('introduce_guest');
    expect(said.handingOver(guestById('girl')!)).toMatch(/^Handing over: the girl/);
    expect(said.noGuest(exhibitById('night-watch'))).toMatch(/^No guest: "The Night Watch" has no guest/);
    expect(said.welcomeBack(guestById('girl')!, exhibitById('pearl-earring'))).toContain('talked with the girl at "Girl with a Pearl Earring"');
  });
  it('tells a hidden guide to keep quiet: muted, they would still speak', () => {
    const girl = GUESTS.find((g) => g.id === 'girl')!;
    expect(tourState({ current: null, seen: [], camera: true, away: girl })).toMatch(/^ON HOLD: the visitor is talking with the girl/i);
    expect(tourState({ current: null, seen: [], camera: true })).not.toContain('ON HOLD');
    expect(guestState(girl, 'en', true)).toMatch(/^ON HOLD: the visitor has not come to meet you yet/);
    expect(guestState(girl)).not.toContain('ON HOLD');
  });
});
