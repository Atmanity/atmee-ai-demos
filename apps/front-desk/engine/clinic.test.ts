import { describe, expect, test } from 'vitest';
import { CLINICIANS, FrontDesk, RULES, TOOLS, bookingDays, clinicFacts, pickClinicians, pickDay, pickTime } from './clinic.ts';

// Monday 26 October 2026, 8 AM in Portland (15:00 UTC).
const MONDAY = new Date('2026-10-26T15:00:00Z');

describe('the days the desk books', () => {
  test("the next five working days in the clinic's own time zone, today included while it has appointments left", () => {
    expect(bookingDays(MONDAY).map((d) => d.label)).toEqual(['Monday, October 26', 'Tuesday, October 27', 'Wednesday, October 28', 'Thursday, October 29', 'Friday, October 30']);
    // 5 PM Friday in Portland is already Saturday in UTC: the week still starts on Monday.
    expect(bookingDays(new Date('2026-10-31T00:00:00Z'))[0].label).toBe('Monday, November 2');
  });

  test('a caller names one by weekday, date, "tomorrow" or ISO date; a weekend is none', () => {
    const days = bookingDays(MONDAY);
    expect(pickDay(days, 'Thursday', '2026-10-26')?.date).toBe('2026-10-29');
    expect(pickDay(days, 'thurs', '2026-10-26')?.date).toBe('2026-10-29');
    expect(pickDay(days, 'Thursday, October 29', '2026-10-26')?.date).toBe('2026-10-29');
    expect(pickDay(days, 'the 28th', '2026-10-26')?.date).toBe('2026-10-28');
    expect(pickDay(days, 'tomorrow', '2026-10-26')?.date).toBe('2026-10-27');
    expect(pickDay(days, '2026-10-30', '2026-10-26')?.date).toBe('2026-10-30');
    expect(pickDay(days, 'Saturday', '2026-10-26')).toBeNull();
    expect(pickDay(days, 'November 12', '2026-10-26')).toBeNull();
  });

  test('times as people say them, the afternoon assumed for a bare 1 to 7', () => {
    expect(pickTime('10:30 AM')).toBe('10:30');
    expect(pickTime('2 pm')).toBe('14:00');
    expect(pickTime('2:30')).toBe('14:30');
    expect(pickTime('9')).toBe('09:00');
    expect(pickTime('Thursday, October 29 at 10:30')).toBe('10:30');
    expect(pickTime('whenever')).toBeNull();
  });

  test('clinicians by name, role or not at all', () => {
    expect(pickClinicians('Dr. Patel').map((c) => c.id)).toEqual(['patel']);
    expect(pickClinicians('the nurse').map((c) => c.id)).toEqual(['fischer']);
    expect(pickClinicians('any doctor').map((c) => c.id)).toEqual(['patel', 'okafor']);
    expect(pickClinicians('').length).toBe(3);
  });
});

describe('the book, as the tools change it', () => {
  test('availability lists open times only, leading with the outcome', () => {
    const desk = new FrontDesk(MONDAY);
    const r = desk.check_availability({ day: 'Thursday', part_of_day: 'morning', reason: 'a check-up' });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/^Open: Thursday, October 29: /);
    expect(r.offered!.length).toBeGreaterThan(0);
    for (const o of r.offered!) {
      expect(desk.isOpen(o.date, o.time, o.clinician)).toBe(true);
      expect(o.time < '12:00').toBe(true);
      expect(o.clinician).not.toBe('fischer');   // a check-up is a doctor's
    }
  });

  test("a day off is said as one, not as a full book", () => {
    const r = new FrontDesk(MONDAY).check_availability({ day: 'Monday', who: 'Dr. Okafor' });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("None open: Dr. Okafor doesn't work on Mondays. Ask whether another day or clinician suits.");
  });

  test('a day outside the week is refused with the days it can book', () => {
    const r = new FrontDesk(MONDAY).check_availability({ day: 'Saturday' });
    expect(r).toMatchObject({ ok: false });
    expect(r.text).toContain('Monday, October 26 to Friday, October 30');
  });

  test('a booking needs a full name, an offered day, a slot and a reason, and takes the slot', () => {
    const desk = new FrontDesk(MONDAY);
    const open = desk.check_availability({ day: 'Thursday', reason: 'a check-up' }).offered![0];
    const who = CLINICIANS.find((c) => c.id === open.clinician)!.name;
    expect(desk.book_appointment({ patient_name: 'Jordan', day: 'Thursday', time: open.time, who, reason: 'a check-up' }).text).toMatch(/^Refused, nothing is booked: .*first and last name/);
    expect(desk.book_appointment({ patient_name: 'Jordan Lee', day: 'Thursday', time: '12:15', who, reason: 'a check-up' }).text).toMatch(/^Refused, nothing is booked: appointments start on the half hour/);
    const booked = desk.book_appointment({ patient_name: 'jordan lee', day: 'Thursday, October 29', time: open.time, who, reason: 'a check-up' });
    expect(booked.ok).toBe(true);
    expect(booked.text).toMatch(/^Booked: Jordan Lee with .* on Thursday, October 29 at .*Reference JFC 4101\./);
    expect(desk.isOpen(open.date, open.time, open.clinician)).toBe(false);
    // The same slot again: refused, with what is open instead.
    const again = desk.book_appointment({ patient_name: 'Sam Rivera', day: 'Thursday', time: open.time, who, reason: 'a check-up' });
    expect(again.text).toMatch(/^Refused, nothing is booked: .* is taken\. Open: /);
  });

  test('the nurse practitioner sees only nurse visits', () => {
    const desk = new FrontDesk(MONDAY);
    expect(desk.book_appointment({ patient_name: 'Ana Ruiz', day: 'Wednesday', time: '10:00', who: 'the nurse', reason: 'a sore throat' }).text)
      .toMatch(/sees only vaccinations/);
    const shot = desk.check_availability({ reason: 'a flu shot', who: 'nurse' });
    expect(shot.offered!.every((o) => o.clinician === 'fischer')).toBe(true);
  });

  test('a cancellation finds the patient by name, frees the slot, and asks when there are two', () => {
    const desk = new FrontDesk(MONDAY);
    const maria = desk.appointments.find((a) => a.patient === 'Maria Gomez')!;
    expect(desk.cancel_appointment({ patient_name: 'Mario Gomes' }).text).toMatch(/^Not cancelled: no appointment/);
    const r = desk.cancel_appointment({ patient_name: 'maria gomez' });
    expect(r.text).toMatch(/^Cancelled: Maria Gomez with Dr. Sam Okafor on Friday, October 30 at 2:00 PM/);
    expect(desk.isOpen(maria.date, maria.time, maria.clinician) || desk.holder(maria.date, maria.time, maria.clinician) === 'taken').toBe(true);
    expect(desk.find_appointments({ patient_name: 'Maria Gomez' }).ok).toBe(false);

    const kim = desk.appointments.find((a) => a.patient === 'Daniel Kim')!;
    const second = desk.check_availability({ reason: 'a blood test', who: 'nurse' }).offered!.find((o) => o.date !== kim.date)!;
    desk.book_appointment({ patient_name: 'Daniel Kim', day: second.date, time: second.time, who: 'nurse', reason: 'a blood test' });
    expect(desk.cancel_appointment({ patient_name: 'Daniel Kim' }).text).toMatch(/^Not cancelled yet: there are 2/);
    expect(desk.cancel_appointment({ patient_name: 'Daniel Kim', reference: 'JFC 1836' }).ok).toBe(true);
  });

  test('a past time today is never offered', () => {
    // 10:05 AM in Portland: 10:30 is too soon, 11:00 is the first.
    const desk = new FrontDesk(new Date('2026-10-26T17:05:00Z'));
    const today = desk.check_availability({ day: 'today' }).offered ?? [];
    expect(today.every((o) => o.time >= '11:00')).toBe(true);
  });
});

describe('what the server pins', () => {
  test('within the speech API limits: instructions 8,000 characters, facts 4,000, tools 24,576 bytes', () => {
    expect(RULES.length).toBeLessThan(8000);
    expect(clinicFacts().length).toBeLessThan(4000);
    expect(new TextEncoder().encode(JSON.stringify(TOOLS)).length).toBeLessThan(24_576);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  test('every tool the model may call is one the desk runs', () => {
    const desk = new FrontDesk(MONDAY);
    for (const t of TOOLS) expect(desk.run(t.name, {}).text).not.toMatch(/no tool named/);
  });
});
