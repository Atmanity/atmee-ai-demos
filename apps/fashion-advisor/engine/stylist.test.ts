// The stylist with fake models. Ported: the refused try-on cases
// (test_refused_panel_try_on.py), the refusal that must stay refused
// (test_declining_the_camera.py), the suggestion cap
// (test_rehydration_stays_in_one_envelope.py) and the narrator's epochs
// (superseded try-ons are not narrated). New: the onboarding gates as state,
// jobs and their milestones.
import { describe, expect, test } from 'vitest';
import { ALL_BODY_ZONES } from './items.ts';
import type { CleanAnalysis } from './prompts.ts';
import { MAX_TRACKED_SUGGESTIONS, Stylist, type Models, type ReadInput } from './stylist.ts';
import type { Img, Outcome, SayEvent, Zone } from './types.ts';

const PHOTO = Buffer.alloc(400, 7).toString('base64');
const WIDE = 'とても長い商品名の説明';

class FakeModels implements Models {
  tryOnAvailable = true;
  zonesFor: Zone[] = [...ALL_BODY_ZONES];
  scores: number[] = [];
  reads: ReadInput[] = [];
  readFails = false;
  pieces: { item: string; text: string }[] = [
    { item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.' },
    { item: 'Camel Wool Topcoat', text: 'Adds structure over the tee.' },
    { item: 'Black Round Glasses', text: 'Frames the face.' },
    { item: 'Dark Wash Tapered Jeans', text: 'Cleaner leg line.' },
    { item: 'White Leather Sneakers', text: 'Grounds the look.' },
    { item: 'Silver Link Watch', text: 'Polish at the wrist.' },
  ];
  suggestCalls = 0;
  tryOns: string[] = [];
  tryOnResult: 'ok' | 'null' | 'throw' = 'ok';
  private gates: (() => void)[] = [];
  holdTryOns = false;

  /** While set, a read waits for the test to let it go (releaseReads). */
  holdReads = false;
  private readGates: (() => void)[] = [];
  /** While set, each call for pieces waits on its own gate, so a test can answer them in any order. */
  holdSuggest = false;
  suggestGates: (() => void)[] = [];
  /** Pieces named for the target they were asked for, instead of the fixed list. */
  piecesByTarget = false;

  async analyze(_image: Img, input: ReadInput): Promise<CleanAnalysis | null> {
    this.reads.push(input);
    if (this.readFails) return null;
    if (this.holdReads) await new Promise<void>((resolve) => this.readGates.push(resolve));
    return { target_style: input.target, style_summary: 'Clean base', occasion: 'Dinner', style_score: this.scores.shift() ?? 6, color_palette: ['navy', 'white', 'denim'], what_works: 'The navy layer frames you.', style_tip: 'Ground it with sharper shoes.' };
  }
  async zones(): Promise<Set<Zone>> { return new Set(this.zonesFor); }
  async suggest({ target }: { target: string }) {
    const call = ++this.suggestCalls;
    if (this.holdSuggest) await new Promise<void>((resolve) => this.suggestGates.push(resolve));
    if (this.piecesByTarget) return Array.from({ length: 6 }, (_, i) => ({ item: `${target} Layer ${call}-${i}`, text: `For ${target}.` }));
    return this.pieces.map((p) => ({ ...p }));
  }
  releaseReads() { this.holdReads = false; this.readGates.splice(0).forEach((go) => go()); }
  async tryOn(_image: Img, prompt: string): Promise<Img | null> {
    this.tryOns.push(prompt);
    if (this.holdTryOns) await new Promise<void>((resolve) => this.gates.push(resolve));
    if (this.tryOnResult === 'throw') throw new Error('xAI image edit failed (500)');
    if (this.tryOnResult === 'null') return null;
    return { mime: 'image/jpeg', bytes: new Uint8Array(300).fill(this.tryOns.length) };
  }
  release() { this.gates.splice(0).forEach((go) => go()); }
}

let ids = 0;
function studio(models = new FakeModels()) {
  const stylist = new Stylist(models, { imageUrl: (t) => `/img/${t}`, newId: () => `id${++ids}` });
  return { stylist, models };
}

/** Wait for every milestone of an outcome's job; the outcomes in order. */
async function settle(stylist: Stylist, outcome: Outcome): Promise<Outcome[]> {
  if (!outcome.job) return [];
  const out: Outcome[] = [];
  for (const m of outcome.job.milestones) out.push(await stylist.wait(outcome.job.id, m)!);
  return out;
}
const texts = (events: SayEvent[]) => events.map((e) => e.text).join(' | ');

/** A session past onboarding, with its photo read. */
async function styled(models = new FakeModels()) {
  const { stylist } = studio(models);
  stylist.act({ type: 'name', name: 'Sam' });
  stylist.act({ type: 'style', style: 'smart casual' });
  await settle(stylist, stylist.act({ type: 'photo', mime: 'image/jpeg', data: PHOTO, source: 'sample' }));
  return { stylist, models };
}

describe('onboarding: name, style, photo', () => {
  test('in order, each step answered by a command, then the photo is read', async () => {
    const { stylist, models } = studio();
    expect(stylist.view().step).toBe('name');
    const named = stylist.act({ type: 'name', name: 'Sam' });
    expect(named.view.step).toBe('style');
    expect(named.events[0].text).toContain('Sam');
    const styled = stylist.act({ type: 'style', style: 'smart casual' });
    expect(styled.view.step).toBe('photo');
    expect(styled.events[0].text).toContain('smart casual');
    expect(styled.events[0].text).toMatch(/add a photo of their outfit on the mirror/);

    const photo = stylist.act({ type: 'photo', mime: 'image/jpeg', data: PHOTO, source: 'upload' });
    expect(photo.job?.milestones).toEqual(['image', 'done']);
    expect(photo.view.step).toBe('styling');
    expect(photo.view.image?.kind).toBe('look');
    expect(texts(photo.events)).toMatch(/reading it for smart casual now/);
    const [image, done] = await settle(stylist, photo);
    expect(image.view.jobs.analysing).toBe(true);   // no "no read" flash between the photo and its read
    expect(done.view.analysis?.style_score).toBe(6);
    expect(done.view.analysis?.suggestions).toHaveLength(6);
    expect(done.events[0].text).toContain('6 out of 10 for smart casual');
    expect(models.reads[0]).toMatchObject({ userName: 'Sam', target: 'smart casual', context: 'Initial camera look' });
  });

  test('a style given with the name skips the style question', () => {
    const { stylist } = studio();
    const out = stylist.act({ type: 'name', name: 'Sam', style: 'smart casual' });
    expect(out.view.step).toBe('photo');
    expect(out.events[0].text).toContain('smart casual');
  });

  test('the name question is asked at most twice, then dropped for good', () => {
    const { stylist } = studio();
    stylist.act({ type: 'chat' });
    expect(stylist.view().step).toBe('name');
    expect(stylist.view().nameAsks).toBe(1);
    stylist.act({ type: 'chat' });
    expect(stylist.view()).toMatchObject({ step: 'style', nameSkipped: true });
  });

  test('a photo that comes before the style waits for it, then is read', async () => {
    const { stylist, models } = studio();
    stylist.act({ type: 'skipName' });
    const photo = stylist.act({ type: 'photo', mime: 'image/jpeg', data: PHOTO, source: 'upload' });
    const [, done] = await settle(stylist, photo);
    expect(texts(done.events)).toMatch(/don't know what they're dressing for/);
    expect(models.reads).toHaveLength(0);
    const styled = stylist.act({ type: 'style', style: 'streetwear' });
    expect(styled.job).toBeDefined();
    const [read] = await settle(stylist, styled);
    expect(read.view.analysis?.target_style).toBe('streetwear');
  });
});

describe('saying no to the photo', () => {
  test('the photo question is asked at most twice, then it is a no', () => {
    const { stylist } = studio();
    stylist.act({ type: 'skipName' });
    stylist.act({ type: 'style', style: 'formal' });
    stylist.act({ type: 'chat' });
    expect(stylist.view().step).toBe('photo');
    stylist.act({ type: 'chat' });
    expect(stylist.view()).toMatchObject({ step: 'styling', photo: 'declined' });
  });

  test('the refusal offers what can still be done', () => {
    const { stylist } = studio();
    stylist.act({ type: 'skipName' });
    stylist.act({ type: 'style', style: 'formal' });
    const out = stylist.act({ type: 'declinePhoto' });
    expect(out.events[0].text.toLowerCase()).toContain('skip');
    expect(out.events[0].text.toLowerCase()).toContain('wearing');
  });

  test('a refusal is not re-armed by anything else', () => {
    const { stylist } = studio();
    stylist.act({ type: 'skipName' });
    stylist.act({ type: 'declinePhoto' });
    stylist.act({ type: 'style', style: 'business casual' });
    expect(stylist.view()).toMatchObject({ step: 'styling', photo: 'declined' });
    stylist.act({ type: 'retarget', style: 'formal' });
    stylist.act({ type: 'steer', style: 'streetwear' });
    expect(stylist.view().photo).toBe('declined');
  });

  test('the outfit they described is kept, and the refusal ends when they share a photo after all', async () => {
    const { stylist } = studio();
    stylist.act({ type: 'skipName' });
    stylist.act({ type: 'style', style: 'formal' });
    stylist.act({ type: 'declinePhoto' });
    stylist.act({ type: 'chat', outfit: "I'm wearing black jeans and a grey crewneck" });
    expect(stylist.view().describedOutfit).toContain('grey crewneck');
    stylist.act({ type: 'chat' });
    expect(stylist.view().describedOutfit).toContain('grey crewneck');
    await settle(stylist, stylist.act({ type: 'photo', mime: 'image/jpeg', data: PHOTO, source: 'upload' }));
    expect(stylist.view()).toMatchObject({ photo: 'present', step: 'styling' });
  });
});

describe('a refused try-on', () => {
  // Seated at a desk, the photo has no feet; the stylist's own card says "white sneakers".
  test('is refused before anything is acknowledged, with the reason, and queues nothing', async () => {
    const models = new FakeModels();
    models.zonesFor = ['head', 'neck', 'upper_body', 'lower_body', 'wrist'];
    const { stylist } = await styled(models);
    const out = stylist.act({ type: 'tryOn', item: 'white sneakers' });
    expect(out.job).toBeUndefined();
    expect(models.tryOns).toEqual([]);
    expect(out.view.jobs.tryOn).toBeNull();   // nothing latches the board busy
    // The host must not hear of a try-on that never happened.
    expect(out.events[0].text).not.toMatch(/Putting the/);
    expect(out.events[0].text).toContain('white sneakers');
    expect(out.events[0].text).toContain("feet aren't in the photo");
    expect(out.view.notice?.text).toBe("The white sneakers can't go on: your feet aren't in the photo.");
  });

  test('your own current look is refused the same way', async () => {
    const { stylist, models } = await styled();
    const out = stylist.act({ type: 'tryOn', item: 'current look' });
    expect(out.job).toBeUndefined();
    expect(models.tryOns).toEqual([]);
    expect(out.events[0].text).toContain('already on their screen');
  });

  test('a tap with no item does nothing', async () => {
    const { stylist, models } = await styled();
    const out = stylist.act({ type: 'tryOn', item: '   ' });
    expect(out).toMatchObject({ events: [], handled: true });
    expect(out.job).toBeUndefined();
    expect(models.tryOns).toEqual([]);
  });

  test('with no image model the host is told plainly, and nothing is promised', async () => {
    const models = new FakeModels();
    models.tryOnAvailable = false;
    const { stylist } = await styled(models);
    const out = stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    expect(out.job).toBeUndefined();
    expect(out.events[0].text).toMatch(/can't be put on their photo here/);
    expect(out.events[0].text).toContain('never say it is on them');
  });

  test('before there is a photo, the piece is remembered and offered first once there is one', async () => {
    const { stylist } = studio();
    stylist.act({ type: 'name', name: 'Sam', style: 'smart casual' });
    const early = stylist.act({ type: 'tryOn', item: 'black fedora hat' });
    expect(early.events[0].text).toMatch(/^Not yet: there's no photo to put the black fedora hat on/);
    const [, done] = await settle(stylist, stylist.act({ type: 'photo', mime: 'image/jpeg', data: PHOTO, source: 'upload' }));
    expect(done.events[0].offer).toBe('black fedora hat');
    expect(done.events[0].text).toContain('asked about earlier');
  });
});

describe('an accepted try-on', () => {
  test('is acknowledged, rendered, put on screen, then re-read with the score change', async () => {
    const models = new FakeModels();
    models.scores = [5, 7];
    const { stylist } = await styled(models);
    const out = stylist.act({ type: 'tryOn', item: 'navy tie', text: 'Sharpens the neckline.' });
    // Resolved to the card on screen, and acknowledged by name.
    expect(out.events).toHaveLength(1);
    expect(out.events[0].text).toContain('Slim Navy Silk Tie');
    expect(out.events[0].text).toContain('about 20 seconds');
    expect(out.view.jobs.queued).toEqual(['Slim Navy Silk Tie']);
    const [image, done] = await settle(stylist, out);
    expect(models.tryOns[0]).toContain('Add Slim Navy Silk Tie to this person');
    expect(models.tryOns[0]).toContain('Sharpens the neckline.');
    expect(models.tryOns[0].endsWith('Keep everything else — face, body, background — exactly the same.')).toBe(true);
    expect(image.view.image).toMatchObject({ kind: 'tryon', item: 'Slim Navy Silk Tie' });
    expect(image.view.image?.shop_links?.length).toBeGreaterThan(0);
    expect(image.events[0].text).toMatch(/on their photo now/);
    expect(done.events[0].text).toContain('lifts the look by 2 points (it was 5)');
    expect(done.view.analysis?.tried_items).toEqual(['Slim Navy Silk Tie']);
    expect(models.reads.at(-1)?.context).toBe('After adding: Slim Navy Silk Tie');
    // The tie is tried, so the next offer is another piece.
    expect(done.events[0].offer).toBe('Camel Wool Topcoat');
  });

  test('a failed render says so, keeps the photo, and counts nothing as tried', async () => {
    const models = new FakeModels();
    models.tryOnResult = 'throw';
    const { stylist } = await styled(models);
    const [image] = await settle(stylist, stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' }));
    expect(image.events[0].text).toMatch(/didn't come through; their photo is unchanged/);
    expect(image.view.image?.kind).toBe('look');
    expect(image.view.notice?.text).toContain('Camel Wool Topcoat');
    expect(stylist.tried).toEqual([]);
  });

  test('a second request while one renders waits its turn, and says so', async () => {
    const models = new FakeModels();
    models.holdTryOns = true;
    const { stylist } = await styled(models);
    const first = stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    await new Promise((r) => setTimeout(r, 0));
    expect(stylist.view().jobs.tryOn).toBe('Camel Wool Topcoat');
    const second = stylist.act({ type: 'tryOn', item: 'Black Round Glasses' });
    expect(second.events[0].text).toContain('Camel Wool Topcoat');
    expect(second.events[0].text).toContain('Black Round Glasses');
    // A double tap of the one already queued is ignored.
    expect(stylist.act({ type: 'tryOn', item: 'black round glasses' }).job).toBeUndefined();
    const release = setInterval(() => models.release(), 5);
    const [firstImage, firstDone] = await settle(stylist, first);
    const [secondImage, secondDone] = await settle(stylist, second);
    clearInterval(release);
    // A newer try-on was asked for: the older one's narration is dropped (its picture still showed).
    expect(firstImage.events).toEqual([]);
    expect(firstDone.events).toEqual([]);
    expect(secondImage.events[0].text).toContain('Black Round Glasses');
    expect(secondDone.events[0].text).toContain('Black Round Glasses');
    expect(models.tryOns).toHaveLength(2);
    expect(stylist.view().analysis?.tried_items).toEqual(['Camel Wool Topcoat', 'Black Round Glasses']);
  });

  test('back to the own photo: every try-on off, read fresh', async () => {
    const { stylist, models } = await styled();
    await settle(stylist, stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' }));
    const reset = stylist.act({ type: 'reset' });
    expect(reset.events[0].text).toMatch(/own photo/);
    const [done] = await settle(stylist, reset);
    expect(done.view.image?.kind).toBe('look');
    expect(done.view.analysis?.tried_items).toEqual([]);
    // The own photo for the same occasion: its first verdict comes back, not a new reading.
    expect(models.reads.map((r) => r.context)).toEqual(['Initial camera look', 'After adding: Camel Wool Topcoat']);
    expect(done.events[0].text).toMatch(/^Done: the verdict is 6 out of 10/);
  });
});

describe('the read and the pieces', () => {
  test('a new target re-reads the same photo, with pieces for it', async () => {
    const { stylist, models } = await styled();
    const calls = models.suggestCalls;
    const out = stylist.act({ type: 'retarget', style: 'wedding' });
    expect(out.events[0].text).toContain('wedding');
    const [done] = await settle(stylist, out);
    expect(models.reads.at(-1)?.target).toBe('wedding');
    expect(models.suggestCalls).toBe(calls + 1);
    expect(done.events[0].text).toContain('for wedding');
  });

  test('rated again with nothing changed: the same verdict, said as such, and the pieces stay', async () => {
    const models = new FakeModels();
    models.scores = [7, 5];   // a second model read would have said 5 (live: 7, then 5, for the same outfit)
    const { stylist } = await styled(models);
    const reads = models.reads.length;
    const calls = models.suggestCalls;
    const [done] = await settle(stylist, stylist.act({ type: 'rerate' }));
    expect(models.reads).toHaveLength(reads);
    expect(models.suggestCalls).toBe(calls);
    expect(done.view.analysis?.style_score).toBe(7);
    expect(done.events[0].text).toMatch(/^Done: the same verdict as before, 7 out of 10 for smart casual/);
  });

  test('the same outfit for the same occasion keeps its score through a new direction and back from another occasion', async () => {
    const models = new FakeModels();
    models.scores = [7, 3, 5, 5];
    const { stylist } = await styled(models);
    await settle(stylist, stylist.act({ type: 'steer', style: 'streetwear' }));
    expect(stylist.view().analysis?.style_score).toBe(7);   // pieces lean another way; the verdict stands
    await settle(stylist, stylist.act({ type: 'retarget', style: 'wedding' }));
    expect(stylist.view().analysis?.style_score).toBe(3);
    const [back] = await settle(stylist, stylist.act({ type: 'retarget', style: 'Smart Casual' }));
    expect(back.view.analysis?.style_score).toBe(7);
    expect(back.events[0].text).toMatch(/^Done: the verdict is 7 out of 10/);   // a change of occasion, not "the same verdict"
    expect(models.reads).toHaveLength(2);
  });

  test('a new direction refreshes the pieces quietly', async () => {
    const { stylist } = await styled();
    const out = stylist.act({ type: 'steer', style: 'street wear' });
    expect(out.events[0].text).toContain('streetwear');
    const [done] = await settle(stylist, out);
    expect(done.events).toEqual([]);
    expect(stylist.category).toBe('streetwear');
  });

  test('a read that does not come through is said, never guessed', async () => {
    const models = new FakeModels();
    models.readFails = true;
    const { stylist } = await styled(models);
    const [done] = await settle(stylist, stylist.act({ type: 'rerate' }));
    expect(done.events[0].text).toMatch(/never make up a score/);
    expect(done.view.notice?.kind).toBe('error');
  });

  test('pieces are filtered as the original did: no zones as items, nothing tried, nothing out of frame', async () => {
    const models = new FakeModels();
    models.zonesFor = ['head', 'neck', 'upper_body'];
    models.pieces = [
      { item: 'NECK', text: 'x' }, { item: 'upper body', text: 'x' }, { item: 'Top', text: 'x' }, { item: 'Hat', text: 'too short' },
      { item: 'White Leather Sneakers', text: 'feet are not in the photo' }, { item: 'Slim Navy Silk Tie', text: 'ok' }, { item: 'slim navy silk tie', text: 'duplicate' },
    ];
    const { stylist } = await styled(models);
    const items = stylist.view().analysis!.suggestions.map((s) => s.item);
    expect(items[0]).toBe('Slim Navy Silk Tie');
    expect(items).not.toContain('NECK');
    expect(items).not.toContain('White Leather Sneakers');
    expect(items.filter((i) => i.toLowerCase() === 'slim navy silk tie')).toHaveLength(1);
    // Topped up from the original's stand-ins, for the zones in frame only.
    expect(items).toContain('Layered necklace');
    expect(items).not.toContain('Slim-fit trousers');
    expect(stylist.view().analysis!.suggestions[0].amazon_search_url).toContain('Slim+Navy+Silk+Tie');
  });

  test('"More ideas" stops growing the board at the cap, keeping the earliest', async () => {
    const models = new FakeModels();
    let batch = 0;
    models.suggest = async () => {
      batch += 1;
      return Array.from({ length: 6 }, (_, i) => ({ item: `${WIDE} ${batch}-${i}`, text: WIDE.repeat(3) }));
    };
    const { stylist } = await styled(models);
    const first = stylist.view().analysis!.suggestions[0].item;
    for (let tap = 0; tap < 10; tap++) await settle(stylist, stylist.act({ type: 'more' }));
    const suggestions = stylist.view().analysis!.suggestions;
    expect(suggestions).toHaveLength(MAX_TRACKED_SUGGESTIONS);
    expect(suggestions[0].item).toBe(first);
    expect(stylist.view().canLoadMore).toBe(false);
    expect(stylist.act({ type: 'more' }).events[0].text).toContain(`${MAX_TRACKED_SUGGESTIONS} pieces are already on their screen`);
  });

  test('more pieces loaded by scrolling come quietly, as the original panel loaded them', async () => {
    const { stylist, models } = await styled();
    models.pieces = [{ item: 'Grey Cashmere Beanie', text: 'Soft texture up top.' }];
    const [done] = await settle(stylist, stylist.act({ type: 'more', quiet: true }));
    expect(done.events).toEqual([]);
    expect(done.view.analysis!.suggestions.length).toBeGreaterThan(6);
  });

  test('more pieces are named, and the first is offered', async () => {
    const models = new FakeModels();
    const { stylist } = await styled(models);
    models.pieces = [{ item: 'Grey Cashmere Beanie', text: 'Soft texture up top.' }, { item: 'Gold Layered Necklace', text: 'Warmth at the neckline.' }];
    const [done] = await settle(stylist, stylist.act({ type: 'more' }));
    expect(done.events[0].text).toContain('Grey Cashmere Beanie');
    expect(done.events[0].offer).toBe('Grey Cashmere Beanie');
  });

  test('a new photo is a new look: the try-ons and the read were for the old one', async () => {
    const { stylist } = await styled();
    await settle(stylist, stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' }));
    const out = stylist.act({ type: 'photo', mime: 'image/png', data: PHOTO, source: 'upload' });
    expect(out.view.analysis).toBeNull();
    expect(out.view.image?.kind).toBe('look');
    const [, done] = await settle(stylist, out);
    expect(done.view.analysis?.tried_items).toEqual([]);
  });

  test('a file that is not a usable photo is refused with a reason', () => {
    const { stylist } = studio();
    const out = stylist.act({ type: 'photo', mime: 'image/gif', data: PHOTO, source: 'upload' });
    expect(out.job).toBeUndefined();
    expect(out.view.notice?.text).toMatch(/JPEG, PNG or WebP/);
    expect(stylist.act({ type: 'photo', mime: 'image/jpeg', data: 'aGk=', source: 'upload' }).job).toBeUndefined();
  });
});

// Work that finishes after the look it was started for has changed must not
// act on the new look (Bugbot, PR #14).
describe('late work never lands on a newer look', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test('a photo dropped in while a piece is being put on: the try-on of the old look is dropped', async () => {
    const models = new FakeModels();
    models.holdTryOns = true;
    const { stylist } = await styled(models);
    const tryOn = stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    await tick();
    expect(stylist.view().jobs.tryOn).toBe('Camel Wool Topcoat');
    const photo = stylist.act({ type: 'photo', mime: 'image/png', data: PHOTO, source: 'upload' });
    const newLook = photo.view.image!.url;
    models.release();
    const [image, done] = await settle(stylist, tryOn);
    await settle(stylist, photo);
    expect(stylist.view().image).toMatchObject({ kind: 'look', url: newLook });
    expect(stylist.view().analysis?.tried_items).toEqual([]);
    // Emery was told it was going on: she hears it was not, and why, never about a picture that is not on screen.
    expect(image.events.map((e) => e.text)).toEqual([expect.stringMatching(/^Not applied: a new photo came in while the Camel Wool Topcoat was being put on/)]);
    expect(done.events).toEqual([]);
  });

  test('the occasion changed while a piece was being put on: no score change is claimed across occasions', async () => {
    const models = new FakeModels();
    models.holdTryOns = true;
    models.scores = [6, 3];
    const { stylist } = await styled(models);
    const tryOn = stylist.act({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    await tick();
    const retarget = stylist.act({ type: 'retarget', style: 'wedding' });
    models.release();
    const [, done] = await settle(stylist, tryOn);
    await settle(stylist, retarget);
    expect(done.events[0].text).toContain('3 out of 10 for wedding');
    expect(done.events[0].text).not.toMatch(/lifts|hurts|steady|it was 6/);
  });

  test("a read that finishes after a new photo was dropped in never shows the old photo's verdict", async () => {
    const models = new FakeModels();
    const { stylist } = await styled(models);
    models.holdReads = true;
    const reread = stylist.act({ type: 'retarget', style: 'wedding' });   // the old photo, read for a wedding
    await tick();
    const photo = stylist.act({ type: 'photo', mime: 'image/png', data: PHOTO, source: 'upload' });
    models.readFails = true;    // the new photo's own read does not come through
    models.releaseReads();
    const [stale] = await settle(stylist, reread);
    await settle(stylist, photo);
    expect(stale.events.map((e) => e.text)).toEqual([expect.stringMatching(/^Not yet: a new photo came in while this was being read/)]);
    expect(stylist.view().analysis).toBeNull();   // not the old photo's verdict under the new photo
  });

  test('more pieces fetched for the old occasion are not hung on the new rail', async () => {
    const models = new FakeModels();
    models.piecesByTarget = true;
    const { stylist } = await styled(models);
    models.holdSuggest = true;
    const more = stylist.act({ type: 'more' });                         // pieces for smart casual, held
    await tick();
    const retarget = stylist.act({ type: 'retarget', style: 'wedding' }); // a new rail for a wedding, held
    await tick();
    expect(models.suggestGates).toHaveLength(2);
    models.suggestGates[1]();                                            // the wedding rail lands first
    await settle(stylist, retarget);
    models.holdSuggest = false;
    models.suggestGates[0]();                                            // then the old occasion's pieces
    const [done] = await settle(stylist, more);
    const items = stylist.view().analysis!.suggestions.map((p) => p.item);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toMatch(/^wedding /);
    expect(done.events[0].text).toMatch(/^Not added:/);
  });

  // More pieces asked for after the occasion changed are for that occasion, whichever lands first.
  test.each([
    ['the new rail lands first', [1, 2]],
    ['the extra pieces land first', [2, 1]],
  ])('more pieces asked for while a new occasion is being read stay on its rail (%s)', async (_order, order) => {
    const models = new FakeModels();
    models.piecesByTarget = true;
    const { stylist } = await styled(models);
    models.holdSuggest = true;
    const retarget = stylist.act({ type: 'retarget', style: 'wedding' });   // its rail: call 2
    await tick();
    const more = stylist.act({ type: 'more' });                               // for the wedding: call 3
    await tick();
    expect(models.suggestGates).toHaveLength(2);
    models.holdSuggest = false;
    const gates = [...models.suggestGates];
    for (const n of order) { gates[n - 1](); await tick(); await tick(); }
    await settle(stylist, retarget);
    const [done] = await settle(stylist, more);
    const items = stylist.view().analysis!.suggestions.map((p) => p.item);
    expect(items.filter((i) => /^wedding Layer 3-/.test(i))).toHaveLength(6);   // the extra pieces
    expect(items.filter((i) => /^wedding Layer 2-/.test(i)).length).toBeGreaterThan(0);   // the new rail
    expect(items.some((i) => !/^wedding /.test(i))).toBe(false);
    expect(done.events[0].text).toMatch(/^Done: 6 new pieces/);
  });
});

// Pieces found while their occasion's verdict is still being read wait for that read: only a
// read for the same photo, occasion and direction takes them (Bugbot, PR #14, third round).
describe('waiting pieces belong to their rail', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** The extra pieces (the third call for pieces) that made it onto the rail. */
  const extrasOnRail = (stylist: Stylist) => stylist.view().analysis!.suggestions.filter((p) => / Layer 3-/.test(p.item));
  const railIsFor = (stylist: Stylist, target: string) => { for (const p of stylist.view().analysis!.suggestions) expect(p.item).toMatch(new RegExp(`^${target} Layer`)); };

  /** A rated fitting; a new occasion whose rail is held (call 2); more pieces for it (call 3) that arrive first and wait. */
  async function waiting(opts: { failRead?: boolean; thenRetarget?: string } = {}) {
    const models = new FakeModels();
    models.piecesByTarget = true;
    const { stylist } = await styled(models);
    models.holdSuggest = true;
    if (opts.failRead) models.readFails = true;
    const reads = [stylist.act({ type: 'retarget', style: 'wedding' })];
    await tick();
    if (opts.thenRetarget) reads.push(stylist.act({ type: 'retarget', style: opts.thenRetarget }));
    const more = stylist.act({ type: 'more' });
    await tick();
    const [railGate, moreGate] = models.suggestGates;
    models.holdSuggest = false;
    moreGate();
    const [found] = await settle(stylist, more);
    return { models, stylist, reads, railGate, found };
  }

  test.each([
    ['matching: the read for their occasion takes them', async () => {
      const { stylist, reads, railGate, found } = await waiting();
      expect(found.events[0].text).toMatch(/go on the rail with the new verdict/);
      railGate();
      await settle(stylist, reads[0]);
      expect(extrasOnRail(stylist)).toHaveLength(6);
      railIsFor(stylist, 'wedding');
    }],
    ['older: a read for an earlier occasion lands first and leaves them for theirs', async () => {
      // The wedding read started before the gala was picked; the pieces were found for the gala.
      const { stylist, reads, railGate, found } = await waiting({ thenRetarget: 'gala' });
      expect(found.events[0].text).toMatch(/go on the rail with the new verdict/);
      railGate();
      await settle(stylist, reads[0]);
      expect(extrasOnRail(stylist)).toHaveLength(0);   // not on the wedding rail
      await settle(stylist, reads[1]);
      expect(extrasOnRail(stylist)).toHaveLength(6);   // on the gala rail, as promised
      railIsFor(stylist, 'gala');
    }],
    ['newer: a read for a later occasion does not take them', async () => {
      // The wedding read fails, so the wedding's pieces still wait when the gala is picked and read.
      const { models, stylist, reads, railGate } = await waiting({ failRead: true });
      railGate();
      await settle(stylist, reads[0]);
      models.readFails = false;
      await settle(stylist, stylist.act({ type: 'retarget', style: 'gala' }));
      expect(extrasOnRail(stylist)).toHaveLength(0);
      railIsFor(stylist, 'gala');
    }],
    ['failed: their read fails; Emery hears they wait, and the next read for their occasion takes them', async () => {
      const { models, stylist, reads, railGate } = await waiting({ failRead: true });
      railGate();
      const [failed] = await settle(stylist, reads[0]);
      expect(failed.events[0].text).toMatch(/^Failed: the verdict didn't come through.*extra pieces .*waiting/);
      models.readFails = false;
      await settle(stylist, stylist.act({ type: 'rerate' }));
      expect(extrasOnRail(stylist)).toHaveLength(6);
      railIsFor(stylist, 'wedding');   // and the rest of the rail is for the wedding too, not the old occasion's
    }],
  ] as const)('%s', async (_name, run) => { await run(); });
});
