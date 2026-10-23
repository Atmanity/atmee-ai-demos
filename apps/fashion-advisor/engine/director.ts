// What Emery is told, and how she acts. Notch decides everything: the read,
// the score, which pieces, what is on the photo. Emery styles out loud. She
// cannot see the user or the photo; she reaches the fitting only through the
// tools below, and every verdict, piece and try-on comes back as a result
// she speaks from.
//
//   instructions()  her role and the rules that came from live failures
//   tools()         what she can do (try-ons only when an image model is set up)
//   boardState()    what is on the user's screen, for questions without a tool
//   say.*           what the stylist engine reports, as words to speak from
//   said.*          the fitting's own words: the opening, a button press, a late result
import type { AppTool } from '../../../server/app-server.ts';
import { cleanSingleLine, collapse, inferItemBodyZone, itemsMatch, ZONE_WORDS } from './items.ts';
import { styleConfirmationPhrase } from './style.ts';
import type { SayEvent, View, Zone } from './types.ts';

export const HOST = 'Emery';

// -- the host's rules (the session's tool instructions, at most 4,000 characters) --

const TRY_ON_RULES = `- try_on: when they ask to try, add or see a piece on them ("put the topcoat on me", "try the second one"), and when they say yes to a piece you offered. Pass the piece as the rail names it when it is one. It takes about 20 seconds: until Notch tells you it is on their screen, never say it is on them or describe it.
- restore_photo: only when they ask to go back to their own photo or to take the pieces off.`;

const NO_TRY_ON_RULES = `- Pieces cannot be put on their photo here: never offer a try-on. Say in words how a piece would change the look.`;

/** The host's rules. Try-ons are named only when an image model is set up. */
export function instructions(tryOns: boolean): string {
  return `You are ${HOST}, the stylist on Notch, styling one person live. On their screen: a mirror with a photo of their outfit, your verdict (a score out of 10 for what they are dressing for, what works, the one fix) and a rail of pieces to add. You cannot see them or the photo. Notch reads the photo; you reach it only through these tools, and you speak from their results.
- rate_outfit: the moment they say what they are dressing for ("I'm dressing for a dinner out", "a wedding", "job interview"), even before there is a photo; when they ask to be rated, or rated again ("rate it again": no occasion); when they want the outfit judged for another occasion ("what about a first date?"). Pass the occasion only when they name one. Never give, guess or hint at a score yourself.
- suggest_pieces: when they ask for more ideas, other pieces or what else to add. When they want the pieces to lean somewhere ("make it more streetwear", "dressier"), call it with that direction.
${tryOns ? TRY_ON_RULES : NO_TRY_ON_RULES}
- Every request that changes the screen is a tool call, even a few words answering your own question (an occasion, a yes). Never say an action happened ("I'm updating the rail", "let's rate it for the wedding") unless the tool's result said so: without the call the screen does not change. Call the tool every time, even when you think you know the answer.
- A tool's result starts with its outcome ("Done:", "Not yet:", "Refused:"): your reply follows that outcome.
- Questions about the score, the fix, the pieces or what is on screen: answer from the live board in your context, no tool. "I look better now, right?" is reassurance: answer from the latest verdict.
- When they press something on screen, Notch tells you what happened; carry on from that.
- For another photo they tap Change photo under the mirror or drop one on it; you cannot open their camera or take one. No photo? They can use the example outfit, or describe what they wear and you advise in words (a score needs a photo). If they would rather not share one, never ask again. Never ask for what they already told you: the occasion is on the board.
- Never invent a score, a colour or a detail of their outfit. Never offer a garment that is neither on the rail nor named by them. Never body-shame or comment on weight, size or fitness: talk balance, line, proportion and colour. Never name real people, shows or brands unless they do.
Your voice: a supermodel best friend in their corner, warm, quick and decisive; candid, never cruel. Lead with taste: one visible reason (fit, colour, proportion, texture, silhouette) and one concrete move ("swap in", "sharpen", "ground it with"). Compliments use styling language tied to a detail ("that line is doing you favours"). Use their name once you know it. One or two short spoken sentences, at most one question, no lists. Never call yourself an assistant, and never talk about apps, tools, steps or what you are collecting.`;
}

// -- the tools ----------------------------------------------------------------------
//
// Lenient on purpose: the platform checks a call's arguments against these
// schemas before the page sees it, and answers a call that does not fit with
// "invalid arguments" to the host alone (who then tends to say it happened).
// So no enums, patterns, tight lengths or closed objects: the fitting cleans
// and reads what arrives (fitting.ts), and asks back when it cannot use it.

const text = (description: string) => ({ type: 'string', maxLength: 500, description });
/** A read takes a few seconds, sometimes more: the page answers within 20 s, with "still working" if it must. */
const slow = { mode: 'await' as const, timeoutSeconds: 25 };
/** Starting a try-on is instant; the render that follows is told as events. */
const quick = { mode: 'await' as const, timeoutSeconds: 10 };

export const RATE_OUTFIT: AppTool = {
  type: 'function', name: 'rate_outfit',
  description: 'Rates the outfit photo on screen for an occasion: a score out of 10, what works and the one fix (a few seconds). Call it as soon as the user says what they are dressing for (with no photo yet it is noted), when they ask to be rated or rated again, or want the same outfit judged for another occasion.',
  parameters: {
    type: 'object',
    properties: { occasion: text('What they are dressing for, in their words ("a summer wedding", "job interview"). Only when they name one; leave it out to rate again for the same occasion.') },
  },
  'x-atmee': slow,
};

export const SUGGEST_PIECES: AppTool = {
  type: 'function', name: 'suggest_pieces',
  description: 'Puts more pieces on the rail, picked for the occasion and the photo. Call it when the user asks for more ideas, other pieces or what else to add, and with a direction when they want the pieces to lean somewhere.',
  parameters: {
    type: 'object',
    properties: { direction: text('Where they want the pieces to lean, in their words ("more streetwear", "dressier", "more formal"). Only when they say one.') },
  },
  'x-atmee': slow,
};

export const TRY_ON: AppTool = {
  type: 'function', name: 'try_on',
  description: 'Starts putting a piece on the user\'s photo (about 20 seconds); you are told when it is on their screen, then its new score. Call it when the user asks to try, add or see a piece on them, or says yes to one you offered.',
  parameters: {
    type: 'object',
    properties: { piece: text('The piece as the rail names it ("Camel Wool Topcoat"), or as the user named it ("a black fedora", "the second one").') },
    required: ['piece'],
  },
  'x-atmee': quick,
};

export const RESTORE_PHOTO: AppTool = {
  type: 'function', name: 'restore_photo',
  description: 'Takes every tried-on piece off, back to the user\'s own photo, and rates it fresh. Only when the user asks to go back to their own photo or to take the pieces off.',
  parameters: { type: 'object', properties: {} },
  'x-atmee': slow,
};

/** The host's tools. Without an image model there is nothing to put on, so no try-on tools. */
export function tools(tryOns: boolean): AppTool[] {
  return tryOns ? [RATE_OUTFIT, SUGGEST_PIECES, TRY_ON, RESTORE_PHOTO] : [RATE_OUTFIT, SUGGEST_PIECES];
}

// -- the live board (the session's state, at most 3,858 characters) ------------------

const occasionOf = (target: string) => styleConfirmationPhrase(target) || target;
const zoneIsNot = (zone: Zone) => `${ZONE_WORDS[zone]} ${zone === 'feet' || zone === 'wrist' ? "aren't" : "isn't"}`;
const WHERE_PHOTOS_GO = 'on the mirror: Upload a photo, drag one in, or Use an example outfit';

/** The next piece worth offering: one asked for before there was a photo, else the first untried one on the rail. */
export function nextPiece(v: View, wish = ''): { item: string; reason: string } | null {
  const a = v.analysis;
  if (!a) return null;
  const tried = a.tried_items;
  const untried = a.suggestions.filter((s) => !tried.some((t) => itemsMatch(s.item, t)));
  if (wish && !tried.some((t) => itemsMatch(wish, t)) && v.visibleZones.includes(inferItemBodyZone(wish))) return { item: wish, reason: 'they asked for it earlier' };
  return untried[0] ? { item: collapse(untried[0].item), reason: untried[0].text } : null;
}

/** What is on the user's screen, for Emery to answer from. Never an image URL or a link. */
export function boardState(v: View): string {
  const parts: string[] = ['Notch, the live board on their screen.'];
  parts.push(v.target ? `Dressing for: ${v.target}.` : "Dressing for: not set yet (when they say, rate_outfit records it).");

  if (!v.image) parts.push(`The mirror is empty: no photo yet. They add one ${WHERE_PHOTOS_GO}.`);
  else if (v.image.kind === 'look') parts.push('In the mirror: their own photo.');
  else parts.push(`In the mirror: their photo with the ${v.latestItem || v.image.item} put on by Notch (a try-on).`);

  const a = v.analysis;
  if (a) {
    parts.push(`Your verdict: ${a.style_score} out of 10 for ${a.target_style || occasionOf(v.target) || 'their occasion'} ("${a.style_summary}"${a.occasion ? `; it reads as ${a.occasion}` : ''}). Palette: ${a.color_palette.join(', ')}. What works: ${a.what_works} The one fix: ${a.style_tip}`);
    // Bounded, so the board stays under its limit when full: the latest try-ons, every piece by name.
    if (a.tried_items.length) parts.push(`Put on so far: ${a.tried_items.length > 6 ? `${a.tried_items.slice(-6).join(', ')} (and ${a.tried_items.length - 6} earlier)` : a.tried_items.join(', ')}.`);
    if (a.suggestions.length) parts.push(`On the rail, in order: ${a.suggestions.map((s, i) => `${i + 1}. ${s.item}`).join('; ')}.`);
    const next = nextPiece(v);
    if (next) parts.push(`The strongest next piece: the ${next.item} (${cleanSingleLine(next.reason, 90).replace(/[.!]+$/, '') || 'it moves the look toward the occasion'}).`);
    parts.push('If they ask how they look or for their score, answer from this verdict; never a different score.');
  } else if (v.image && v.target && v.notice?.kind === 'error' && !v.jobs.analysing) {
    parts.push("The last read didn't come through: there is no score. rate_outfit tries again.");
  }
  if (!v.tryOnAvailable) parts.push('Pieces cannot be put on their photo here: never offer a try-on.');

  // Work in progress: its result is not on screen yet, so it must not be described.
  const j = v.jobs;
  if (j.photo) parts.push('A new photo is coming in right now.');
  if (j.tryOn) parts.push(`Notch is putting the ${j.tryOn} on their photo right now: it is NOT on their screen yet. Never say it is on them or describe it; you will be told when it lands.`);
  if (j.queued.length) parts.push(`Waiting to go on after it: ${j.queued.join(', ')}.`);
  if (j.analysing) parts.push(a ? 'Notch is re-reading the outfit right now: the verdict above is the previous one; the new one follows.' : "Notch is reading their photo right now: there is no score yet. Don't guess one.");
  if (j.more) parts.push('More pieces are on their way to the rail.');

  return parts.join(' ');
}

// -- what the stylist engine reports ------------------------------------------------
//
// Each is a tool result (Emery asked) or the outcome in an event (the user
// pressed something). Each starts with the plain outcome ("Done:", "Not
// yet:", "Refused:"), so the filler the platform has her say while a tool
// runs cannot pre-judge it; then the facts, then how to say them. None asks
// Emery to act on her own: an offer is "ask whether…; only if they say yes".

const ev = (text: string, ttl: number, extra: Partial<SayEvent> = {}): SayEvent => ({ text, ttl, ...extra });

/** Lines the original spoke word for word, kept as examples of the voice. */
export const TRY_ON_ACK_LINES = [
  'Good call, {item} could change the whole read. Give me a sec to get it on you.',
  "Let's test {item} and see if it earns the outfit. Hang tight.",
  'Perfect, {item} should tell us something fast.',
  "On it, I want to see how {item} changes the balance.",
];
export const TRY_ON_INTRO_LINES = [
  'There it is, let me take in the new look.',
  'Okay, let me see you with the {item} on.',
  'Let me get a good look at the {item} on you.',
];
const pick = (options: readonly string[], n: number) => options[((n % options.length) + options.length) % options.length];
const fill = (line: string, values: Record<string, string>) => line.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

const askForPhoto = `ask them to add a photo of their outfit ${WHERE_PHOTOS_GO}`;

export const say = {
  named: (v: View, styleToo = false) => ev(styleToo
    ? `Their name is ${v.name} and they're dressing for ${occasionOf(v.target)}. Greet them by name, confirm the occasion in a few words, and ${v.image ? 'say the verdict is on its way' : askForPhoto}.`
    : `Their name is ${v.name}. Greet them by it and carry on.`, 30),

  nameSkipped: () => ev("They'd rather not give a name: that's fine, never ask for it again.", 30),

  styleSet: (v: View) => ev(v.image
    ? `Not yet: their photo is being read for ${occasionOf(v.target)} now. Say so in a few words; the verdict follows. Don't guess it.`
    : `Done: the occasion is set to ${occasionOf(v.target)}. Not rated yet: there's no photo. Confirm the occasion in a few words and ${askForPhoto}.`, 30),

  photoHow: () => ev(`They agreed to share a photo: tell them to add it ${WHERE_PHOTOS_GO}. You can't open their camera.`, 30),

  photoDeclined: (v: View) => ev(`They'd rather not share a photo: that's final, never ask again. Say something like "No problem, we can skip the photo. ${v.describedOutfit ? "I have what you described, so let's sharpen it from there." : 'Tell me what you are wearing and I will style it from your words.'}"`, 30),

  photoReceived: (v: View) => ev(v.target
    ? `Their photo is in and Notch is reading it for ${occasionOf(v.target)} now. Say a few words while it reads; don't guess anything about it.`
    : "Their photo is in. To rate it, ask what they're dressing for.", 20),

  photoNeedsStyle: () => ev("Not yet rated: their photo is in, but you don't know what they're dressing for, so it can't be scored. Ask them; it's rated as soon as they tell you.", 30),

  /** The verdict is in: the score (and its change after a try-on), what works, the one fix, the next piece. */
  analysis(v: View, ctx: { previousScore?: number; added?: string; wish?: string; same?: boolean } = {}): SayEvent {
    const a = v.analysis!;
    const occasion = occasionOf(v.target) || 'their occasion';
    const score = a.style_score;
    const reaction = score >= 8 ? 'it works' : score >= 5 ? 'a good base that needs one edit' : 'it needs a clearer point of view';
    if (ctx.same) {
      return ev(`Done: the same verdict as before, ${score} out of 10 for ${occasion} ("${a.style_summary}"): the photo and the occasion haven't changed, so the reading stands. A new photo, a piece on or another occasion would change it. Say so in a sentence and remind them of the one fix: ${a.style_tip}`, 45);
    }
    const lines = [ctx.added
      ? `Done: with the ${ctx.added} on, the outfit scores ${score} out of 10 for ${occasion}.`
      : `Done: the verdict is ${score} out of 10 for ${occasion} ("${a.style_summary}").`];
    if (ctx.added && ctx.previousScore !== undefined) {
      const delta = score - ctx.previousScore;
      const item = ctx.added.slice(0, 60).trimEnd();
      lines.push(delta > 0 ? `The ${item} helps: it lifts the look by ${delta} point${delta === 1 ? '' : 's'} (it was ${ctx.previousScore}).`
        : delta < 0 ? `The ${item} hurts the balance by ${-delta} (it was ${ctx.previousScore}).`
          : `The ${item} keeps the score steady at ${score}, so fit decides it.`);
    }
    lines.push(`What works: ${a.what_works} The one fix: ${a.style_tip}`);
    lines.push(`Tell them in your own words, in two or three short sentences: your reaction (${reaction}), the score, what works and the one fix.`);
    const next = nextPiece(v, ctx.wish);
    let offer: string | undefined;
    if (next && v.tryOnAvailable) {
      offer = next.item;
      const which = next.reason === 'they asked for it earlier' ? ', which they asked about earlier' : a.tried_items.length ? ' next' : '';
      lines.push(`Then ask whether they'd like to try on the ${next.item}${which}; put it on only if they say yes.`);
    } else if (next) {
      lines.push(`Then name the ${next.item} as the piece to add, with why in a few words.`);
    } else {
      lines.push('Then give one sharper styling point.');
    }
    return ev(lines.join(' '), 60, offer ? { offer } : {});
  },

  analysisFailed: (piecesWaiting = false) => ev(`Failed: the verdict didn't come through this time.${piecesWaiting ? ' The extra pieces found for it are waiting too: they go on the rail with the verdict once it comes through.' : ''} Say so in a few words and offer to rate it again; never make up a score.`, 30),

  tryOnAck: (item: string, n = 0) => ev(`Started: putting the ${item} on their photo now. It takes about 20 seconds and it is not on yet. Say so in a few words, like "${fill(pick(TRY_ON_ACK_LINES, n), { item: `the ${item}` })}", and don't describe it; you'll be told when it's on their screen.`, 20),

  tryOnBusy: (busy: string, item: string) => ev(`Queued: the ${busy} is still going on, so the ${item} goes on right after it (about 20 seconds each). Say so in a few words; neither is on yet.`, 20),

  tryOnOnScreen: (item: string, n = 0) => ev(`Done: the ${item} is on their photo now, on their screen. React in a few words, like "${fill(pick(TRY_ON_INTRO_LINES, n), { item })}". You can't see it, so don't describe it; its new score follows in a moment.`, 20),

  tryOnHidden: (item: string) => ev(`Refused: the ${item} can't go on, their ${zoneIsNot(inferItemBodyZone(item))} in the photo. Say so in one sentence and suggest a photo that shows it.`, 30),

  tryOnSelf: () => ev("Nothing to add: that's their current look, already on their screen. Ask which piece they'd like to add.", 20),

  tryOnNeedsPhoto: (item: string) => ev(`Not yet: there's no photo to put the ${item} on: ${askForPhoto}. The ${item} is kept and offered first once the photo is read.`, 30),

  tryOnUnavailable: (item: string) => ev(`Refused: pieces can't be put on their photo here, so the ${item} stays on the rail. Say so in a few words and tell them how it would change the look; never say it is on them.`, 30),

  tryOnFailed: (item: string, unusable: boolean) => ev(`Failed: the ${item} ${unusable ? "didn't give a usable picture" : "didn't come through"}; their photo is unchanged. Say so in a few words and ask whether to try it again; only try again if they say yes.`, 30),

  /** More pieces found; `withVerdict`: they go on the rail with the new occasion's verdict, which is still being read. */
  moreReady(names: string[], triedAny: boolean, tryOnAvailable: boolean, withVerdict = false): SayEvent {
    if (!names.length) return ev("Nothing new: no new pieces this time. Say there's no stronger move than what's on the rail, and point to one there.", 30);
    const list = names.slice(0, 3).join(', ');
    const ask = tryOnAvailable
      ? `then ask whether they'd like to try on the ${names[0]}${triedAny ? ' next' : ''}; put it on only if they say yes`
      : `and say why the ${names[0]} is the strongest move`;
    const one = names.length === 1;
    const where = withVerdict ? `${one ? 'goes' : 'go'} on the rail with the new verdict in a moment` : `${one ? 'is' : 'are'} on the rail now`;
    return ev(`Done: ${names.length} new piece${one ? '' : 's'} ${where}, among them ${list}. Name one or two in a sentence, ${ask}.`, 45, tryOnAvailable ? { offer: names[0] } : {});
  },

  lookChanged: () => ev("Not yet: a new photo came in while this was being read, so that verdict was for the old one and was left off. The new photo's verdict appears on their screen in a moment. Say so in a few words; don't guess it.", 30),

  tryOnStale: (item: string) => ev(`Not applied: a new photo came in while the ${item} was being put on, so it was for the old look and was left off. Ask whether they'd like it on the new photo; put it on only if they say yes.`, 30),

  moreStale: () => ev("Not added: the rail changed while more pieces were being found (a new photo or occasion), so they were left off. Ask whether they'd like more pieces for what's on screen now; find them only if they say yes.", 30),

  moreCapped: (count: number) => ev(`Refused: the rail is full, ${count} pieces are already on their screen. Say so lightly and point them to one of those.`, 20),

  needsRead: (what: string) => ev(`Not yet: they asked ${what}, but there is no photo to read. ${askForPhoto[0].toUpperCase()}${askForPhoto.slice(1)}.`, 20),

  retargeting: (v: View) => ev(`Not yet: reading the same outfit for ${occasionOf(v.target)} now; the verdict follows. Don't guess it.`, 15),

  steer: (direction: string) => ev(`Not yet: leaning the next pieces ${direction}; they follow in a moment.`, 15),

  retake: () => ev(`They want a new photo: they add it ${WHERE_PHOTOS_GO}. You can't open their camera.`, 20),

  reset: () => ev('Done: back to their own photo, every try-on off; it is being rated fresh and the verdict follows.', 15),
};

// -- the fitting's own words ----------------------------------------------------------

export const said = {
  /**
   * The first thing Emery hears once she is in: where the fitting stands (called
   * back: the same fitting, carried on). Null for an empty fitting room: her own
   * greeting already asks where they're headed, and asking again right after it
   * (live, back to back) is the one thing the opening must not do.
   */
  opening(v: View, back = false): string | null {
    const hello = `You have just greeted them; do not greet or introduce yourself again. ${back ? 'They called you back to carry on the same fitting:' : 'A fitting on Notch starts:'} go straight on and`;
    if (v.analysis && !v.jobs.analysing) return `${hello} give them the verdict on their screen. ${say.analysis(v).text}`;
    if (v.jobs.photo || v.jobs.analysing) return `${hello} say their photo is being read for ${occasionOf(v.target)} right now: the verdict appears on their screen and on your board in a moment. Don't guess it.`;
    if (v.image && !v.target) return `${hello} say in a few words that you have their photo. Your greeting already asked where they're headed: don't ask again, wait for their answer.`;
    if (v.target) return `${hello} confirm in a few words that they're dressing for ${occasionOf(v.target)} (they picked it on screen) and ${askForPhoto}.`;
    return null;
  },

  /** The user started over while Emery is in the call. */
  newFitting: () => "The user started a new fitting on screen: the mirror and the occasion are empty again. In a sentence, ask what they're dressing for next.",

  /** A button press, told to Emery: she cannot see the screen. */
  pressed: (what: string, outcome: string) => `The user ${what} on screen. ${outcome}`,

  /** A photo landed in the mirror: said at once, so Emery knows before the verdict (which follows as photoRead). */
  photoIn: (v: View, example: boolean) => {
    const photo = example ? 'the example outfit' : 'their outfit photo';
    return v.target
      ? `Done: ${photo} is in the mirror now, and Notch is reading it for ${occasionOf(v.target)}: the verdict follows in a few seconds and you'll be told. Say you've got it in a few words; don't guess anything about it.`
      : `Done: ${photo} is in the mirror now. To score it you need what they're dressing for: ask them.`;
  },
  photoRead: (outcome: string) => `The photo they just added has been read. ${outcome}`,

  noOccasion: () => "Not yet: there's nothing to rate against. Ask what they're dressing for.",
  readRunning: (v: View) => `Not yet: their photo is being read for ${occasionOf(v.target)} right now: the verdict lands in a moment and you'll be told. Say so in a few words; don't guess it.`,
  noVerdictYet: () => "Not yet: the first verdict isn't in yet, and the pieces come with it. Say so in a few words.",
  tryOnRunning: (item: string) => `Not yet: the ${item} is still going on; its new score follows by itself and you'll be told. Say so in a few words.`,
  alreadyOwn: () => 'Nothing to do: their own photo is already in the mirror with nothing added, so there is nothing to take off.',
  alreadyGoing: (item: string) => `Already started: the ${item} is on its way onto their photo; you'll be told when it lands.`,
  moreOnTheWay: () => "Already started: more pieces are on their way to the rail; you'll be told. Say so in a few words.",
  whichPiece: () => "Not clear: it isn't clear which piece they mean: ask them to name it (one on the rail, or any garment).",
  notAPiece: (words: string) => `Refused: "${cleanSingleLine(words, 60)}" isn't a piece of clothing to put on: ask which piece they mean.`,

  steered(v: View, direction: string): string {
    if (v.notice?.kind === 'error') return `Failed: the fresh pieces didn't come through this time. Say so in a few words and offer to try again; only if they say yes.`;
    const names = v.analysis?.suggestions.slice(0, 3).map((s) => s.item) ?? [];
    if (!names.length) return `Nothing new: no pieces came back leaning ${direction}. Say so and give one styling idea in words.`;
    const ask = v.tryOnAvailable ? `; ask whether they'd like to try on the ${names[0]}, and put it on only if they say yes` : '';
    return `Done: the rail now leans ${direction}: ${names.join(', ')} first. Name one or two in a sentence${ask}.${v.analysis ? ` The verdict is unchanged: ${v.analysis.style_score} out of 10 for ${occasionOf(v.target)}.` : ''}`;
  },

  /** A tool's result that outlived the call. */
  stillWorking: () => "Not yet: still working on it (it can take up to half a minute). Tell them it's coming in a few words; you'll be told the moment it lands. Don't guess the result.",
  late: (text: string) => `What you were waiting for just landed. ${text}`,
  lost: () => "Failed: that didn't come through this time. Say so in a few words and offer to try again; only try again if they say yes.",
};
