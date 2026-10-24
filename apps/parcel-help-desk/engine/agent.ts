// Waybill's own agent: the app's model (Gemini), the app's tools (the desk in
// parcels.ts) and the app's prompt. It answers a customer's turn in words to
// be spoken; the app voices them and Tess is the face that says them. None of
// this goes through Atmee: in the avatar-only way the avatar only renders.
import type { Desk, Outcome, Parcel } from './parcels.ts';

// The lite model answers in about 1.5 s a call against 6 s for flash, and a turn with a tool is two calls.
const MODEL = process.env.WAYBILL_MODEL || 'gemini-3.5-flash-lite';
const MAX_STEPS = 4;   // model calls per turn: tool rounds, then the answer

export const GREETING = "Hi, I'm Tess from the Waybill help desk. What's your tracking number? It starts with W B.";

const SYSTEM = `You are Tess, the help-desk agent of Waybill, a parcel delivery company. You talk with a customer about their parcel; what you write is spoken aloud by Waybill's voice through your face on screen.

How you speak: one to three short spoken sentences, plain conversational English, no lists, markdown, emojis or headings. Say tracking numbers back in groups ("W B, 4821, 7730"), dates as words, times as "midday" or "two in the afternoon" where natural.

What you know comes only from your tools. Never state a parcel's status, place, date, address or claim number unless a tool returned it in this conversation. If you do not have the tracking number, ask for it; if a lookup fails, say so and ask them to read it again.

What you can do: look a parcel up; book a redelivery on one of the days the lookup offers; send it to one of the pickup points it offers; add a missing flat number so a held parcel is released; open a claim for a parcel marked delivered that never reached them. Offer the fix that fits the problem, and act only once the customer has chosen. After a fix, confirm what changed in one sentence. If a tool refuses, explain why in your own words and offer what it suggests.`;

const TOOLS = [{
  functionDeclarations: [
    { name: 'lookup_parcel', description: "Look up a parcel by its tracking number (WB and eight digits, as the customer gave it). Returns its status, route, latest event, any problem, and the days and pickup points it can move to.",
      parameters: { type: 'OBJECT', properties: { tracking: { type: 'STRING' } }, required: ['tracking'] } },
    { name: 'reschedule_delivery', description: 'Book a redelivery on a day the lookup offered (a weekday name or a date).',
      parameters: { type: 'OBJECT', properties: { tracking: { type: 'STRING' }, day: { type: 'STRING' } }, required: ['tracking', 'day'] } },
    { name: 'send_to_pickup_point', description: 'Send the parcel to one of the pickup points the lookup offered, to collect it there.',
      parameters: { type: 'OBJECT', properties: { tracking: { type: 'STRING' }, point: { type: 'STRING' } }, required: ['tracking', 'point'] } },
    { name: 'add_flat_number', description: 'Add the missing flat number to a parcel held at the depot for an incomplete address; it is then released for delivery.',
      parameters: { type: 'OBJECT', properties: { tracking: { type: 'STRING' }, flat: { type: 'STRING' } }, required: ['tracking', 'flat'] } },
    { name: 'open_claim', description: 'Open a claim for a parcel marked delivered that the customer never received (or that arrived damaged).',
      parameters: { type: 'OBJECT', properties: { tracking: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['tracking', 'reason'] } },
  ],
}];

/** One tool call the agent made this turn, for the page's "under the hood" view. */
export interface Step { name: string; args: Record<string, unknown>; ok: boolean }

export interface Turn { reply: string; steps: Step[]; parcel: Parcel | null }

/** The conversation so far, in Gemini's shape (the model's own turns kept as it sent them). */
export type History = { role: 'user' | 'model'; parts: unknown[] }[];

export function runTool(desk: Desk, name: string, args: Record<string, unknown>): Outcome {
  switch (name) {
    case 'lookup_parcel': return desk.lookup(args.tracking);
    case 'reschedule_delivery': return desk.reschedule(args.tracking, args.day);
    case 'send_to_pickup_point': return desk.sendToPickupPoint(args.tracking, args.point);
    case 'add_flat_number': return desk.completeAddress(args.tracking, args.flat);
    case 'open_claim': return desk.openClaim(args.tracking, args.reason);
    default: return { result: { ok: false, refused: `No tool called ${name}.` } };
  }
}

type Generate = (body: unknown) => Promise<any>;

const gemini: Generate = async (body) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`${MODEL}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

/**
 * The agent's answer to the customer's `text`: tool rounds as the model asks
 * for them, then its words. `history` grows with the turn (the caller keeps it).
 */
export async function answer(desk: Desk, history: History, text: string, generate: Generate = gemini): Promise<Turn> {
  history.push({ role: 'user', parts: [{ text }] });
  const steps: Step[] = [];
  let parcel: Parcel | null = null;
  for (let step = 0; step < MAX_STEPS; step++) {
    const json = await generate({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: history, tools: TOOLS, generationConfig: { temperature: 0.3 } });
    const content = json.candidates?.[0]?.content;
    const parts: any[] = content?.parts ?? [];
    // The model's turn goes back as it came (its thought signatures with it).
    history.push({ role: 'model', parts });
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall as { name: string; args?: Record<string, unknown> });
    if (!calls.length) {
      const reply = parts.map((p) => p.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
      return { reply: reply || "Sorry, I lost my train of thought. Could you say that again?", steps, parcel };
    }
    const responses = calls.map((call) => {
      const outcome = runTool(desk, call.name, call.args ?? {});
      steps.push({ name: call.name, args: call.args ?? {}, ok: outcome.result.ok === true });
      if (outcome.parcel) parcel = outcome.parcel;
      return { functionResponse: { name: call.name, response: outcome.result } };
    });
    history.push({ role: 'user', parts: responses });
  }
  return { reply: "Sorry, that took me too many steps. Could you tell me once more what you need?", steps, parcel };
}

/** The customer's words from a recording (a WAV of their held-down microphone), by the same model. */
export async function transcribe(wavBase64: string, generate: Generate = gemini): Promise<string> {
  const json = await generate({
    contents: [{ role: 'user', parts: [
      { text: 'Transcribe what the customer says, exactly, as plain text. Write tracking numbers as digits (W B four eight two one becomes WB 4821). If nothing is said, answer with nothing.' },
      { inline_data: { mime_type: 'audio/wav', data: wavBase64 } },
    ] }],
    generationConfig: { temperature: 0 },
  });
  return String(json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join(' ') ?? '').trim();
}
