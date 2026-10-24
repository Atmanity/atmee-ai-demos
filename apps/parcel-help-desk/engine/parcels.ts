// Waybill's own data and rules: the parcels a help desk can look up and the
// fixes it can make. This is the app's business logic, not the avatar's: the
// app's agent calls these as tools and speaks from what they return; Tess is
// only the face that says it.

export type ParcelStatus = 'in_transit' | 'out_for_delivery' | 'delivery_failed' | 'held_at_depot' | 'delivered';

export interface ParcelEvent { at: string; where: string; what: string }

export interface Parcel {
  tracking: string;               // WB-4821-7730
  recipient: string;
  from: string;
  to: string;                     // the delivery address
  status: ParcelStatus;
  /** When it should arrive now, in words; null once delivered or while held. */
  eta: string | null;
  events: ParcelEvent[];          // newest first
  /** What is wrong, in the desk's words, for the agent to explain. */
  issue?: string;
  claim?: string;                 // a claim reference, once opened
  pickupPoint?: string;           // where it waits, once redirected
}

/** The next five working days after `now`, in words ("Monday 26 October"): the days a delivery can move to. */
export function deliveryDays(now = new Date()): string[] {
  const days: string[] = [];
  const d = new Date(now);
  while (days.length < 5) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    days.push(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
  }
  return days;
}

/** The offered day a customer means: by weekday ("Tuesday") or date ("the 28th"); null when none fits. */
export function pickDay(days: string[], input: unknown): string | null {
  const text = String(input ?? '').toLowerCase();
  if (!text.trim()) return null;
  return days.find((day) => {
    const [weekday, date] = day.toLowerCase().split(' ');
    return text.includes(weekday) || new RegExp(`(^|\\D)${date}(st|nd|rd|th)?(\\D|$)`).test(text);
  }) ?? null;
}

/** Pickup points near each delivery town. */
export const PICKUP_POINTS: Record<string, string[]> = {
  Leeds: ['Kirkgate Market lockers', 'Headingley post office'],
  Bristol: ['Temple Meads station lockers', 'Clifton newsagent'],
  Manchester: ['Piccadilly lockers', 'Didsbury pharmacy'],
  York: ['York station lockers', 'Bootham corner shop'],
  Cardiff: ['Queen Street lockers', 'Roath library'],
};

const STATUS_WORDS: Record<ParcelStatus, string> = {
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivery_failed: 'Delivery attempted',
  held_at_depot: 'Held at depot',
  delivered: 'Delivered',
};
export const statusWords = (s: ParcelStatus) => STATUS_WORDS[s];

/** The desk's parcels, fresh for each visitor (their fixes change only their own copy). */
export function sampleParcels(days: string[] = deliveryDays()): Parcel[] {
  return [
    {
      tracking: 'WB-4821-7730', recipient: 'Sam Patel', from: 'Bristol', to: '14 Orchard Lane, Leeds',
      status: 'out_for_delivery', eta: 'today, between 12:00 and 16:00',
      events: [
        { at: 'Today 07:42', where: 'Leeds depot', what: 'Out for delivery with driver Joe' },
        { at: 'Yesterday 21:10', where: 'Leeds depot', what: 'Arrived at the delivery depot' },
        { at: 'Yesterday 14:05', where: 'Bristol hub', what: 'Collected from the sender' },
      ],
    },
    {
      tracking: 'WB-1907-2264', recipient: 'Ana Lima', from: 'London', to: 'Flat 3, 22 Station Road, Bristol',
      status: 'delivery_failed', eta: null,
      issue: 'Nobody was in yesterday at 11:20; a card was left. It goes back to the sender in five days unless it is redelivered or collected.',
      events: [
        { at: 'Yesterday 11:20', where: 'Station Road, Bristol', what: 'Delivery attempted: nobody in, card left' },
        { at: 'Yesterday 07:15', where: 'Bristol depot', what: 'Out for delivery' },
        { at: 'Two days ago 18:30', where: 'London hub', what: 'Collected from the sender' },
      ],
    },
    {
      tracking: 'WB-6650-0193', recipient: 'Leo Brandt', from: 'Glasgow', to: '9 Mill Street, Manchester',
      status: 'held_at_depot', eta: null,
      issue: 'The address has no flat number and 9 Mill Street is a block of twelve flats, so the depot is holding it until the flat number is added.',
      events: [
        { at: 'Today 06:50', where: 'Manchester depot', what: 'Held: the address needs a flat number' },
        { at: 'Yesterday 20:05', where: 'Manchester depot', what: 'Arrived at the delivery depot' },
      ],
    },
    {
      tracking: 'WB-3302-5518', recipient: 'Mia Okafor', from: 'Leeds', to: '18 Elm Grove, York',
      status: 'delivered', eta: null,
      events: [
        { at: 'Yesterday 15:42', where: 'Elm Grove, York', what: 'Delivered: left with the neighbour at number 16' },
        { at: 'Yesterday 08:01', where: 'York depot', what: 'Out for delivery' },
      ],
    },
    {
      tracking: 'WB-7714-9046', recipient: 'Owen Hughes', from: 'Southampton', to: '5 Castle Arcade, Cardiff',
      status: 'in_transit', eta: days[1],
      issue: `Storms closed the Severn crossing overnight, so it is one day later than first promised (it was due ${days[0]}).`,
      events: [
        { at: 'Today 05:30', where: 'Bristol hub', what: 'Delayed: weather on the route' },
        { at: 'Yesterday 16:45', where: 'Southampton hub', what: 'Collected from the sender' },
      ],
    },
  ];
}

/**
 * A tracking number as a customer gives it, typed or heard: "wb 4821 7730",
 * "W B four eight two one…" (as digits by then), "48217730". Null when it is
 * not one: eight digits, with or without the WB.
 */
export function normalizeTracking(input: string): string | null {
  const digits = String(input ?? '').replace(/^\s*w\s*\.?\s*b/i, '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  return `WB-${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export const townOf = (parcel: Parcel) => parcel.to.split(',').pop()!.trim();

/** One tool's outcome: what the agent is told, and the parcel it concerns (the page shows it). */
export interface Outcome { result: Record<string, unknown>; parcel?: Parcel }

/** The desk: a visitor's own copy of the parcels and the fixes made to them. */
export function createDesk(days: string[] = deliveryDays(), parcels: Parcel[] = sampleParcels(days)) {
  const find = (tracking: unknown) => {
    const id = normalizeTracking(String(tracking ?? ''));
    return id ? parcels.find((p) => p.tracking === id) ?? null : null;
  };
  const brief = (p: Parcel) => ({
    tracking: p.tracking, recipient: p.recipient, from: p.from, to: p.to, status: statusWords(p.status), eta: p.eta,
    latest: p.events[0], issue: p.issue ?? null, claim: p.claim ?? null, pickupPoint: p.pickupPoint ?? null,
  });
  const refused = (why: string, parcel?: Parcel): Outcome => ({ result: { ok: false, refused: why }, parcel });
  const unknown = (tracking: unknown): Outcome => refused(normalizeTracking(String(tracking ?? ''))
    ? 'No parcel with that tracking number. Ask the customer to read it again from their email or card.'
    : 'That is not a tracking number: they look like WB followed by eight digits.');

  return {
    parcels,
    days,
    find,
    lookup(tracking: unknown): Outcome {
      const p = find(tracking);
      return p ? { result: { ok: true, parcel: brief(p), canMoveTo: days, pickupPoints: PICKUP_POINTS[townOf(p)] ?? [] }, parcel: p } : unknown(tracking);
    },
    reschedule(tracking: unknown, day: unknown): Outcome {
      const p = find(tracking);
      if (!p) return unknown(tracking);
      if (p.status === 'delivered') return refused('It was already delivered; nothing to reschedule.', p);
      if (p.status === 'held_at_depot') return refused('It is held until the address is complete: add the flat number first.', p);
      const chosen = pickDay(days, day);
      if (!chosen) return refused(`Offer one of: ${days.join(', ')}.`, p);
      p.status = 'in_transit';
      p.eta = `${chosen}, between 08:00 and 18:00`;
      p.pickupPoint = undefined;
      p.issue = undefined;
      p.events.unshift({ at: 'Just now', where: 'Waybill help desk', what: `Redelivery booked for ${chosen}` });
      return { result: { ok: true, parcel: brief(p) }, parcel: p };
    },
    sendToPickupPoint(tracking: unknown, point: unknown): Outcome {
      const p = find(tracking);
      if (!p) return unknown(tracking);
      if (p.status === 'delivered') return refused('It was already delivered.', p);
      const points = PICKUP_POINTS[townOf(p)] ?? [];
      const wanted = String(point ?? '').toLowerCase();
      const chosen = points.find((name) => wanted && (name.toLowerCase().includes(wanted) || wanted.includes(name.toLowerCase().split(' ')[0])));
      if (!chosen) return refused(`Offer one of: ${points.join(', ')}.`, p);
      p.status = 'in_transit';
      p.pickupPoint = chosen;
      p.eta = `ready to collect at ${chosen} from ${days[0]}`;
      p.issue = undefined;
      p.events.unshift({ at: 'Just now', where: 'Waybill help desk', what: `Redirected to ${chosen}` });
      return { result: { ok: true, parcel: brief(p) }, parcel: p };
    },
    completeAddress(tracking: unknown, flat: unknown): Outcome {
      const p = find(tracking);
      if (!p) return unknown(tracking);
      if (p.status !== 'held_at_depot') return refused('Its address is complete; nothing to add.', p);
      const number = String(flat ?? '').match(/\d+/)?.[0];
      if (!number || Number(number) < 1 || Number(number) > 12) return refused('Ask for the flat number: the block has flats 1 to 12.', p);
      p.to = p.to.replace(/^(\d+ )/, `Flat ${number}, $1`);
      p.status = 'out_for_delivery';
      p.eta = 'tomorrow, between 08:00 and 12:00';
      p.issue = undefined;
      p.events.unshift({ at: 'Just now', where: 'Waybill help desk', what: `Flat ${number} added; released for delivery` });
      return { result: { ok: true, parcel: brief(p) }, parcel: p };
    },
    openClaim(tracking: unknown, reason: unknown): Outcome {
      const p = find(tracking);
      if (!p) return unknown(tracking);
      if (p.status !== 'delivered') return refused('A claim is for a parcel marked delivered that never reached them, or arrived damaged; this one is still on its way.', p);
      if (p.claim) return { result: { ok: true, alreadyOpen: true, claim: p.claim }, parcel: p };
      p.claim = `CL-${p.tracking.slice(3, 7)}${p.tracking.slice(-2)}`;
      p.events.unshift({ at: 'Just now', where: 'Waybill help desk', what: `Claim ${p.claim} opened: ${String(reason ?? 'not received').slice(0, 80)}` });
      return { result: { ok: true, claim: p.claim, nextStep: 'A claims handler replies by email within two working days; first, the neighbour at number 16 is asked.' }, parcel: p };
    },
  };
}

export type Desk = ReturnType<typeof createDesk>;
