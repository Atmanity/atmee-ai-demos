// Juniper Family Clinic's front desk: its clinicians, its week of
// appointments and the rules of booking. This is the app's own business
// logic, run in the visitor's page: the receptionist (the avatar's voice on a
// speech session) calls these as tools and says what they return. Nothing
// here is the avatar's: a day it cannot book, a time that is taken or a name
// it has not got yet comes back as a refusal it must say.

/** The clinic, as the receptionist knows it and the page shows it. */
export const CLINIC = {
  name: 'Juniper Family Clinic',
  timeZone: 'America/Los_Angeles',
  address: '418 Alder Street, Portland, Oregon',
  phone: '(503) 555-0142',
  hours: 'Monday to Friday, 9 AM to 4:30 PM, closed 12 to 1:30 for lunch',
};

export interface Clinician {
  id: 'patel' | 'okafor' | 'fischer';
  name: string;              // Dr. Priya Patel
  short: string;             // Dr. Patel
  role: string;
  /** Working weekdays, 1 Monday to 5 Friday. */
  days: number[];
  /** Sees only nurse visits (shots, blood tests). */
  nurse: boolean;
}

export const CLINICIANS: Clinician[] = [
  { id: 'patel', name: 'Dr. Priya Patel', short: 'Dr. Patel', role: 'family doctor', days: [1, 2, 3, 4], nurse: false },
  { id: 'okafor', name: 'Dr. Sam Okafor', short: 'Dr. Okafor', role: 'family doctor', days: [2, 3, 4, 5], nurse: false },
  { id: 'fischer', name: 'Lena Fischer', short: 'Nurse Practitioner Fischer', role: 'nurse practitioner', days: [1, 3, 5], nurse: true },
];

/** Half-hour appointments, mornings and afternoons. */
export const TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];

/** What a nurse practitioner sees; anything else is a doctor's visit. */
const NURSE_VISIT = /\b(vaccin\w*|shots?|jabs?|flu|booster|immuni[sz]\w*|blood|lab|travel|tetanus|covid)\b/i;

export interface Day { date: string; label: string; weekday: number }

export interface Appointment {
  ref: string;
  patient: string;
  clinician: Clinician['id'];
  date: string;
  time: string;
  reason: string;
  phone?: string;
  status: 'booked' | 'cancelled';
  /** Booked or cancelled on this call. */
  onCall?: 'booked' | 'cancelled';
}

export interface ToolResult {
  ok: boolean;
  /** What the receptionist reads, its outcome first. */
  text: string;
  /** The slots the result offered, for the page to light up. */
  offered?: { date: string; time: string; clinician: Clinician['id'] }[];
  appointment?: Appointment;
}

// ── dates in the clinic's time zone ─────────────────────────────────────────

/** The clinic's date (YYYY-MM-DD) and minutes past midnight at `now`. */
export function clinicNow(now: Date): { date: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const weekdayOf = (date: string) => utc(date).getUTCDay();
const addDays = (date: string, n: number) => { const d = utc(date); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** "Thursday, October 30". */
export const dayLabel = (date: string) => utc(date).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
/** "10:30 AM". */
export function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const minutesOf = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

/** The five working days the desk books: today while an appointment is still ahead, then the next ones. */
export function bookingDays(now: Date): Day[] {
  const { date, minutes } = clinicNow(now);
  const days: Day[] = [];
  let d = date;
  if (minutes >= minutesOf(TIMES[TIMES.length - 1])) d = addDays(d, 1);
  while (days.length < 5) {
    const weekday = weekdayOf(d);
    if (weekday >= 1 && weekday <= 5) days.push({ date: d, label: dayLabel(d), weekday });
    d = addDays(d, 1);
  }
  return days;
}

// ── what a caller says, as the desk reads it ────────────────────────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The booking day a caller means: "today", "tomorrow", "Thursday", "October 30", "the 30th", "2026-10-30"; null when none of the days. */
export function pickDay(days: Day[], input: unknown, today: string): Day | null {
  const text = String(input ?? '').toLowerCase().trim();
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return days.find((d) => d.date === iso[0]) ?? null;
  if (/\btoday\b/.test(text)) return days.find((d) => d.date === today) ?? null;
  if (/\btomorrow\b/.test(text)) return days.find((d) => d.date === addDays(today, 1)) ?? null;
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m.slice(0, 3)}\\w*\\b`).test(text));
  const dayNumber = text.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
  if (dayNumber) {
    const n = Number(dayNumber[1]);
    const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    const hit = days.find((d) => {
      const [, mm, dd] = d.date.split('-').map(Number);
      if (slash) return mm === Number(slash[1]) && dd === Number(slash[2]);
      return dd === n && (month < 0 || mm === month + 1);
    });
    if (hit) return hit;
  }
  const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w.slice(0, 3)}[a-z]*\\b`).test(text));
  if (weekday >= 0) return days.find((d) => d.weekday === weekday) ?? null;
  return null;
}

/** "10:30", "10.30 am", "2 pm", "2:30PM", "14:00" as 24-hour "HH:MM"; an hour from 1 to 7 with no AM or PM is the afternoon. */
export function pickTime(input: unknown): string | null {
  const text = String(input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\bnoon\b/.test(text)) return '12:00';
  // "10:30 am" first, then "2 pm", then a bare hour: a date beside the time ("October 30 at 10:30") is no hour.
  const m = text.match(/\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?/)
    ?? text.match(/\b(\d{1,2})()\s*(a\.?m\.?|p\.?m\.?)/)
    ?? text.match(/^(\d{1,2})()()$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const half = m[3]?.[0];
  if (h > 23 || min > 59) return null;
  if (half === 'p' && h < 12) h += 12;
  if (half === 'a' && h === 12) h = 0;
  if (!half && h >= 1 && h <= 7) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Words that ask for a kind of clinician, or anyone, rather than name one. */
const NOT_A_NAME = new Set(['a', 'an', 'the', 'any', 'anyone', 'anybody', 'someone', 'whoever', 'whichever', 'either',
  'available', 'free', 'first', 'next', 'earliest', 'same', 'usual', 'regular', 'my', 'our', 'one', 'or', 'and', 'please',
  'doctor', 'doctors', 'dr', 'nurse', 'nurses', 'practitioner', 'np', 'gp', 'physician', 'family', 'clinician', 'provider',
  'who', 'with', 'see', 'for', 'can', 'else', 'other', 'another', 'new', 'female', 'male', 'woman', 'man', 'lady']);

/**
 * A clinician the caller named who does not work here ("Dr. Smith", "Nurse Jones", "Smith"), as
 * said; null for a clinician who does, a kind of clinician ("a doctor", "the same doctor"), or none.
 */
export function unknownClinician(input: unknown): string | null {
  const text = String(input ?? '').toLowerCase();
  const said = text.split(/[^a-z'-]+/).filter(Boolean);
  if (namedClinicians(said).length) return null;
  const name = said.filter((w) => w.length > 2 && !NOT_A_NAME.has(w));
  return name.length ? String(input).trim() : null;
}

// Whole words only: "the same doctor" is not Dr. Sam Okafor.
const namedClinicians = (said: string[]) => {
  const words = new Set(said);
  return CLINICIANS.filter((c) => c.name.toLowerCase().split(/[\s.]+/).some((w) => w.length > 2 && w !== 'dr' && words.has(w)));
};

/**
 * The clinicians a caller asks for: a name ("Patel", "Dr. Okafor", "Lena"), "the nurse", "a doctor";
 * all when they name none, and none for a name of no one here (`unknownClinician`).
 */
export function pickClinicians(input: unknown): Clinician[] {
  const text = String(input ?? '').toLowerCase();
  const named = namedClinicians(text.split(/[^a-z]+/));
  if (named.length) return named;
  if (unknownClinician(input)) return [];
  if (/\bnurse|practitioner|\bnp\b/.test(text)) return CLINICIANS.filter((c) => c.nurse);
  if (/\bdoctor|\bdr\b|physician|\bgp\b/.test(text)) return CLINICIANS.filter((c) => !c.nurse);
  return CLINICIANS;
}

const noSuchClinician = (name: string) =>
  `no ${name} works at the clinic. Its clinicians are ${CLINICIANS.map((c) => `${c.short} (${c.role})`).join(', ')}. Ask which one they would like.`;
const isNurseVisit = (reason: unknown) => NURSE_VISIT.test(String(reason ?? ''));
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
const titleCase = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

// A taken slot is fixed for its day, clinician and time: the same week for every visitor on the same day.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

const PART = { morning: (t: string) => minutesOf(t) < 12 * 60, afternoon: (t: string) => minutesOf(t) >= 12 * 60 };

/** One visitor's front desk: the week, who is booked when, and the tools that change it. */
export class FrontDesk {
  readonly days: Day[];
  readonly today: string;
  readonly nowMinutes: number;
  appointments: Appointment[] = [];
  private refs = 4100;

  constructor(now = new Date()) {
    this.days = bookingDays(now);
    ({ date: this.today, minutes: this.nowMinutes } = clinicNow(now));
    // Two patients already booked, so a caller can find, move or cancel one.
    const okafor = this.days.filter((d) => CLINICIANS[1].days.includes(d.weekday));
    const fischer = this.days.filter((d) => CLINICIANS[2].days.includes(d.weekday));
    this.appointments.push(
      { ref: 'JFC-2741', patient: 'Maria Gomez', clinician: 'okafor', date: okafor[okafor.length - 1].date, time: '14:00', reason: 'a check-up', status: 'booked' },
      { ref: 'JFC-1836', patient: 'Daniel Kim', clinician: 'fischer', date: fischer[fischer.length - 1].date, time: '10:00', reason: 'a flu shot', status: 'booked' },
    );
  }

  works(c: Clinician, date: string) { return c.days.includes(weekdayOf(date)); }

  /** Who holds a slot: an appointment, another patient (most of the week), or nobody. */
  holder(date: string, time: string, clinician: Clinician['id']): 'open' | 'taken' | 'past' | Appointment {
    const here = this.appointments.filter((a) => a.date === date && a.time === time && a.clinician === clinician);
    const appt = here.find((a) => a.status === 'booked');
    if (appt) return appt;
    if (date === this.today && minutesOf(time) <= this.nowMinutes + 30) return 'past';
    // A cancelled appointment's slot is free again, whoever else the week has booked.
    if (here.length) return 'open';
    return hash(`${date}|${clinician}|${time}`) < 0.6 ? 'taken' : 'open';
  }

  isOpen(date: string, time: string, clinician: Clinician['id']) { return this.holder(date, time, clinician) === 'open'; }

  private daysWord() { return `${this.days[0].label} to ${this.days[this.days.length - 1].label}`; }

  check_availability(args: Record<string, unknown>): ToolResult {
    const asked = String(args.day ?? '').trim();
    const day = asked ? pickDay(this.days, asked, this.today) : null;
    if (asked && !day && !/\b(any|soon|next|earliest|first)\b/i.test(asked)) {
      return { ok: false, text: `Refused: the desk books only ${this.daysWord()}, on weekdays. Offer a day in that range.` };
    }
    const stranger = unknownClinician(args.who);
    if (stranger) return { ok: false, text: noSuchClinician(stranger) };
    const nurse = isNurseVisit(args.reason);
    const who = pickClinicians(args.who).filter((c) => !c.nurse || nurse || !String(args.reason ?? '').trim());
    const part = String(args.part_of_day ?? '').toLowerCase();
    const inPart = part.includes('morn') ? PART.morning : part.includes('after') ? PART.afternoon : () => true;
    const days = day ? [day] : this.days;
    const offered: NonNullable<ToolResult['offered']> = [];
    const pieces: string[] = [];
    for (const d of days) {
      const perDay: string[] = [];
      for (const c of who) {
        if (!this.works(c, d.date)) continue;
        const times = TIMES.filter((t) => inPart(t) && this.isOpen(d.date, t, c.id)).slice(0, 4);
        if (!times.length) continue;
        perDay.push(`${c.short} at ${times.map(timeLabel).join(', ')}`);
        offered.push(...times.map((time) => ({ date: d.date, time, clinician: c.id })));
      }
      if (perDay.length) pieces.push(`${d.label}: ${perDay.join('; ')}`);
      if (pieces.length >= 2 && !day) break;
    }
    const whoWords = who.length === CLINICIANS.length ? 'anyone' : who.map((c) => c.short).join(' or ');
    const when = `${day ? day.label : 'the next days'}${part.includes('morn') ? ' in the morning' : part.includes('after') ? ' in the afternoon' : ''}`;
    if (!pieces.length) {
      const away = day && who.length && who.every((c) => !this.works(c, day.date));
      return {
        ok: false,
        text: away
          ? `None open: ${who.map((c) => c.short).join(' and ')} ${who.length > 1 ? "don't" : "doesn't"} work on ${day!.label.split(',')[0]}s. Ask whether another day or clinician suits.`
          : `None open: nothing with ${whoWords} for ${when}. Ask whether another day, time of day or clinician suits.`,
      };
    }
    return { ok: true, text: `Open: ${pieces.join('. ')}. Offer two or three of these, never the whole list.`, offered };
  }

  book_appointment(args: Record<string, unknown>): ToolResult {
    const name = String(args.patient_name ?? '').trim();
    if (words(name).length < 2) return { ok: false, text: "Refused, nothing is booked: the desk needs the patient's first and last name. Ask for it." };
    const day = pickDay(this.days, args.day, this.today);
    if (!day) return { ok: false, text: `Refused, nothing is booked: the day must be one of ${this.daysWord()}. Ask which day.` };
    const time = pickTime(args.time);
    if (!time || !TIMES.includes(time)) return { ok: false, text: `Refused, nothing is booked: appointments start on the half hour, 9 AM to 11:30 AM and 1:30 PM to 4 PM. Ask for a time and check it first.` };
    const reason = String(args.reason ?? '').trim();
    if (!reason) return { ok: false, text: 'Refused, nothing is booked: the desk needs to know what the visit is for. Ask.' };
    const stranger = unknownClinician(args.who);
    if (stranger) return { ok: false, text: `Refused, nothing is booked: ${noSuchClinician(stranger)}` };
    const nurse = isNurseVisit(reason);
    const asked = pickClinicians(args.who);
    const fits = asked.filter((c) => !c.nurse || nurse);
    if (!fits.length) return { ok: false, text: `Refused, nothing is booked: ${asked.map((c) => c.short).join(' and ')} sees only vaccinations, flu shots, blood tests and travel shots. Offer Dr. Patel or Dr. Okafor.` };
    const working = fits.filter((c) => this.works(c, day.date));
    if (!working.length) return { ok: false, text: `Refused, nothing is booked: ${fits.map((c) => c.short).join(' and ')} ${fits.length > 1 ? "don't" : "doesn't"} work on ${day.label.split(',')[0]}s. Check another day.` };
    const free = working.find((c) => this.isOpen(day.date, time, c.id));
    if (!free) {
      const alt = this.check_availability({ day: day.date, who: working.map((c) => c.name).join(' '), reason });
      return { ok: false, text: `Refused, nothing is booked: ${timeLabel(time)} on ${day.label} is taken. ${alt.ok ? alt.text : 'Nothing else is open that day; check another day.'}`, offered: alt.offered };
    }
    const appointment: Appointment = {
      ref: `JFC-${++this.refs}`, patient: titleCase(name), clinician: free.id, date: day.date, time, reason,
      ...(args.phone ? { phone: String(args.phone).slice(0, 40) } : {}), status: 'booked', onCall: 'booked',
    };
    this.appointments.push(appointment);
    return {
      ok: true, appointment,
      text: `Booked: ${appointment.patient} with ${free.name} on ${day.label} at ${timeLabel(time)}, for ${reason}. Reference ${appointment.ref.replace('-', ' ')}. Read the day, the time and who it is with back to the caller, and remind them to come ten minutes early.`,
    };
  }

  /** The booked appointments under a name ("Maria Gomez", "Gomez", "Maria" when only one has it) or a reference. */
  private findBooked(args: Record<string, unknown>): Appointment[] {
    const ref = String(args.reference ?? '').replace(/\D/g, '');
    const booked = this.appointments.filter((a) => a.status === 'booked');
    if (ref.length >= 4) return booked.filter((a) => a.ref.endsWith(ref.slice(-4)));
    const asked = words(String(args.patient_name ?? ''));
    if (!asked.length) return [];
    return booked.filter((a) => asked.every((w) => words(a.patient).includes(w)));
  }

  find_appointments(args: Record<string, unknown>): ToolResult {
    const found = this.findBooked(args);
    if (!found.length) return { ok: false, text: `Not found: no appointment under ${String(args.patient_name || args.reference || 'that name')}. Ask them to spell the last name, or offer to book one.` };
    return { ok: true, text: `Found: ${found.map((a) => this.describe(a)).join('; ')}.` };
  }

  cancel_appointment(args: Record<string, unknown>): ToolResult {
    let found = this.findBooked(args);
    const day = pickDay(this.days, args.day, this.today);
    if (day) found = found.filter((a) => a.date === day.date);
    if (!found.length) return { ok: false, text: `Not cancelled: no appointment under ${String(args.patient_name || args.reference || 'that name')}${day ? ` on ${day.label}` : ''}. Ask them to spell the last name.` };
    if (found.length > 1) return { ok: false, text: `Not cancelled yet: there are ${found.length}: ${found.map((a) => this.describe(a)).join('; ')}. Ask which one.` };
    const appt = found[0];
    appt.status = 'cancelled';
    appt.onCall = 'cancelled';
    return { ok: true, appointment: appt, text: `Cancelled: ${this.describe(appt)}. That time is open again. Ask whether they would like another time.` };
  }

  describe(a: Appointment): string {
    const c = CLINICIANS.find((x) => x.id === a.clinician)!;
    return `${a.patient} with ${c.name} on ${dayLabel(a.date)} at ${timeLabel(a.time)}, for ${a.reason} (reference ${a.ref.replace('-', ' ')})`;
  }

  /** Runs one of the tools by name. */
  run(name: string, args: Record<string, unknown>): ToolResult {
    switch (name) {
      case 'check_availability': return this.check_availability(args);
      case 'book_appointment': return this.book_appointment(args);
      case 'cancel_appointment': return this.cancel_appointment(args);
      case 'find_appointments': return this.find_appointments(args);
      default: return { ok: false, text: `error: the desk has no tool named ${name}` };
    }
  }
}

// ── what the clinic's server pins for every call ────────────────────────────

const text = (description: string) => ({ type: 'string', description });

/** The receptionist's tools (OpenAI function shape), lenient: the desk reads what arrives. */
export const TOOLS = [
  {
    type: 'function' as const,
    name: 'check_availability',
    description: "Look at the clinic's appointment book for open times. Always do this before you offer a caller any time, and again when they ask for another day or clinician.",
    parameters: { type: 'object', properties: {
      day: text('The day the caller wants, as they said it: "today", "tomorrow", "Thursday", "October 30". Empty for the next open days.'),
      who: text('The clinician they asked for ("Dr. Patel", "the nurse"), or empty for anyone.'),
      part_of_day: text('"morning" or "afternoon", or empty.'),
      reason: text('What the visit is for, in a few words ("a check-up", "a flu shot").'),
    } },
  },
  {
    type: 'function' as const,
    name: 'book_appointment',
    description: 'Book the appointment in the clinic\'s book. Only once the caller has said yes to a time you checked, and you have their first and last name and what the visit is for.',
    parameters: { type: 'object', properties: {
      patient_name: text("The patient's first and last name."),
      day: text('The day, as offered ("Thursday, October 30").'),
      time: text('The time, as offered ("10:30 AM").'),
      who: text('The clinician, as offered.'),
      reason: text('What the visit is for.'),
      phone: text('A phone number, if the caller gave one.'),
    } },
  },
  {
    type: 'function' as const,
    name: 'cancel_appointment',
    description: "Cancel a patient's appointment, once they have asked you to.",
    parameters: { type: 'object', properties: {
      patient_name: text("The patient's name."),
      day: text('The day of the appointment, if they said it.'),
      reference: text('The appointment reference, if they have it ("JFC 2741").'),
    } },
  },
  {
    type: 'function' as const,
    name: 'find_appointments',
    description: 'Look up the appointments booked under a name: when a caller asks when theirs is, or wants to move one (find it, check a new time, book it, then cancel the old one).',
    parameters: { type: 'object', properties: {
      patient_name: text("The patient's name."),
      reference: text('The appointment reference, if they have it.'),
    } },
  },
];

/** How the receptionist works the phone and the book. */
export const RULES = `This is a phone call with a patient: voice only, no screen. Keep every reply to one or two short sentences and ask one thing at a time. Use the tools only for what the caller has asked: greeting them needs none.

The appointment book is the only truth about times. Never offer, confirm or invent a time you have not just seen in a check_availability result, and never say something is booked or cancelled unless book_appointment or cancel_appointment said so. Each tool result starts with its outcome ("Open:", "Booked:", "Refused, nothing is booked:", "Cancelled:", "Not found:"): say what it says, and when it was refused, ask for what it asks for.

To book: find out what the visit is for and when suits the caller, check the book, offer two or three open times, then get the patient's first and last name and book the one they choose. Then read back the day, the time, the clinician and the reference.
To cancel or move: get the patient's name, find the appointment, and cancel it only once they confirm which one.

Say times the way people do ("ten thirty in the morning"), and dates as a weekday and a date. Spell a reference out in letters and digits.
The desk gives no medical advice. For chest pain, trouble breathing or anything urgent, tell the caller to hang up and call 911.`;

/** What the clinic is, for the receptionist's answers. */
export function clinicFacts(): string {
  const staff = CLINICIANS.map((c) => `${c.name}, ${c.role}, works ${c.days.map((d) => WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1, 3)).join(', ')}${c.nurse ? ' and sees only vaccinations, flu shots, blood tests and travel shots' : ''}`);
  return [
    `${CLINIC.name} is a small family practice at ${CLINIC.address}; phone ${CLINIC.phone}.`,
    `Open ${CLINIC.hours}. Appointments are half an hour, booked up to five working days ahead. No walk-ins.`,
    `Clinicians: ${staff.join('; ')}.`,
    'New patients are welcome: bring a photo ID and an insurance card and arrive ten minutes early. Most insurance plans are accepted, and self-pay visits are $120.',
    'Free parking behind the building; the 14 bus stops at the corner of Alder and 4th.',
  ].join('\n');
}
