import { describe, expect, test } from 'vitest';
import { answer, runTool, type History } from './agent.ts';
import { createDesk, deliveryDays, normalizeTracking, pickDay } from './parcels.ts';

const DAYS = deliveryDays(new Date('2026-10-24T10:00:00Z')); // a Saturday

describe('the days a delivery can move to', () => {
  test('the next five working days, weekends skipped', () => {
    expect(DAYS).toEqual(['Monday 26 October', 'Tuesday 27 October', 'Wednesday 28 October', 'Thursday 29 October', 'Friday 30 October']);
  });
  test('a customer names one by weekday or by date', () => {
    expect(pickDay(DAYS, 'Wednesday please')).toBe('Wednesday 28 October');
    expect(pickDay(DAYS, 'the 29th')).toBe('Thursday 29 October');
    expect(pickDay(DAYS, 'Saturday')).toBeNull();
    expect(pickDay(DAYS, '')).toBeNull();
  });
});

describe('tracking numbers, typed or heard', () => {
  test('WB and eight digits, however written', () => {
    expect(normalizeTracking('wb 1907 2264')).toBe('WB-1907-2264');
    expect(normalizeTracking('WB-1907-2264')).toBe('WB-1907-2264');
    expect(normalizeTracking('19072264')).toBe('WB-1907-2264');
    expect(normalizeTracking('WB 1907')).toBeNull();
  });
});

describe("the desk's rules: what each parcel's fix allows", () => {
  test('a missed delivery is rebooked on an offered day, and the parcel says so', () => {
    const desk = createDesk(DAYS);
    const out = desk.reschedule('WB 1907 2264', 'Wednesday');
    expect(out.result.ok).toBe(true);
    expect(out.parcel?.eta).toContain('Wednesday 28 October');
    expect(out.parcel?.events[0].what).toBe('Redelivery booked for Wednesday 28 October');
  });

  test('a day not offered is refused with the days that are', () => {
    const out = createDesk(DAYS).reschedule('WB-1907-2264', 'Sunday');
    expect(out.result).toMatchObject({ ok: false });
    expect(String(out.result.refused)).toContain('Monday 26 October');
  });

  test('a held parcel is released only with a real flat number', () => {
    const desk = createDesk(DAYS);
    expect(desk.reschedule('WB-6650-0193', 'Monday').result.ok).toBe(false);
    expect(desk.completeAddress('WB-6650-0193', 'flat 40').result.ok).toBe(false);
    const out = desk.completeAddress('WB-6650-0193', 'flat 7');
    expect(out.result.ok).toBe(true);
    expect(out.parcel?.to).toBe('Flat 7, 9 Mill Street, Manchester');
  });

  test('a claim is for a delivered parcel, once', () => {
    const desk = createDesk(DAYS);
    expect(desk.openClaim('WB-4821-7730', 'not here').result.ok).toBe(false);
    const first = desk.openClaim('WB-3302-5518', 'never received');
    expect(first.result).toMatchObject({ ok: true, claim: 'CL-330218' });
    expect(desk.openClaim('WB-3302-5518', 'again').result).toMatchObject({ alreadyOpen: true });
  });

  test('a pickup point must be one of the town’s', () => {
    const desk = createDesk(DAYS);
    expect(desk.sendToPickupPoint('WB-1907-2264', 'Kirkgate').result.ok).toBe(false);
    expect(desk.sendToPickupPoint('WB-1907-2264', 'temple meads').parcel?.pickupPoint).toBe('Temple Meads station lockers');
  });

  test('each visitor has their own copy', () => {
    const a = createDesk(DAYS);
    a.reschedule('WB-1907-2264', 'Monday');
    expect(createDesk(DAYS).find('WB-1907-2264')?.status).toBe('delivery_failed');
  });

  test('an unknown tool is refused, not thrown', () => {
    expect(runTool(createDesk(DAYS), 'refund_everything', {}).result.ok).toBe(false);
  });
});

describe("the app's own agent: the model asks for tools, the desk answers, the model speaks", () => {
  test('a lookup round, then words; the parcel and the step come back', async () => {
    const desk = createDesk(DAYS);
    const history: History = [];
    const seen: any[] = [];
    const replies = [
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'lookup_parcel', args: { tracking: 'wb 1907 2264' } }, thoughtSignature: 'sig' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'We missed you yesterday.' }] } }] },
    ];
    const turn = await answer(desk, history, 'Where is WB 1907 2264?', async (body: any) => { seen.push(structuredClone(body)); return replies.shift(); });
    expect(turn.reply).toBe('We missed you yesterday.');
    expect(turn.steps).toEqual([{ name: 'lookup_parcel', args: { tracking: 'wb 1907 2264' }, ok: true }]);
    expect(turn.parcel?.tracking).toBe('WB-1907-2264');
    // The model's own turn goes back as it came, signature and all, then the desk's answer.
    expect(seen[1].contents[1].parts[0].thoughtSignature).toBe('sig');
    expect(seen[1].contents[2].parts[0].functionResponse.response.parcel.status).toBe('Delivery attempted');
  });

  test('a model that keeps calling tools gets a way out, not a loop', async () => {
    const loop = async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'lookup_parcel', args: { tracking: 'WB-1907-2264' } } }] } }] });
    const turn = await answer(createDesk(DAYS), [], 'hello', loop);
    expect(turn.steps).toHaveLength(4);
    expect(turn.reply).toMatch(/too many steps/);
  });
});
