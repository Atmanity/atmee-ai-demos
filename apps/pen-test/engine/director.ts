// What the guest is told. The persona keeps them a customer; this keeps them on the game's
// script: terse, and never saying yes until the rules do.
import type { AppTool } from '../../../server/app-server.ts';
import { PEN, gateOpen, topNow, type Round, type Step } from './rules.ts';

export const TOOLS: AppTool[] = [{
  type: 'function', name: 'decide',
  description: 'Says what you decided. Call it when you are done talking for good ("end"), or when GUEST DIRECTION says YOU MAY BUY and you agree ("buy").',
  parameters: { type: 'object', properties: { choice: { type: 'string', description: 'buy or end' } }, required: ['choice'] },
  'x-atmee': { mode: 'notify' },
}];

/** The secrets of this run, sent with the session so the seller's page never holds them. */
export function secretInstructions(round: Round): string {
  return [
    'You stay calm and still, facing the camera. The seller always speaks first and leads the conversation.',
    'Be brief: most replies are under eight words, one sentence at most. Never ask what they want, never offer help, never fill a silence, never carry the conversation. Only answer what was said.',
    `Your private need, which you never state outright: ${round.motive.need}`,
    'Let a small piece of it out only when the seller asks a real question about your day, your work or what you use.',
    `Your objection, to say once and only when the direction asks for it: "${round.motive.objection}"`,
    `The pen on offer is the ${PEN.name}. What is true of it: ${PEN.facts.join('; ')}.`,
    'If you are silent for a while and must speak, say only "Yes?" or "Hm?".',
    'Call decide only as its description says.',
  ].join('\n');
}

const mood = (interest: number) => (interest < 25 ? 'You are not interested.'
  : interest < 45 ? 'You are mildly curious, but still guarded.'
    : interest < 65 ? 'You are warming up, and you listen properly now.'
      : 'You like this pen and can see yourself using it.');

/** The state line after each thing the seller says. */
export function direction(round: Round, step: Step = {}): string {
  const parts = ['GUEST DIRECTION:', mood(round.interest)];
  if (step.sold) parts.push(`YOU MAY BUY at $${step.sold}. Say yes in a few words and call decide with buy.`);
  else if (step.walked) parts.push('You have had enough. Say you are not interested and call decide with end.');
  else {
    parts.push('You are still making up your mind, so hold off on buying. Answer what they just said in your own words, and never open with a yes or a no out of habit.');
    if (step.challenge) parts.push(`That sounded untrue: challenge this claim briefly: ${step.challenge}.`);
    else if (step.haggle) parts.push(`You want the pen, so say so, but the price has to come down: ask for $${step.counter} a pen. Do not close the deal yet.`);
    else if (step.objection) parts.push(`Say your objection now: "${round.motive.objection}"`);
    else if (step.refused) parts.push(`They offered $${step.refused}, which sounds suspiciously cheap. Say so briefly.`);
    else if (step.revealNeed) parts.push('That was a fair question: let one small piece of your need out, in a few words.');
    else if (gateOpen(round)) parts.push('If they ask you to buy, you would consider it.');
    if (round.objectionRaised && !step.objection) parts.push('You have said your objection already: do not repeat it.');
    if (round.offer !== null && round.offer > topNow(round)) parts.push(`$${round.offer} is more than you want to pay.`);
  }
  parts.push('Reply in under eight words, and never repeat a line you have said. Never say you are leaving or in a hurry.');
  return parts.join(' ');
}

/** After a sale, or when the guest walks, the guest speaks one last time at once. */
export const closingEvent = (step: Step) => (step.sold
  ? `You have decided to buy at $${step.sold}. Say yes in a few words and take the pen.`
  : 'You have had enough. Say you are not interested.');
