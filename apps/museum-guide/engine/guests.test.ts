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
    expect(guestFor(exhibitById('mona-lisa'))).toBeNull();
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
    expect(tourState({ current: exhibitById('mona-lisa'), seen: [], camera: true })).not.toContain('This work has a guest');
    expect(TOOLS.map((t) => t.name)).toContain('introduce_guest');
    expect(said.handingOver(guestById('girl')!)).toMatch(/^Handing over: the girl/);
    expect(said.noGuest(exhibitById('mona-lisa'))).toMatch(/^No guest: "Mona Lisa" has no guest/);
    expect(said.welcomeBack(guestById('girl')!, exhibitById('pearl-earring'))).toContain('talked with the girl at "Girl with a Pearl Earring"');
  });
});
