// What the visitor's words mean, where the page still needs to know: the safety
// net's phrases. Live, a guide sometimes answers "what's this?" from the
// camera without calling identify_exhibit, or a guest says goodbye without
// calling call_host_back; if no call comes within a few seconds, the page makes
// it (the kit's useToolNet). Both calls are safe to make twice.
//
// The recogniser tags words said over a guide's speech with "[interruption]" or
// "[backchannel]", and drops or keeps apostrophes ("whats this"), so the
// phrases allow for both.

const clean = (text: string) => text.replace(/\[(?:interruption|backchannel)\]/gi, ' ').replace(/[’']/g, '').toLowerCase();

/** The visitor asking about what is in front of them: "what's this?", "who painted that", "what am I looking at". */
export function asksWhat(text: string): boolean {
  return /\b(whats|what is) (this|that|it)\b|\bwhat am i looking at\b|\bwho (painted|made|did) (this|that|it)\b|\btell me about (this|that|it)\b/.test(clean(text));
}

const HOST = '(edmund|the chairman|the guide|your guide|him)';

/**
 * The visitor asking a guest for Edmund: "can I talk to Edmund again", "bring
 * back the chairman", "take me back to the guide", "Edmund, are you there?".
 * A request, not any mention: "did Edmund say 1665?" leaves the guest be.
 */
export function asksForHost(text: string): boolean {
  const t = clean(text);
  return new RegExp(`\\b(talk|speak|chat|go|take me|get me)( back)? (to|with) ${HOST}\\b`).test(t)
    || new RegExp(`\\b(bring|call|get|want|need) (back )?${HOST}( back)?\\b`).test(t)
    || /\bwheres edmund\b|\bwhere is edmund\b|^\s*edmund\b[,.!?]? *(are you there|come back|please|where)/.test(t);
}
