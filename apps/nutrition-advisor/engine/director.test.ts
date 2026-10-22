// Ported from the original's tests on its words: test_named_food.py,
// test_read_the_card_back_in_markdown.py and test_parity.py (the
// instructions, now NOTES), test_said_it_was_on_the_panel.py (the panel note,
// now the board) and test_the_photo_leg_fails_in_silence.py (the failure
// lines). Plus what the API adds: every text within its limit.
import { describe, expect, it } from 'vitest';
import { Advisor, MAX_SHELF } from './advisor.ts';
import { boardState, MAX_NOTE, MAX_STATE, NO_SCREEN, NOTES, PHOTO_FAILED, SAMPLE_FAILED, say } from './director.ts';
import type { NutritionData, RecipeDetails } from './types.ts';

const ALL = NOTES.join('\n');

function food(name: string, over: Partial<NutritionData> = {}): NutritionData {
  return {
    product_name: name,
    serving_size: '1 medium (118 g)',
    calories: 105,
    nutrients: { protein_g: 1.3, carbs_g: 27, fat_g: 0.4, fiber_g: 3.1, sugar_g: 14.4, sodium_mg: 1 },
    health_score: 9,
    health_summary: 'Sweet, with fiber and potassium.',
    recipes: [
      { name: 'Banana oat smoothie', description: 'Blend it with oats.' },
      { name: 'Banana bread', description: 'A classic loaf.' },
    ],
    source: 'estimate',
    portion_assumed: true,
    ...over,
  };
}

const recipe = (name: string, steps = ['Peel the banana.', 'Blend with oats and milk.']): RecipeDetails => ({
  recipe_name: name, description: 'Blend it with oats.', ingredients: ['1 banana', '40 g oats', '200 ml milk'], preparation_steps: steps,
});

describe('the standing notes', () => {
  it('each fits the 2,000-character limit', () => {
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(MAX_NOTE);
  });

  it('naming a food is a complete request, never a reason to ask for the camera', () => {
    // "What's in a banana?" got "Please show me a banana through the camera"
    // twice, with the board reading "Hold a food product up to the camera".
    expect(ALL).toMatch(/Naming a food is a complete request/);
    expect(ALL).toMatch(/Never ask them to show it to the camera first/);
    expect(ALL).toMatch(/never ask them to hold anything up to a camera/i);
  });

  it('it knows photos come through the panel, and never says it cannot look at them', () => {
    expect(ALL).toMatch(/photo button/);
    expect(ALL).toMatch(/never say you cannot look at photos/);
  });

  it('a check-in after a silence never asks for a camera', () => {
    // The original's idle nudge became the platform's own check-in; its rule lives here.
    expect(ALL).toMatch(/When you check in after a silence[^.]*; never ask for a camera/);
  });

  it('the screen is the board’s, and saying a food is displayed does not display it', () => {
    expect(ALL).toMatch(/only truth about the screen/);
    expect(ALL).toMatch(/Never tell the user something is on screen/);
    expect(ALL).toMatch(/saying a food is displayed does not display it/);
  });

  it('the app decides; the avatar holds with a few words and waits', () => {
    expect(ALL).toMatch(/say only a few words like "let me pull that up" and stop/);
    expect(ALL).toMatch(/If it already told you, carry on from it/);
  });

  it('numbers come only from the board', () => {
    expect(ALL).toMatch(/Numbers come only from the board/);
    expect(ALL).toMatch(/never estimate one of your own/);
  });

  it('a card on screen means the takeaway, not the numbers', () => {
    // A working card felt redundant once the avatar read all six figures aloud.
    expect(ALL).toMatch(/Do not read the figures back/);
    expect(ALL).toContain('TAKEAWAY');
  });

  it('markdown is forbidden by name, not just by the word markdown', () => {
    // "1. **Peel the banana**": the model does not read a numbered list as markdown.
    const voice = ALL.toLowerCase();
    expect(voice).toContain('never use markdown');
    for (const banned of ['asterisk', 'numbered list', 'heading']) expect(voice, banned).toContain(banned);
    expect(ALL).toMatch(/said as sentences/);
  });

  it('a walkthrough goes one or two steps at a time, and is exempt from the short-sentence rule', () => {
    expect(ALL).toMatch(/one or two steps at a time/);
    expect(ALL).toMatch(/walkthrough they asked for is the one place/i);
    expect(ALL).toMatch(/one sentence under 16 words/);
  });

  it('a comparison is a verdict only once both are on screen', () => {
    expect(ALL).toMatch(/A comparison is one line[^.]*only once the board lists both foods/);
  });

  it('asks about quantity only when it matters, with a card already up', () => {
    expect(ALL).toMatch(/screen is never empty while you ask/);
  });

  it('provenance has a meaning the avatar can say', () => {
    expect(ALL).toMatch(/"Label" figures were read off a nutrition label in their photo/);
    expect(ALL).toMatch(/assumed portion is an assumption/);
  });

  it('the advice line is drawn at the person, and every refusal names the door', () => {
    // A diabetic tester was given a daily carb target, a meal plan and a
    // safe/not-safe verdict while every stated rule passed.
    expect(ALL).toMatch(/read this twice/);
    expect(ALL).toMatch(/You do not tell THIS person what THEY should eat/);
    expect(ALL).toMatch(/no daily targets for them, no meal plans/);
    expect(ALL).toMatch(/Not even when they insist/);
    expect(ALL).toMatch(/it is NOT a judgement about anyone's medical condition/);
    expect(ALL).toMatch(/name the door in the same breath/);
    expect(ALL).toMatch(/not a doctor or a dietitian/);
  });

  it('carries no name of its own: who is advising is the avatar’s persona', () => {
    expect(ALL).not.toContain('Rachel');
  });
});

describe('the board names what is on screen, and only that', () => {
  it('an empty screen says so rather than saying nothing', () => {
    // A model with no account of the screen answers from the conversation:
    // that is how a banana that was never displayed got announced as displayed.
    const board = boardState(new Advisor().view());
    expect(board).toMatch(/Nothing is on the user's screen yet/);
    expect(board).toMatch(/you have no figures for it/);
  });

  it('names the card that is up, with every figure the card prints', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    const board = boardState(a.view());
    expect(board).toContain('the nutrition card for "Medium banana"');
    expect(board).toContain('105 calories');
    expect(board).toContain('protein 1.3 g (3% DV)');
    expect(board).toContain('fiber 3.1 g (11% DV)');
    expect(board).toContain('sugar 14.4 g (total sugar; no daily value)');
    expect(board).toContain('sodium 1 mg (0% DV)');
    expect(board).toContain('Health score 9 of 10');
    expect(board).toMatch(/assumed portion/);
    expect(board).toMatch(/estimated, not read from a label/);
    expect(board).toContain('Banana oat smoothie (Blend it with oats.)');
  });

  it('a label reading says so', () => {
    const a = new Advisor();
    a.show(food('Oat milk', { source: 'label', portion_assumed: false, serving_size: '240 ml' }));
    const board = boardState(a.view());
    expect(board).toMatch(/read from the nutrition label in their photo/);
    expect(board).not.toMatch(/assumed portion/);
  });

  it('a food that was only talked about is not on it', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    expect(boardState(a.view()).toLowerCase()).not.toContain('apple');
  });

  it('one food is not a comparison table it can point at', () => {
    // The table renders only from two foods; "it's in the comparison table
    // below" was said over no table.
    const a = new Advisor();
    a.show(food('Medium banana'));
    expect(boardState(a.view())).toMatch(/No comparison table yet/);
    a.show(food('Medium apple', { calories: 95 }));
    const board = boardState(a.view());
    expect(board).toMatch(/Comparison table under the card, 2 foods side by side/);
    expect(board).toContain('Medium banana, 1 medium (118 g): 105 cal');
    expect(board).toContain('Medium apple, 1 medium (118 g): 95 cal');
  });

  it('kept recipes are not claimed before anything is on screen', () => {
    // The chips render under the card only.
    const a = new Advisor();
    a.rememberRecipe(recipe('Banana smoothie'));
    expect(boardState(a.view())).not.toContain('Banana smoothie');
    a.show(food('Medium banana'));
    expect(boardState(a.view())).toMatch(/Recipes the user opened before[^.]*Banana smoothie/);
  });

  it('an open recipe is named with its steps, and covers the card', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    const open = recipe('Banana oat smoothie');
    const board = boardState(a.view(), { ...NO_SCREEN, recipe: open });
    expect(board).toContain('On screen: the recipe card "Banana oat smoothie"');
    expect(board).toContain('(1) Peel the banana. (2) Blend with oats and milk.');
    expect(board).toMatch(/It covers the nutrition card, which they can go back to/);
  });

  it('a recipe still being made is not claimed to have steps', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    const board = boardState(a.view(), { ...NO_SCREEN, loadingRecipe: 'Banana bread' });
    expect(board).toMatch(/"Banana bread" is opening; the app is still making its card, so its steps are not on screen yet/);
  });

  it('says what the app is doing, and that it is not on screen yet', () => {
    const board = boardState(new Advisor().view(), { ...NO_SCREEN, working: 'looking up "apple"' });
    expect(board).toMatch(/working on this right now: looking up "apple"\. It is not on screen yet/);
  });

  it('stages the card’s recipes for when the user asks, never to recite unasked', () => {
    // Without it the avatar answers "how do I make the smoothie?" with a
    // recipe of its own, and the card that opens a moment later disagrees.
    const a = new Advisor();
    a.show(food('Medium banana'));
    a.prepare('Medium banana', recipe('Banana oat smoothie'));
    const board = boardState(a.view());
    expect(board).toMatch(/If the user asks how to make one of these recipe ideas/);
    expect(board).toMatch(/Never recite one unasked/);
    expect(board).toContain('Peel the banana.');
    // Not twice once it is open.
    expect(boardState(a.view(), { ...NO_SCREEN, recipe: recipe('Banana oat smoothie') })).not.toMatch(/If the user asks how to make/);
  });
});

describe('the board at its fullest', () => {
  const wide = 'とても長い食べ物の名前';
  function fullest() {
    const a = new Advisor();
    for (let i = 0; i < MAX_SHELF + 4; i++) {
      a.show(food(`${wide}${i}`, {
        serving_size: `${wide} 1 cup`,
        health_summary: wide.repeat(28).slice(0, 320),
        recipes: [0, 1, 2].map((r) => ({ name: `${wide} ${r}`.slice(0, 60), description: wide.repeat(18).slice(0, 200) })),
      }));
    }
    for (let i = 0; i < MAX_SHELF + 4; i++) a.rememberRecipe(recipe(`${wide} 料理 ${i}`));
    const long = (n: number) => Array.from({ length: n }, () => wide.repeat(20).slice(0, 220));
    for (const idea of a.nutrition!.recipes) a.prepare(a.nutrition!.product_name, { ...recipe(idea.name, long(8)), ingredients: long(10).map((s) => s.slice(0, 100)) });
    return { a, open: { ...recipe(`${wide} 0`, long(8)), ingredients: long(10).map((s) => s.slice(0, 100)), description: wide.repeat(18).slice(0, 200) } };
  }

  it('stays under the limit with a full table, full kept list, staged recipes and an open recipe', () => {
    const { a, open } = fullest();
    for (const screen of [NO_SCREEN, { ...NO_SCREEN, recipe: open }, { ...NO_SCREEN, loadingRecipe: open.recipe_name, working: 'reading your photo' }]) {
      const board = boardState(a.view(), screen);
      expect(board.length).toBeLessThanOrEqual(MAX_STATE);
      // What is on screen and the rule survive; the extras give way first.
      expect(board).toMatch(/Quote figures only from this board/);
      expect(board).toContain(a.nutrition!.product_name);
    }
  });

  it('gives way in order: the staged recipes, then the oldest rows, never the food on the card', () => {
    const { a, open } = fullest();
    const plain = boardState(a.view());
    expect(plain).not.toMatch(/If the user asks how to make/);
    expect(plain).toContain(`${MAX_SHELF} foods side by side: `);
    const covered = boardState(a.view(), { ...NO_SCREEN, recipe: open });
    expect(covered).toMatch(/older ones not listed here/);
    expect(covered).toContain(`${wide}${MAX_SHELF + 3}, `);
  });
});

describe('events', () => {
  it('the first food of a session says nothing about comparing', () => {
    expect(say.card(['Medium banana'], [], undefined, 'button').toLowerCase()).not.toContain('comparison');
  });

  it('a second food is said to be visible alongside the first, so the avatar stops inventing it', () => {
    const line = say.card(['Medium apple'], ['Medium banana'], 'and an apple?', 'typed');
    expect(line).toContain('"Medium banana"');
    expect(line).toContain('comparison table');
    expect(line).toContain('The user typed: "and an apple?"');
  });

  it('a spoken request is not answered twice', () => {
    expect(say.card(['Medium banana'], [], "what's in a banana", 'spoken')).toMatch(/You may already have said a few words; do not repeat yourself/);
  });

  it('a comparison names the foods side by side and asks for one line', () => {
    const line = say.compare(['Medium apple'], ['Medium banana', 'Medium apple'], 3, 'compare it with an apple', 'spoken');
    expect(line).toMatch(/"Medium banana" and "Medium apple" side by side \(with 1 other food looked at earlier\)/);
    expect(line).toMatch(/one-line verdict/);
  });

  it('a lost card becomes something said, never silence or an apology about a system', () => {
    const line = say.lookupFailed(['dragon fruit'], undefined, 'button');
    expect(line).toMatch(/OUT LOUD/);
    expect(line).toMatch(/do not mention the screen, the card, or an error/);
    expect(say.recipeFailed('Banana bread')).toMatch(/OUT LOUD, one or two steps at a time/);
  });

  it('re-opening a recipe is not a silent panel change', () => {
    expect(say.kept('Berry parfait', undefined, 'button')).toContain('"Berry parfait"');
  });

  it('a tapped recipe gets one short line; a spoken one is walked through', () => {
    expect(say.recipe('Berry parfait', undefined, 'button')).toMatch(/one spoken sentence under 16 words/);
    expect(say.recipe('Berry parfait', 'how do I make the parfait', 'spoken')).toMatch(/one or two steps at a time/);
  });

  it('the opening invites a food or a photo, never the camera', () => {
    expect(say.start()).toMatch(/name any food, or share a photo of one/);
    expect(say.start()).toMatch(/Never ask them to hold anything up to a camera/);
  });

  it('a photo says whether it was read from a label', () => {
    expect(say.photo(food('Oat milk', { source: 'label', portion_assumed: false }), 'a carton of oat milk', false, [])).toMatch(/read from its nutrition label/);
    expect(say.photo(food('Salmon plate'), 'a plate of salmon', true, [])).toMatch(/tried the sample photo[^]*no label to read[^]*assumed portion/);
  });
});

describe('when a photo fails', () => {
  it('the failure line offers the way that needs no photo, and no error', () => {
    const line = PHOTO_FAILED.toLowerCase();
    expect(line).toContain('name the food');
    expect(line).toContain('do not mention an error');
    expect(say.notFood('a cat')).toMatch(/share another, or just name the food/);
  });

  it('the sample’s reason names the other door and never a camera first', () => {
    expect(SAMPLE_FAILED.toLowerCase()).toContain('name any food');
    expect(SAMPLE_FAILED.toLowerCase()).not.toContain('camera');
  });

  it('the sample’s reason finishes the panel’s sentence rather than starting a new one', () => {
    // "The sample did not load — The sample photo would not load. Name any
    // food…." was the same news twice, with two full stops.
    expect(SAMPLE_FAILED[0]).toBe(SAMPLE_FAILED[0].toLowerCase());
    expect(SAMPLE_FAILED.endsWith('.')).toBe(false);
    expect(SAMPLE_FAILED.toLowerCase()).not.toContain('sample');
  });
});
