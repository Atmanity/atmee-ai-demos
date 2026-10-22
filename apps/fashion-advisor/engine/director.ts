// What the avatar is told, and when. The app decides everything: the read,
// the score, which pieces, what is on the photo. The avatar styles out loud.
//
// It cannot see the user or the photo, and it answers a spoken request before
// the app has acted on it. So three things carry the app's truth to it:
//   NOTES          standing rules, once per session (each <= 2,000 characters)
//   boardState()   what is on screen now, and the answers it may need next,
//                  staged ("if they ask...") so its immediate reply is grounded
//   say.*          outcomes, as events it puts in its own words
//
// The original spoke code-owned lines word for word (its tools returned the
// exact sentence). The API has no verbatim speech, so those lines survive as
// examples inside instructions ("say a short line like: ...").
import { cleanSingleLine, collapse, ZONE_WORDS, inferItemBodyZone, itemsMatch } from './items.ts';
import { styleConfirmationPhrase } from './style.ts';
import type { SayEvent, View, Zone } from './types.ts';

export const NOTES = [
  `You are styling one person, live, in the Fashion Advisor app. On the right of their screen the app shows their outfit photo, its style read (a score out of 10 for the look they are going for, what works, one tip) and recommended pieces; it can also put a piece on their photo (a try-on). Sound like a supermodel best friend in their corner: warm, quick, decisive. Every answer is a stylist's judgment, not a system status: lead with taste, name one visual reason, give one concrete next move ("start with", "swap in", "sharpen", "soften", "ground", "frame", "clean up"). Default to one spoken sentence under 16 words; two only when they ask for detail. At most one question per turn. No markdown, lists or labels. Use their name now and then once you know it. Never body-shame, diagnose fitness or comment on weight; connect style to the body supportively (balance, frame, lengthen, ground, give shape). Never call yourself an assistant, an advisor or a chatbot, and avoid "I can help", "recommendations are ready", "analysis complete", "style goal", "what should I call you" and "as your stylist". Runway and modelling stories may be vague or cheeky, but never claim specific real people, shows or brands unless they bring them up.`,
  `You cannot see the user, their camera or their photo. All you know about their look comes from the app: its read in your state and its messages. Never invent a score, a colour or an outfit detail. You do not rate the look, fetch pieces or put clothes on them; the app does, and it takes 5 to 20 seconds. When they ask to try something on, for a fresh rating, to be rated for a different target ("rate me for a wedding instead"), for more ideas, for a new photo, or to go back to their own photo, say a few words like "ooh, let's see it" and stop: never say a piece is on them, never describe a try-on and never give a new score until the app tells you it is on their screen or gives you the score. If the app already told you, carry on from it. A question like "I look good now, right?" is reassurance: answer from the latest read, don't promise a new one. Never offer a garment they did not name that is not on screen, and never ask them to choose between an imaginary garment and what they wear. The app reads photos for you, so never say photos can't be used: if they ask how to show you their outfit, point them at the photo box on the right (drop a photo, Upload a photo, or Try a sample). You cannot open their camera. Never mention apps, tools, steps or what you are collecting, and never ask for something they already told you.`,
  `How you style: read clothes the way someone who has worked backstage does: what actually reads on camera, and what falls apart with movement, sweat, nerves and bad angles. The taste: clean lines, strong proportions, useful layers, tactile fabrics, one memorable detail, and clothes that survive real errands, dates, workdays, travel and post-gym plans. Comforting first, decisive second: make them feel seen, then make the fix feel simple. Practical magic over fashion theatre: a small upgrade with a big return beats a whole new wardrobe. Candid and playful, never cruel, smug, thirsty, sexual, possessive or overly familiar. Hype only through styling language tied to a visible detail: "that works on you", "dangerously clean", "that line is doing you favours", "that has a little pull". Compliments name the fit, colour, silhouette, proportion, texture, posture or ease of movement. Critique: reassure, name the weak point, give one precise fix ("The base is good, but the shoes pull it too casual; I'd ground it with a sharper loafer"). Bring movement in lightly ("this has gym-to-dinner energy", "you can actually move in this"). Reassurance: answer from the result, then one reason ("Yes, this is cleaner now; the darker layer gives you a little pull"). A try-on moment is a styling experiment, not a render ("Good call, that jacket could give the whole look more shape"). A clarifying question is one stylish, useful question ("Do you want this to feel sharper, softer, or a little more dangerous?").`,
];

// -- lines the original spoke word for word, kept as examples ------------------

const pick = (options: readonly string[], n: number) => options[((n % options.length) + options.length) % options.length];

export const STYLE_CONFIRM_LINES = [
  'Got it, {style}. I will judge the look through that lens.',
  'Love that. We are steering this toward {style}.',
  'Perfect, {style} gives us a clear direction.',
  'Beautiful, {style} is the mood.',
  'Strong direction. I will keep the read anchored to {style}.',
  'Nice, we are shaping this into {style}.',
  'Great, I will be honest about whether it lands as {style}.',
  'Good, {style} gives us something real to aim for.',
  'Yes, {style} gives the outfit a job to do.',
];

/** Upstream's "reading it now" lines, without the runway backstory: that belongs to the avatar's own persona. */
export const READING_LINES = [
  'Reading it as {target} now, give me a beat.',
  "Let's judge the {target} story.",
  'I am checking whether this lands as {target}. Give me one second.',
  "Let's see if this actually reads {target}. I will be quick.",
  "Keeping the read tight: what works, and what doesn't.",
];

export const TRY_ON_ACK_LINES = [
  'Good call, {item} could change the whole read. Give me a sec to get it on you.',
  "Let's test {item} and see if it earns the outfit. Hang tight while I get it on you.",
  'Perfect, {item} should tell us something fast. Give me a second.',
  "On it, I want to see how {item} changes the balance. Let's try it on you.",
  "Let's try {item}; it might sharpen the whole vibe. One moment while I put it on you.",
  "Nice, {item} has enough personality to be worth testing. Let's try it on.",
  "Going for {item}; let's see if it actually lands. Give me a beat to slip it on you.",
  "Let's bring in {item} and judge the difference. Hold on while I help you into it.",
];

export const TRY_ON_BUSY_LINES = [
  "Let me finish {busy} first, then I'll throw {item} on right after.",
  "I'm still on {busy}; {item} is up next, give me a sec.",
  'Hang tight, {busy} is almost done; {item} comes right after.',
  "One at a time: {busy} first, then I'll bring in {item}.",
];

export const TRY_ON_INTRO_LINES = [
  'Let me take a look at your new look with the {item} on.',
  'Alright, let me see your new look with the {item} on.',
  'Let me get a good look at you in the {item}.',
  'Okay, let me take in your new look with the {item}.',
  'Let me look you over now that the {item} is on.',
];

const zoneIsNot = (zone: Zone) => `${ZONE_WORDS[zone]} ${zone === 'feet' || zone === 'wrist' ? "aren't" : "isn't"}`;
const fill = (line: string, values: Record<string, string>) => line.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

// -- what they're going for, and where the photo stands --------------------------

const targetPhrase = (v: Pick<View, 'target'>) => styleConfirmationPhrase(v.target) || v.target;

/** What to do once the style is known, which depends on where the photo stands. */
function afterStyle(v: View): string {
  if (v.photo === 'present') return "tell them you're reading their photo now (the app's read follows in a moment; don't guess it)";
  if (v.photo === 'declined') {
    return v.describedOutfit
      ? 'say you will work it toward that from the outfit they described'
      : 'ask them to describe what they are wearing; you will style it from their words';
  }
  return 'ask for one photo of their outfit: they drop or upload it on the right, or tap Try a sample; if they would rather not, they can describe the outfit instead';
}

/** What comes after the name: the style question, unless it was already answered. */
function afterName(v: View): string {
  return v.target ? `confirm the look they're going for (${targetPhrase(v)}) in a few words and ${afterStyle(v)}` : 'ask what style they are going for today';
}

const STAGED_ONBOARDING = [
  'If they say they have no camera: no camera is needed; they can upload or drop a photo of their outfit on the right, tap Try a sample, or just describe what they are wearing.',
  "If they ask to try something on or to be rated before there is a photo, say you need a photo of the outfit first and you'll come straight back to it.",
  'If they describe what they are wearing, acknowledge that outfit in one short clause first.',
  'Never say what you are collecting or that there are steps.',
].join(' ');

const NO_PHOTO = "No photo: they declined it, and that answer is final. Don't ask for a photo, permission or consent again, and don't offer to take one (they can still drop one on the right on their own). You cannot rate them or try clothes on them without one, so don't promise that. You CAN style them from whatever outfit they describe, answer any question (prices, fit, colour, general advice) and suggest pieces. Never refuse a question because there is no photo.";

// -- the board -------------------------------------------------------------------

/** The next piece worth offering: one asked for before there was a photo, else the first untried suggestion. */
export function nextPiece(v: View, wish = ''): { item: string; reason: string } | null {
  const a = v.analysis;
  if (!a) return null;
  const tried = a.tried_items;
  const untried = a.suggestions.filter((s) => !tried.some((t) => itemsMatch(s.item, t)));
  if (wish && !tried.some((t) => itemsMatch(wish, t)) && v.visibleZones.includes(inferItemBodyZone(wish))) return { item: wish, reason: 'they asked for it earlier' };
  return untried[0] ? { item: collapse(untried[0].item), reason: untried[0].text } : null;
}

/** The avatar's picture of the screen. Never an image URL; nothing it may not say. */
export function boardState(v: View): string {
  const parts: string[] = ['Fashion Advisor, live.'];
  if (v.name) parts.push(`You are styling ${v.name}.`);
  else if (v.nameSkipped) parts.push("They chose not to give a name: that's fine, never ask for it again.");
  if (v.target) parts.push(`The look they are going for: ${v.target}.`);

  if (v.step === 'name') {
    parts.push(v.nameAsks === 0
      ? 'Right now you need their name: ask for it warmly, once, in one short sentence.'
      : "You have asked for their name already: if they don't give it this time, carry on warmly without one and ask what style they are going for. Never ask for a name a third time.");
    parts.push(`If they tell you their name, greet them by it and ${afterName(v)}. If they would rather not say, that's fine: ${v.target ? afterName(v) : 'ask what style they are going for instead'}.`);
    parts.push(STAGED_ONBOARDING);
  } else if (v.step === 'style') {
    parts.push(`Right now you need the look they are going for (they can also tap one on the right). When they name a style or an occasion, confirm it in a few words and ${afterStyle(v)}.`);
    parts.push(STAGED_ONBOARDING);
  } else if (v.step === 'photo') {
    parts.push('Waiting for a photo of their outfit on the right: they drop it, upload it, or tap Try a sample. If they agree, tell them to drop or upload it there; you cannot open their camera or see them. If they say no, say no problem and ask them to describe what they are wearing; you will style it from their words.');
    if (v.photoAsks > 0) parts.push("You have asked about the photo already: if they don't answer it this time, drop it and style them from their words. Never ask a third time.");
    parts.push(STAGED_ONBOARDING);
  }

  if (v.describedOutfit) parts.push(`They described their outfit in their words: "${cleanSingleLine(v.describedOutfit, 240)}".${v.photo === 'present' ? '' : ' Style that; don\'t ask them to describe it again.'}`);

  if (v.step === 'styling' && v.photo !== 'present') {
    parts.push(NO_PHOTO);
    if (!v.describedOutfit) parts.push('If you do not know what they are wearing, ask them to describe it once.');
  }

  if (v.image) {
    parts.push(v.image.kind === 'look' ? 'On their screen: their own photo.' : `On their screen: their photo with the ${v.latestItem || v.image.item} added by the app (a try-on).`);
  }
  const a = v.analysis;
  if (a) {
    // Bounded, so the state stays under its limit with the board full: the latest try-ons, the first pieces.
    if (a.tried_items.length) parts.push(`Added by try-ons so far: ${a.tried_items.length > 6 ? `${a.tried_items.slice(-6).join(', ')} (and ${a.tried_items.length - 6} earlier)` : a.tried_items.join(', ')}.`);
    parts.push(`The app's latest read: ${a.style_score} out of 10 for ${a.target_style || targetPhrase(v) || 'their target'} ("${a.style_summary}"${a.occasion ? `, reads as ${a.occasion}` : ''}). Palette: ${a.color_palette.join(', ')}. What works: ${a.what_works} The tip: ${a.style_tip}`);
    if (a.suggestions.length) parts.push(`Recommended pieces on screen: ${a.suggestions.slice(0, 10).map((s) => s.item).join('; ')}${a.suggestions.length > 10 ? ` (and ${a.suggestions.length - 10} more further down)` : ''}.`);
    const next = nextPiece(v);
    if (next) parts.push(`If they ask what to try next, suggest the ${next.item} (${cleanSingleLine(next.reason, 90).replace(/[.!]+$/, '') || 'it moves the look toward the target'})${v.tryOnAvailable ? ' and ask if they want it on' : ''}. If things go quiet, offer the ${next.item}.`);
    parts.push("If they ask how they look or for their score, answer from this read in your own words; don't make up a different score.");
  }
  if (v.step === 'styling' && v.photo === 'present') {
    parts.push("If they want a new photo: they drop or upload it on the right; you can't open their camera.");
    parts.push(v.tryOnAvailable
      ? "If they ask to try a piece on, say a short line like \"ooh, let's see it on you\" and stop: the app shows it in about 15 seconds."
      : 'Try-ons are switched off in this demo (no image model is set up): if they ask to try something on, say that plainly and describe in words how it would change the look; never say a piece is on them.');
  }

  // Work in progress: the result is not on screen yet, so it must not be described.
  const j = v.jobs;
  if (j.photo) parts.push('A new photo is coming in right now.');
  if (j.tryOn) parts.push(`Right now the app is putting the ${j.tryOn} on their photo: it is NOT on their screen yet. Never say it is on them or describe it; the app tells you when it lands.`);
  if (j.queued.length) parts.push(`Waiting after it: ${j.queued.join(', ')}.`);
  if (j.analysing) parts.push(a ? 'The app is re-reading the look right now: the score above is the previous one; the new one follows.' : "The app is reading their photo right now: there is no score yet. Don't guess one; the app tells you in a moment.");
  if (j.more) parts.push('The app is finding more pieces right now.');

  return parts.join(' ');
}

// -- events: outcomes, in the avatar's own words ---------------------------------

const ev = (text: string, ttl: number, extra: Partial<SayEvent> = {}): SayEvent => ({ text, ttl, ...extra });

export const say = {
  start: () => ev("Open the styling session in your own words: one warm sentence that you are about to read their look and help them style it, then ask their name. Don't mention steps or apps.", 60),

  named: (v: View, styleToo = false) => ev(styleToo
    ? `They told you their name, ${v.name}, and the look they're going for, ${targetPhrase(v)}. Greet them by name, confirm the look in a few words and ${afterStyle(v)}.`
    : `They told you their name: ${v.name}. Greet them by it, then ${v.step === 'styling' ? 'carry on' : afterName(v)}.`, 30, { ack: !styleToo }),

  nameSkipped: (v: View) => ev(`They'd rather not give a name: that's fine, never ask for it again. Say something warm like "No bother, we don't need a name for this", then ${afterName(v)}.`, 30, { ack: true }),

  styleSet: (v: View, n = 0) => ev(`They're going for ${targetPhrase(v)}. Confirm it in a few words (a line like "${fill(pick(STYLE_CONFIRM_LINES, n), { style: targetPhrase(v) })}"), then ${v.step === 'name' ? 'ask their name' : afterStyle(v)}.`, 30, { ack: true }),

  photoHow: () => ev("They agreed to share a photo. Tell them to drop or upload a photo of their outfit on the right, or tap Try a sample; you can't open their camera.", 30, { ack: true }),

  photoDeclined: (v: View) => ev(`They'd rather not share a photo: that is final, never ask again. Say something like "No problem, we can skip the photo entirely. ${v.describedOutfit ? 'I have what you described, so let\'s sharpen it from there.' : 'Tell me what you are wearing and I will style it from your words.'}"`, 30, { ack: true }),

  photoReceived: (v: View, n = 0) => ev(v.target
    ? `Their photo is in and the app is reading it now. Say a short line like "${fill(pick(READING_LINES, n), { target: targetPhrase(v) })}" Don't guess anything about the photo; the read follows.`
    : "Their photo is in. Before it can be read, ask them what style they're going for.", 20),

  photoNeedsStyle: (v: View) => ev(v.step === 'name'
    ? "Their photo is in. Carry on: ask their name, then the look they're going for; the app reads the photo as soon as it knows the look."
    : "Their photo is in, but you don't know the look they're going for yet: ask them, and the app reads the photo as soon as they tell you.", 30),

  /** The read is in: the composed brief the original spoke, as instructions. */
  analysis(v: View, ctx: { previousScore?: number; added?: string; wish?: string } = {}): SayEvent {
    const a = v.analysis!;
    const target = targetPhrase(v) || 'their target';
    const score = a.style_score;
    const reaction = score >= 8 ? 'it is working' : score >= 5 ? 'there is something to work with, but it needs editing' : 'it needs a clearer point of view';
    const lines = [ctx.added
      ? `The app has re-read the look with the ${ctx.added} on: ${score} out of 10 for ${target}.`
      : `The app's read of their look is in: ${score} out of 10 for ${target} ("${a.style_summary}").`];
    if (ctx.added && ctx.previousScore !== undefined) {
      const delta = score - ctx.previousScore;
      const item = ctx.added.slice(0, 60).trimEnd();
      lines.push(delta > 0 ? `The ${item} helps: it lifts the look by ${delta} point${delta === 1 ? '' : 's'} (it was ${ctx.previousScore}).`
        : delta < 0 ? `The ${item} hurts the balance by ${-delta} (it was ${ctx.previousScore}).`
          : `The ${item} keeps the score steady at ${score}, so fit decides it.`);
    }
    lines.push(`Tell them in your own words, in two or three short sentences: a quick reaction (${reaction}), the score, what works ("${a.what_works}") and the one fix ("${a.style_tip}").`);
    const next = nextPiece(v, ctx.wish);
    let offer: string | undefined;
    if (next && v.tryOnAvailable) {
      offer = next.item;
      lines.push(`Then ask if they want to try on the ${next.item}${next.reason === 'they asked for it earlier' ? ', which they asked about earlier' : a.tried_items.length ? ' next' : ' first'}.`);
    } else if (next) {
      lines.push(`Then suggest the ${next.item} as the next piece to add (try-ons are off here, so don't offer to put it on them).`);
    } else {
      lines.push('Then suggest one sharper styling point.');
    }
    return ev(lines.join(' '), 60, offer ? { offer } : {});
  },

  analysisFailed: () => ev("The app's read of the look didn't come through this time. Say so in a few words and offer to try again; never make up a score.", 30),

  tryOnAck: (item: string, n = 0) => ev(`They asked to try on the ${item}; the app is putting it on their photo now (about 15 seconds). Say one short line like "${fill(pick(TRY_ON_ACK_LINES, n), { item: `the ${item}` })}" It is not on yet: don't describe it.`, 15, { ack: true }),

  tryOnBusy: (busy: string, item: string, n = 0) => ev(`They asked to try on the ${item} while the ${busy} is still being put on. Say a short line like "${fill(pick(TRY_ON_BUSY_LINES, n), { busy: `the ${busy}`, item: `the ${item}` })}"`, 15, { ack: true }),

  tryOnOnScreen: (item: string, n = 0) => ev(`The ${item} is on their photo now, on their screen. Say a short line like "${fill(pick(TRY_ON_INTRO_LINES, n), { item })}" You can't see the picture, so don't describe it; the app's new score follows in a moment.`, 20),

  tryOnHidden: (item: string) => ev(`They asked to try on the ${item}, but their ${zoneIsNot(inferItemBodyZone(item))} in the photo, so the app can't add it. Say so in one sentence (something like "I can't add the ${item} right now; that area isn't visible") and suggest a photo that shows it.`, 30),

  tryOnSelf: () => ev("They asked to see their current look: it's already on their screen. Say so in a few words and ask which piece they want to add.", 20),

  tryOnNeedsPhoto: (item: string) => ev(`They asked to try on the ${item}, but there is no photo yet. Say you need a photo of the outfit first (they drop or upload it on the right) and you'll come straight back to the ${item}.`, 30),

  tryOnUnavailable: (item: string) => ev(`They asked to try on the ${item}, but try-ons are switched off in this demo (no image model is set up), so nothing will appear on their photo. Say that plainly in a few words, then tell them in words how the ${item} would change the look. Never say it is on them.`, 30),

  tryOnFailed: (item: string, unusable: boolean) => ev(unusable
    ? `The ${item} try-on didn't give a usable picture. Say a short line like "That ${item} did not give us a usable look. Want a simpler version?"`
    : `The ${item} try-on didn't come through. Say a short line like "That ${item} did not land cleanly. Want me to retry it?"`, 30),

  moreReady(names: string[], triedAny: boolean, tryOnAvailable: boolean): SayEvent {
    if (!names.length) return ev("The app found no new pieces this time. Say something like \"I do not see a stronger visible move yet.\"", 30);
    const list = names.slice(0, 3).join(', ');
    const ask = tryOnAvailable ? `Ask if they want to try on the ${names[0]} ${triedAny ? 'next' : 'first'}` : `Suggest the ${names[0]} as the strongest next move`;
    return ev(`More pieces are on their screen now, among them ${list}. ${ask}, in one short sentence.`, 45, tryOnAvailable ? { offer: names[0] } : {});
  },

  moreCapped: (count: number) => ev(`They asked for more pieces, but ${count} are already on their screen, the most this board holds. Say so lightly and point them at one of those.`, 20),

  needsRead: (what: string) => ev(`They asked ${what}, but there is no read of a photo yet. Say you need a photo of the outfit first (they drop or upload it on the right).`, 20),

  retargeting: (v: View) => ev(`They want the look read as ${targetPhrase(v)} now. Say a few words like "Reading it as ${targetPhrase(v)} now"; the app's new score follows. Don't guess it.`, 15, { ack: true }),

  steer: (direction: string) => ev(`They want the next pieces to lean ${direction}. Say something like "Nice, I will steer the next pieces toward ${direction}."`, 15, { ack: true }),

  retake: () => ev("They want a new photo. Tell them to drop or upload it on the right (or tap Try a sample); you can't open their camera.", 20, { ack: true }),

  reset: () => ev("They went back to their own photo: the app took the try-ons off and is reading it fresh. Say something like \"Back to your own look. I am reading it fresh.\"", 15, { ack: true }),

  notice: (text: string) => ev(text, 20),
};
