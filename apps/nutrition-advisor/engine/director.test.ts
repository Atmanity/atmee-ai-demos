// What the host is told: the instructions and the standing note (the rules the
// original agent learned live, kept), the tools against the API's limits, the
// board (what is on screen, every figure, never over its limit) and the tool
// results (the card's real figures, so the first reply is grounded).
import { describe, expect, it } from 'vitest';
import { Advisor, MAX_SHELF } from './advisor.ts';
import { started, unstarted } from './cook.ts';
import { boardState, INSTRUCTIONS, MAX_INSTRUCTIONS, MAX_NOTE, MAX_STATE, NO_SCREEN, NOTES, PHOTO_FAILED, pressed, said, SAMPLE_FAILED, SERVER_TOOLS, TOOLS } from './director.ts';
import { shelfRow } from './advisor.ts';
import type { NutritionData, RecipeDetails } from './types.ts';

const ALL = [INSTRUCTIONS, ...NOTES].join('\n');

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

const recipe = (name: string, steps = ['Peel the banana.', 'Blend with oats and milk.', 'Pour and serve.']): RecipeDetails => ({
  recipe_name: name, description: 'Blend it with oats.', ingredients: ['1 banana', '40 g oats', '200 ml milk'], preparation_steps: steps,
});

describe('the tools fit the API', () => {
  it('names, descriptions, schemas, sizes and timeouts', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(1);
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  it('the schemas are lenient: a call that does not fit never reaches the page, and the host then claims it worked', () => {
    const all = JSON.stringify(TOOLS.map((t) => t.parameters));
    for (const strict of ['"enum"', '"additionalProperties":false', '"pattern"', '"minLength"', '"minItems"', '"maxItems"', '"format"', '"required"']) expect(all, strict).not.toContain(strict);
    for (const [, max] of all.matchAll(/"maxLength":(\d+)/g)) expect(Number(max)).toBeGreaterThanOrEqual(500);
  });

  it('the server answers the ones that need it; the page answers the recipe’s place itself', () => {
    expect([...SERVER_TOOLS].sort()).toEqual(['compare_foods', 'look_up_food', 'open_recipe', 'start_over']);
    for (const name of SERVER_TOOLS) expect(TOOLS.map((t) => t.name)).toContain(name);
  });

  it('starting over is only ever the user’s idea', () => {
    expect(TOOLS.find((t) => t.name === 'start_over')!.description).toMatch(/Only when the user asks[^.]*; never on your own/);
  });
});

describe('the instructions and the standing note', () => {
  it('fit their limits and name every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS);
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(MAX_NOTE);
    for (const tool of TOOLS) expect(INSTRUCTIONS, tool.name).toContain(tool.name);
  });

  it('the screen changes only through a tool, and narrating an action is not doing it', () => {
    expect(INSTRUCTIONS).toMatch(/The screen changes only when you call a tool/);
    expect(INSTRUCTIONS).toMatch(/Every request that changes the screen is a tool call, even a one-word answer to your own question/);
    expect(INSTRUCTIONS).toMatch(/without the call changes nothing and misleads them/);
    expect(INSTRUCTIONS).toMatch(/Never say an action happened, or that something is on screen, unless a tool's result or the board says so/);
  });

  it('only what is on the card: no nutrient from memory', () => {
    // Live, a banana's takeaway added "and potassium", which the label does not show.
    expect(INSTRUCTIONS).toMatch(/Speak only of what is on the card/);
    expect(INSTRUCTIONS).toMatch(/no potassium, vitamins or glycemic index[^.]*say that isn't on this card/);
  });

  it('a food is looked up before anything is said about it, and no figure is ever its own', () => {
    // "Let me pull that up" over figures from memory that the card then contradicted.
    expect(INSTRUCTIONS).toMatch(/call look_up_food before saying anything about it/);
    expect(INSTRUCTIONS).toMatch(/Never give a figure of your own, even when you think you know it/);
  });

  it('what is on screen is answered from the board, with no tool', () => {
    expect(INSTRUCTIONS).toMatch(/answer from the live board, no tool needed/);
  });

  it('naming a food is enough; a camera is never asked for, and photos are not refused', () => {
    // "What's in a banana?" got "Please show me a banana through the camera", twice.
    expect(INSTRUCTIONS).toMatch(/Naming a food is enough/);
    expect(INSTRUCTIONS).toMatch(/never ask them to hold anything up to a camera/);
    expect(INSTRUCTIONS).toMatch(/photo button/);
    expect(INSTRUCTIONS).toMatch(/never say you cannot look at photos/);
  });

  it('the takeaway, not the figures read back', () => {
    expect(INSTRUCTIONS).toMatch(/Give the takeaway, not the figures read back/);
  });

  it('markdown is forbidden by name, and steps are said as sentences', () => {
    // "1. **Peel the banana**": the model does not read a numbered list as markdown.
    const voice = INSTRUCTIONS.toLowerCase();
    for (const banned of ['no markdown', 'lists', 'asterisks', 'headings']) expect(voice, banned).toContain(banned);
    expect(INSTRUCTIONS).toMatch(/steps are said as sentences/);
  });

  it('a walkthrough goes one or two steps at a time, moved on with next_steps', () => {
    expect(INSTRUCTIONS).toMatch(/one or two steps at a time; when they are ready for more[^.]*call next_steps/);
    expect(INSTRUCTIONS).toMatch(/walkthrough they asked for may take the words it needs, never all at once/);
  });

  it('asks about quantity only when it matters', () => {
    expect(INSTRUCTIONS).toMatch(/ask about quantity only when it would change the numbers a lot/);
  });

  it('provenance has a meaning the host can say', () => {
    expect(INSTRUCTIONS).toMatch(/"Label" figures were read from a nutrition label in their photo/);
    expect(INSTRUCTIONS).toMatch(/assumed portion is an assumption/);
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
    expect(ALL).toMatch(/not their doctor or a dietitian/);
    expect(INSTRUCTIONS).toMatch(/decline kindly, say you are not their doctor or dietitian, and offer to read the numbers instead/);
  });

  it('an emergency gets one answer: call for help now', () => {
    expect(INSTRUCTIONS).toMatch(/emergency[^.]*tell them to call their local emergency number right now, and nothing else/);
  });

  it('carries no name of its own: who is advising is the host’s persona', () => {
    expect(ALL).not.toContain('Rachel');
  });
});

describe('the board names what is on screen, and only that', () => {
  it('an empty screen says so, and where figures come from', () => {
    const board = boardState(new Advisor().view());
    expect(board).toMatch(/Nothing is on the user's screen yet/);
    expect(board).toMatch(/call look_up_food; until a result or this board lists it, you have no figures for it/);
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
    expect(board).toContain('Banana oat smoothie (Blend it with oats)');
  });

  it('a label reading says so', () => {
    const a = new Advisor();
    a.show(food('Oat milk', { source: 'label', portion_assumed: false, serving_size: '240 ml' }));
    const board = boardState(a.view());
    expect(board).toMatch(/read from the nutrition label in their photo/);
    expect(board).not.toMatch(/assumed portion/);
  });

  it('one food is not a comparison table it can point at', () => {
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
    const a = new Advisor();
    a.rememberRecipe(recipe('Banana smoothie'));
    expect(boardState(a.view())).not.toContain('Banana smoothie');
    a.show(food('Medium banana'));
    expect(boardState(a.view())).toMatch(/Recipes the user opened before[^.]*Banana smoothie/);
  });

  it('an open recipe is named with its steps and which are lit up, and covers the card', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    const open = recipe('Banana oat smoothie');
    const board = boardState(a.view(), { ...NO_SCREEN, recipe: open, cook: started(3) });
    expect(board).toContain('On screen: the recipe card "Banana oat smoothie"');
    expect(board).toContain('(1) Peel the banana. (2) Blend with oats and milk. (3) Pour and serve.');
    expect(board).toContain('Steps 1 and 2 are lit up');
    expect(board).toMatch(/It covers the nutrition card, which they can go back to/);
    expect(boardState(a.view(), { ...NO_SCREEN, recipe: open, cook: unstarted() })).toMatch(/No step is lit up yet/);
  });

  it('a recipe still being made is not claimed to have steps', () => {
    const a = new Advisor();
    a.show(food('Medium banana'));
    expect(boardState(a.view(), { ...NO_SCREEN, loadingRecipe: 'Banana bread' })).toMatch(/"Banana bread" is opening; its steps are not on screen yet/);
  });

  it('says what the app is doing, and that it is not on screen yet', () => {
    const board = boardState(new Advisor().view(), { ...NO_SCREEN, working: 'looking up apple' });
    expect(board).toMatch(/working on this right now: looking up apple\. It is not on screen yet/);
  });

  it('names the notices the page put up on its own', () => {
    const view = new Advisor().view();
    expect(boardState(view, { ...NO_SCREEN, concern: 'emergency' })).toMatch(/emergency notice telling them to call their local emergency number/);
    expect(boardState(view, { ...NO_SCREEN, concern: 'medical' })).toMatch(/belong with their doctor or a registered dietitian/);
  });

  it('never stages a recipe the user has not opened', () => {
    // With tools, open_recipe returns the real recipe; nothing waits in the board to be recited.
    const a = new Advisor();
    a.show(food('Medium banana'));
    a.prepare('Medium banana', recipe('Banana oat smoothie'));
    expect(boardState(a.view())).not.toContain('Peel the banana');
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
    return { a, open: { ...recipe(`${wide} 0`, long(8)), ingredients: long(10).map((s) => s.slice(0, 100)), description: wide.repeat(18).slice(0, 200) } };
  }

  it('stays under the limit with a full table, full kept list, an open recipe and both notices', () => {
    const { a, open } = fullest();
    for (const screen of [NO_SCREEN, { ...NO_SCREEN, recipe: open, cook: started(8), concern: 'emergency' as const }, { ...NO_SCREEN, loadingRecipe: open.recipe_name, working: 'reading your photo', concern: 'medical' as const }]) {
      const board = boardState(a.view(), screen);
      expect(board.length).toBeLessThanOrEqual(MAX_STATE);
      // What is on screen and the rule survive; the extras give way first.
      expect(board).toMatch(/Quote figures only from this board/);
      expect(board).toContain(a.nutrition!.product_name);
    }
  });

  it('gives way in order: the oldest rows first, never the food on the card', () => {
    const { a, open } = fullest();
    expect(boardState(a.view())).toContain(`${MAX_SHELF} foods side by side`);
    const covered = boardState(a.view(), { ...NO_SCREEN, recipe: open, cook: started(8) });
    expect(covered).toMatch(/older ones not listed here/);
    expect(covered).toContain(`${wide}${MAX_SHELF + 3}, `);
  });
});

describe('what a tool returns: the real outcome, to speak from', () => {
  it('a card carries every figure on it, and asks for the takeaway', () => {
    const text = said.cards([food('Medium banana')], [], false);
    expect(text).toMatch(/^Done: on screen now, the nutrition card for "Medium banana"/);
    expect(text).toMatch(/Speak only of what this card shows[^.]*say that isn't on this card/);
    expect(text).toContain('105 calories');
    expect(text).toContain('fiber 3.1 g (11% DV)');
    expect(text).toContain('Health score 9 of 10');
    expect(text).toMatch(/give the takeaway/);
    expect(text).toMatch(/Do not read the figures back/);
    expect(text.toLowerCase()).not.toContain('comparison table');
  });

  it('a second food is said to be beside the first, so the host never invents a side by side', () => {
    const text = said.cards([food('Medium apple', { calories: 95 })], ['Medium banana'], false);
    expect(text).toContain('joined the comparison table under the card, alongside "Medium banana"');
    expect(text).toContain('95 calories');
    expect(text).toMatch(/If they asked to compare, give a one-line verdict/);
  });

  it('a food looked at before is back, not new; one that could not be found is said', () => {
    expect(said.cards([food('Medium banana')], ['Medium apple'], true)).toMatch(/^Done: back on screen, [^]*It was already in the comparison table, with "Medium apple"/);
    expect(said.cards([food('Medium banana')], [], false, ['dragon fruit'])).toMatch(/could not find "dragon fruit" just now/);
  });

  it('several cards carry each one’s figures', () => {
    const text = said.cards([food('Medium banana'), food('Medium apple', { calories: 95 })], [], false);
    expect(text).toMatch(/cards for "Medium banana" and "Medium apple"; "Medium apple" is on the card/);
    expect(text).toContain('105 calories');
    expect(text).toContain('95 calories');
  });

  it('a comparison carries the rows side by side and asks for one line', () => {
    const rows = [shelfRow(food('Medium banana')), shelfRow(food('Medium apple', { calories: 95 }))];
    const text = said.compare(rows, ['Medium apple'], 3);
    expect(text).toContain('Medium banana, 1 medium (118 g): 105 cal');
    expect(text).toContain('Medium apple, 1 medium (118 g): 95 cal');
    expect(text).toContain('The table also holds 1 other food looked at earlier');
    expect(text).toContain('Looked up for this: "Medium apple"');
    expect(text).toMatch(/one-line verdict[^.]*from these figures only/);
  });

  it('a recipe opened to be talked through carries its ingredients and the lit steps only', () => {
    const r = recipe('Banana oat smoothie');
    const text = said.recipe(r, 'Medium banana', started(3));
    expect(text).toContain('Ingredients: 1 banana; 40 g oats; 200 ml milk');
    expect(text).toContain('steps 1 and 2 are lit up: (1) Peel the banana. (2) Blend with oats and milk.');
    expect(text).not.toContain('Pour and serve');
    expect(text).toMatch(/when they are, call next_steps/);
    expect(said.recipe(recipe('Toast', ['Toast it.']), '', started(1))).toMatch(/That is the whole recipe/);
  });

  it('the next steps, then the end', () => {
    const r = recipe('Banana oat smoothie');
    const text = said.steps(r, { at: 3, shown: [2, 2] });
    expect(text).toContain('Done: step 3 of 3 of "Banana oat smoothie" is lit up on screen now: (3) Pour and serve.');
    expect(text).toMatch(/That is the last step/);
    expect(said.stepsDone(r)).toMatch(/^Finished: every step[^.]*has been given/);
    expect(said.noRecipe()).toMatch(/open one only if they name it/);
  });

  it('a tapped recipe is offered, never walked through unasked', () => {
    const text = pressed('Open recipe: Banana bread', said.recipeTapped(recipe('Banana bread')));
    expect(text).toMatch(/^The user pressed "Open recipe: Banana bread" on screen\./);
    expect(text).toMatch(/ask whether they would like you to talk them through it; if they do, call next_steps/);
  });

  it('nothing that failed is silence, an error, or an action the host takes on its own', () => {
    const lost = said.lookupFailed(['dragon fruit']);
    expect(lost).toMatch(/nothing about it is on the user's screen/);
    expect(lost).toMatch(/without mentioning an error or a system/);
    expect(lost).toMatch(/ask whether they would like you to try again; do it only if they say so/);
    expect(lost).toMatch(/saying clearly that they are rough/);
    expect(said.recipeFailed('Banana bread')).toMatch(/out loud from what you know, one or two steps at a time/);
    expect(said.noFood()).toMatch(/Ask which food they mean/);
  });

  it('closing, clearing, and the opening', () => {
    expect(said.closed('Medium banana')).toContain('the card for "Medium banana" is on screen again');
    expect(said.notOpen(null)).toContain('nothing is on screen yet');
    expect(said.cleared()).toMatch(/the screen is empty/);
    expect(said.start()).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
    expect(said.start()).toMatch(/invite them to name any food, or to add a photo/);
    expect(said.start()).toMatch(/Never ask them to hold anything up to a camera/);
  });

  it('a photo says whether it was read from a label, with its figures', () => {
    const label = said.photo(food('Oat milk', { source: 'label', portion_assumed: false }), 'a carton of oat milk', false, []);
    expect(label).toMatch(/read from its nutrition label/);
    expect(label).toContain('105 calories');
    expect(said.photo(food('Salmon plate'), 'a plate of salmon', true, ['Medium banana'])).toMatch(/no label to read[^]*assumed portion[^]*alongside "Medium banana"/);
  });

  it('a photo that fails offers the way that needs no photo, and no error', () => {
    expect(PHOTO_FAILED.toLowerCase()).toContain('name the food');
    expect(PHOTO_FAILED.toLowerCase()).toContain('do not mention an error');
    expect(said.notFood('a cat')).toMatch(/add another, or just name the food/);
    expect(SAMPLE_FAILED.toLowerCase()).toContain('name any food');
    expect(SAMPLE_FAILED.endsWith('.')).toBe(false);
  });

  it('every tool result opens with the plain outcome, so a filler cannot pre-judge it', () => {
    const r = recipe('Banana oat smoothie');
    const rows = [shelfRow(food('Medium banana')), shelfRow(food('Medium apple'))];
    const results = [
      said.cards([food('Medium banana')], [], false), said.cards([food('Medium banana')], [], true), said.cards([food('A'), food('B')], [], false),
      said.lookupFailed(['kiwano']), said.noFood(), said.compare(rows, [], 2), said.recipe(r, 'Medium banana', started(3)),
      said.recipeFailed('Banana bread'), said.steps(r, started(3)), said.stepsDone(r), said.noRecipe(), said.whichRecipe(),
      said.closed('Medium banana'), said.notOpen(null), said.cleared(),
    ];
    for (const text of results) expect(text).toMatch(/^(?:Done|Not done|Not found|Finished|Nothing to close): /);
  });

  it('an emergency is one instruction: call for help, first', () => {
    expect(said.emergency()).toMatch(/^Tell them to call their local emergency number right now/);
    expect(said.emergency()).toMatch(/and nothing about food/);
  });
});
