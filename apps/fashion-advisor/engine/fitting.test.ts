// The fitting with fake models: Emery's tool calls and the user's buttons
// become the same actions, and come back as the words she speaks from (her
// result) or is told (a button, worded as what was pressed).
import { describe, expect, test } from 'vitest';
import { Fitting, intentOfButton, intentOfTool, type Asker, type Ran } from './fitting.ts';
import { ALL_BODY_ZONES } from './items.ts';
import type { CleanAnalysis } from './prompts.ts';
import { Stylist, type Models, type ReadInput } from './stylist.ts';
import type { Img, Zone } from './types.ts';

const PHOTO = Buffer.alloc(400, 7).toString('base64');
const host: Asker = { by: 'host' };

class FakeModels implements Models {
  tryOnAvailable = true;
  reads: ReadInput[] = [];
  scores: number[] = [];
  zonesFor: Zone[] = [...ALL_BODY_ZONES];
  pieces = [
    { item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.' },
    { item: 'Camel Wool Topcoat', text: 'Adds structure over the tee.' },
    { item: 'Black Round Glasses', text: 'Frames the face.' },
  ];
  tryOns: string[] = [];
  private gates: (() => void)[] = [];
  holdTryOns = false;

  /** While set, a read waits for the test to let it go. */
  hold: Promise<void> | null = null;
  async analyze(_image: Img, input: ReadInput): Promise<CleanAnalysis | null> {
    this.reads.push(input);
    if (this.hold) await this.hold;
    return { target_style: input.target, style_summary: 'Clean base', occasion: 'Dinner', style_score: this.scores.shift() ?? 6, color_palette: ['navy', 'white', 'denim'], what_works: 'The navy layer frames you.', style_tip: 'Ground it with sharper shoes.' };
  }
  async zones(): Promise<Set<Zone>> { return new Set(this.zonesFor); }
  async suggest() { return this.pieces.map((p) => ({ ...p })); }
  async tryOn(_image: Img, prompt: string): Promise<Img | null> {
    this.tryOns.push(prompt);
    if (this.holdTryOns) await new Promise<void>((resolve) => this.gates.push(resolve));
    return { mime: 'image/jpeg', bytes: new Uint8Array(300).fill(this.tryOns.length) };
  }
  release() { this.gates.splice(0).forEach((go) => go()); }
}

let ids = 0;
function fitting(models = new FakeModels()) {
  const stylist = new Stylist(models, { imageUrl: (t) => `/img/${t}`, newId: () => `id${++ids}` });
  stylist.nameSkipped = true;
  return { f: new Fitting(stylist), models };
}

/** Every milestone of a request's job, in order; the result milestone's words first. */
async function settle(f: Fitting, ran: Ran) {
  const steps = [];
  for (const m of ran.job?.milestones ?? []) steps.push({ m, ...(await f.step(ran.job!.id, m)!) });
  return { result: steps.find((s) => s.m === ran.result)?.text ?? null, steps };
}

const tool = (f: Fitting, name: string, args: Record<string, unknown> = {}) => f.do(intentOfTool(name, args)!, host);
const press = (f: Fitting, body: Record<string, unknown>) => { const b = intentOfButton(body)!; return f.do(b.intent, { by: 'user', pressed: b.pressed }); };

/** A fitting with its photo rated for dinner out. */
async function rated(models = new FakeModels()) {
  const { f } = fitting(models);
  await settle(f, press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO }));
  await settle(f, tool(f, 'rate_outfit', { occasion: 'dinner out' }));
  return { f, models };
}

describe('rating the outfit', () => {
  test('an occasion with no photo yet is noted, and the photo asked for', () => {
    const { f } = fitting();
    const ran = tool(f, 'rate_outfit', { occasion: 'wedding guest' });
    expect(ran.job).toBeUndefined();
    expect(ran.text).toContain('Done: the occasion is set to wedding guest');
    expect(ran.text).toContain('add a photo of their outfit on the mirror');
    expect(ran.view.target).toBe('wedding guest');
  });

  test('nothing to rate against: Emery asks what they are dressing for', () => {
    const { f } = fitting();
    expect(tool(f, 'rate_outfit').text).toMatch(/^Not yet: .*ask what they're dressing for/i);
  });

  test('a photo with no occasion: the button says what was pressed, and the occasion is asked for', async () => {
    const { f, models } = fitting();
    const ran = press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO });
    // Said at once: the photo is in the mirror; the occasion is asked for.
    expect(ran.text).toBe("The user added a new photo of their outfit on screen. Done: their outfit photo is in the mirror now. To score it you need what they're dressing for: ask them.");
    const { result } = await settle(f, ran);
    expect(result).toBeNull();   // "it can't be rated yet" is not said twice
    expect(models.reads).toHaveLength(0);
  });

  test("Emery's rate_outfit with an occasion: the verdict is her result, not worded as a button", async () => {
    const { f, models } = fitting();
    await settle(f, press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO }));
    const ran = tool(f, 'rate_outfit', { occasion: 'dinner out' });
    expect(ran).toMatchObject({ text: null, result: 'done' });
    expect(ran.view.target).toBe('dinner out');
    const { result } = await settle(f, ran);
    expect(result).toMatch(/^Done: the verdict is 6 out of 10 for dinner out/);
    expect(models.reads.at(-1)?.target).toBe('dinner out');
  });

  test('the same outfit for another occasion is re-read for it; a picked occasion is worded as the press', async () => {
    const { f, models } = await rated();
    models.scores = [3];
    const ran = press(f, { button: 'occasion', occasion: 'Job interview' });
    const { result } = await settle(f, ran);
    expect(result).toMatch(/^The user picked "Job interview" as what they're dressing for on screen\. Done: the verdict is 3 out of 10 for Job interview/);
    expect(models.reads.at(-1)?.context).toContain('new target: Job interview');
  });

  test('asked again while a read is running: no second read, Emery is told it is coming', async () => {
    const { f, models } = fitting();
    await settle(f, press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO }));
    const first = tool(f, 'rate_outfit', { occasion: 'dinner out' });
    const again = tool(f, 'rate_outfit', { occasion: 'Dinner out' });   // the same occasion, said again
    expect(again.job).toBeUndefined();
    expect(again.text).toContain('being read for dinner out right now');
    await settle(f, first);
    expect(models.reads).toHaveLength(1);
  });

  test('an occasion picked while a new photo is still being checked: one read, one verdict', async () => {
    const { f, models } = fitting();
    const photo = press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO });
    const picked = press(f, { button: 'occasion', occasion: 'First date' });
    expect(picked.job).toBeUndefined();
    expect(picked.text).toContain('being read for First date right now');
    const { result } = await settle(f, photo);
    expect(photo.text).toMatch(/^The user added a new photo of their outfit on screen\. Done: their outfit photo is in the mirror now/);
    expect(result).toMatch(/^The photo they just added has been read\. Done: the verdict is 6 out of 10 for First date/);
    expect(models.reads).toHaveLength(1);
  });

  test('rate it again with nothing changed: the same reading, and Emery says it is the same', async () => {
    const { f, models } = await rated();
    const reads = models.reads.length;
    const { result } = await settle(f, tool(f, 'rate_outfit'));
    expect(result).toMatch(/^Done: the same verdict as before, 6 out of 10 for dinner out/);
    expect(result).toContain("the photo and the occasion haven't changed");
    expect(models.reads).toHaveLength(reads);
  });
});

describe('trying a piece on', () => {
  test('"the second one" is the second piece; accepted at once, then the picture and the new score follow', async () => {
    const models = new FakeModels();
    models.scores = [5, 7];
    const { f } = await rated(models);
    const ran = tool(f, 'try_on', { piece: 'the second one' });
    expect(ran.result).toBeUndefined();
    expect(ran.text).toMatch(/^Started: putting the Camel Wool Topcoat on their photo now/);
    expect(ran.job?.milestones).toEqual(['image', 'done']);
    const { steps } = await settle(f, ran);
    expect(steps[0].text).toMatch(/^Done: the Camel Wool Topcoat is on their photo now/);
    expect(steps[0].view.image).toMatchObject({ kind: 'tryon', item: 'Camel Wool Topcoat' });
    expect(steps[1].text).toMatch(/^Done: with the Camel Wool Topcoat on, the outfit scores 7 out of 10/);
    expect(steps[1].text).toContain('lifts the look by 2 points (it was 5)');
    expect(models.tryOns[0]).toContain('Adds structure over the tee.');   // the rail's reason goes into the render
  });

  test('no piece named, or no garment: Emery asks which; nothing is rendered', async () => {
    const { f, models } = await rated();
    expect(tool(f, 'try_on', { piece: 'it' }).text).toContain('ask them to name it');
    expect(tool(f, 'try_on', { piece: 'something different' }).text).toContain("isn't a piece of clothing");
    expect(tool(f, 'try_on', {}).text).toContain('ask them to name it');
    expect(models.tryOns).toEqual([]);
  });

  test('a piece out of frame is refused with the reason, at once', async () => {
    const models = new FakeModels();
    models.zonesFor = ['head', 'neck', 'upper_body'];
    const { f } = await rated(models);
    const ran = tool(f, 'try_on', { piece: 'white leather sneakers' });
    expect(ran.job).toBeUndefined();
    expect(ran.text).toContain("their feet aren't in the photo");
  });

  test('a rating asked for while a piece goes on waits for the try-on\'s own new score', async () => {
    const models = new FakeModels();
    models.holdTryOns = true;
    const { f } = await rated(models);
    const reads = models.reads.length;
    const ran = press(f, { button: 'tryOn', piece: 'Camel Wool Topcoat', why: 'Adds structure.' });
    expect(ran.text).toMatch(/^The user tapped Try it on for the Camel Wool Topcoat on screen\. Started: putting the Camel Wool Topcoat/);
    await new Promise((r) => setTimeout(r, 0));
    expect(tool(f, 'rate_outfit').text).toMatch(/^Not yet: the Camel Wool Topcoat is still going on/);
    models.release();
    await settle(f, ran);
    expect(models.reads.length).toBe(reads + 1);   // only the try-on's re-read
  });

  test('back to the own photo: refused when nothing is on, a fresh verdict otherwise', async () => {
    const { f } = await rated();
    expect(tool(f, 'restore_photo').text).toContain('nothing to take off');
    await settle(f, tool(f, 'try_on', { piece: 'Slim Navy Silk Tie' }));
    const ran = tool(f, 'restore_photo');
    expect(ran.result).toBe('done');
    const { result, steps } = await settle(f, ran);
    expect(result).toContain('Done: the verdict is 6 out of 10 for dinner out');
    expect(steps[0].view.image?.kind).toBe('look');
  });
});

describe('more pieces', () => {
  test('no verdict yet: nothing to add to', () => {
    const { f } = fitting();
    expect(tool(f, 'suggest_pieces').text).toMatch(/^Not yet: .*there is no photo to read/);
  });

  test('more pieces are named as they land on the rail', async () => {
    const { f, models } = await rated();
    models.pieces = [{ item: 'Grey Cashmere Beanie', text: 'Soft texture up top.' }];
    const { result } = await settle(f, tool(f, 'suggest_pieces'));
    expect(result).toContain('Grey Cashmere Beanie');
    expect(result).toContain('put it on only if they say yes');
  });

  test('a direction leans the rail, and the result names the fresh pieces', async () => {
    const { f } = await rated();
    const ran = tool(f, 'suggest_pieces', { direction: 'more streetwear' });
    const { result } = await settle(f, ran);
    expect(result).toContain('Done: the rail now leans streetwear');
    expect(result).toContain('Slim Navy Silk Tie');
  });
});

describe('arguments as the host sends them', () => {
  test('capitals, articles, synonyms and fields Notch does not know are all fine', async () => {
    const { f, models } = await rated();
    const rerated = tool(f, 'rate_outfit', { occasion: '  A Summer Wedding, please! ', mood: 'excited', confidence: 0.9 });
    expect(rerated.view.target).toBe('summer wedding');
    expect((await settle(f, rerated)).result).toMatch(/^Done: the verdict is 6 out of 10 for summer wedding/);
    const leaned = tool(f, 'suggest_pieces', { direction: 'Make it a bit Dressier', count: 3 });
    expect((await settle(f, leaned)).result).toMatch(/^Done: the rail now leans formal/);
    const put = tool(f, 'try_on', { piece: 'The Second One', size: 'M' });
    expect(put.text).toMatch(/^Started: putting the Camel Wool Topcoat/);
    await settle(f, put);
    expect(models.tryOns).toHaveLength(1);
  });

  test('an empty or unusable value is read as none, and Emery is told what to ask', () => {
    const { f } = fitting();
    expect(tool(f, 'rate_outfit', { occasion: '   ' }).text).toMatch(/^Not yet: .*ask what they're dressing for/i);
    expect(tool(f, 'rate_outfit', { occasion: 42 }).text).toMatch(/^Not yet:/);
    expect(tool(f, 'try_on', { piece: 'that one' }).text).toMatch(/^Not clear: .*ask them to name it/);
  });
});

test('only real tools and buttons come in', () => {
  expect(intentOfTool('web_search', {})).toBeNull();
  expect(intentOfTool('rate_outfit', { occasion: 42 })).toEqual({ kind: 'rate' });
  expect(intentOfButton({ button: 'occasion', occasion: '   ' })).toBeNull();
  expect(intentOfButton({ button: 'photo', mime: 'image/jpeg' })).toBeNull();
  expect(intentOfButton({ button: 'delete_everything' })).toBeNull();
  expect(intentOfButton({ button: 'photo', mime: 'image/jpeg', data: PHOTO, example: true })?.pressed).toBe('chose the example outfit');
});

test('pieces leaning a new way, overtaken by a new photo: the result says the look changed, not "nothing came back"', async () => {
  const { f, models } = await rated();
  let release!: () => void;
  models.hold = new Promise<void>((r) => { release = r; });
  // The new occasion is set at once, so the direction's read (queued first) is a fresh model read, held here.
  const leaned = tool(f, 'suggest_pieces', { direction: 'more streetwear' });
  const rerated = tool(f, 'rate_outfit', { occasion: 'gala' });
  await new Promise((r) => setTimeout(r, 0));
  const photo = press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO });
  models.hold = null;
  release();
  const [{ result: lean }, { result: rate }] = [await settle(f, leaned), await settle(f, rerated)];
  await settle(f, photo);
  // The direction's read (for the old photo) was overtaken: it says so, not "no pieces came back".
  expect(lean).toMatch(/^Not yet: a new photo came in while this was being read/);
  // The gala rating was queued behind it and read the new photo: a real verdict.
  expect(rate).toMatch(/^Done: the verdict is 6 out of 10 for gala/);
});

test('a rating overtaken by a new photo is answered as such, not as a failure', async () => {
  const { f, models } = await rated();
  let release!: () => void;
  models.hold = new Promise<void>((r) => { release = r; });
  const rating = tool(f, 'rate_outfit', { occasion: 'wedding' });
  await new Promise((r) => setTimeout(r, 0));
  const photo = press(f, { button: 'photo', mime: 'image/jpeg', data: PHOTO });
  models.hold = null;
  release();
  const { result } = await settle(f, rating);
  await settle(f, photo);
  expect(result).toMatch(/^Not yet: a new photo came in while this was being read/);
});
