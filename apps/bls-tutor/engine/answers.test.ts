// The answers people actually give, step by step, for all four drills: the
// right ones in several phrasings (first person, digits, words, "30:2" and
// "thirty two", contractions, he or she), and the wrong ones, including the
// near misses (the previous step's action, a rescue breath for a breathing
// check, keeping 30:2 with two rescuers). Grading must take the whole table:
// a pattern that passes one row and fails another is the bug this file exists
// to catch. answerForm() is the one normaliser both sides go through.
import { describe, expect, test } from 'vitest';
import { find, SCENARIOS } from './scenarios.ts';
import { answerForm, grade, matches } from './tutor.ts';

type Table = Record<string, { right: string[]; wrong: string[] }>;

/**
 * Every response-and-breathing check: asking, and looking or listening for
 * breathing, pass; giving breaths in any words fails (the mix-up the step is
 * there to stop).
 */
/** One answer for each of he, she and they (and his, her, their). */
const forEach = (...forms: string[]) => forms;
const CHECK = {
  right: [
    'is he ok?', 'is she ok', 'are you ok?', 'are they okay', 'can you hear me?', 'is he alright', 'look for breathing', 'listen to see if she breathes', 'feel for his breath on my cheek', 'is she breathing?',
    ...forEach("he's okay", "she's okay", "they're okay"),
    ...forEach("check if he's okay", "check if she's okay", "check if they're okay"),
    ...forEach("see if he's okay", "see if she's okay", "see if they're alright"),
    ...forEach('feel for his breath', 'feel for her breath', 'feel for their breath'),
    ...forEach('listen for his breathing', 'listen for her breathing', 'listen for their breathing'),
    ...forEach('check whether he is breathing', "check whether she's breathing", "check whether they're breathing"),
    'look at her chest to see if she is breathing', 'ask him if he is all right', 'listen to him breathe',
    // the short shouts
    'you ok?', 'hey, you okay?', ...forEach('he ok?', 'she ok?', 'they ok?'), ...forEach('ask him', 'ask her', 'ask them'), "ask her if she's alright",
  ],
  wrong: ['give him two breaths', 'breathe into his mouth', "I'd breathe for her", 'give her a couple of breaths', 'blow into his mouth', 'breathe for him twice', 'give her two breaths', 'breathe into their mouth', 'give them rescue breathing',
    // a treatment framed as a condition, or a hedge around one
    "if he's not breathing, give him two breaths", "if she isn't ok, start compressions", "if they are not breathing I'd do CPR",
    "if he's unresponsive, give rescue breaths", 'check his airway and give two breaths', 'is it CPR? I would push hard on his chest',
    "if he's not okay I'll do mouth to mouth", 'are breaths next? give her a breath', "I'm not sure if it is, but I'd start chest compressions",
    'see if he is ok and then push on his chest',
  ],
};
const withCheck = (rows: { right: string[]; wrong: string[] }) => ({ right: [...rows.right, ...CHECK.right], wrong: [...rows.wrong, ...CHECK.wrong] });

const ANSWERS: Record<string, Table> = {
  adult_cardiac_arrest: {
    scene_safe: {
      right: ["I'd check the scene is safe", "make sure it's safe for me first", 'look around for danger', 'check for hazards', 'is it safe to go over'],
      wrong: ['start CPR', 'call 911', 'check his pulse', 'run over and shake him'],
    },
    check_response: withCheck({
      right: ['tap his shoulders and shout', "I'd check if he's breathing", 'look, listen and feel for a breath', 'see if he responds', "ask him if he's okay", 'watch his chest rise', 'shake him and see if he wakes up', 'see if he breathes normally'],
      wrong: ['give him rescue breaths', 'two rescue breaths', 'start rescue breathing', 'do mouth to mouth', 'start compressions', 'call 911', 'check his pulse'],
    }),
    call_911: {
      right: ['call 911', "I'd call nine one one", 'call 9-1-1 and get someone to grab the AED', 'call an ambulance', 'phone emergency services', 'shout for help and send someone for the defibrillator', 'dial 112', "I'll ring for an ambulance"],
      wrong: ['call out to him', 'start compressions', 'check his pulse again', 'keep going until help takes over', 'wait and see'],
    },
    compressions: {
      right: ['heel of my hand on the centre of his chest and push hard and fast', 'start CPR', 'chest compressions', "I'd pump his chest", 'hands in the middle of the chest and push down hard'],
      wrong: ['give him two breaths first', 'check his pulse', 'put him in the recovery position', 'wait for the AED'],
    },
    breaths: {
      right: ['30 compressions then 2 breaths', 'thirty two', '30 to two', 'thirty to 2', 'thirty-two', '30:2', '30/2', '32', 'two breaths after every thirty compressions', "I'd do 30 and 2", 'thirty compressions to two breaths', 'add rescue breaths'],
      wrong: ['push 2 inches deep', '100 to 120 a minute', '15 to 2', 'two minutes then swap', 'look in his mouth', 'just keep pushing'],
    },
    aed: {
      right: ['turn it on and do what it says', 'switch it on and follow the prompts', 'put the pads on his bare chest', "I'd turn it on and attach the pads", 'follow its instructions', 'use it straight away'],
      wrong: ['call 911 and send for an AED', 'keep it for later', 'check his pulse first', 'keep pushing and ignore it'],
    },
    continue_until: {
      right: ['until the paramedics take over', 'when the ambulance comes', 'until EMS arrives', 'until the AED tells me to stop', 'when he starts breathing normally', 'if he wakes up', 'swap with someone every two minutes', 'until help gets here', 'when someone takes over', 'until the AED says to stop'],
      wrong: ["when I'm tired", 'until my arms give out', 'after ten minutes', 'when the AED arrives', 'add rescue breaths', 'check for response and normal breathing'],
    },
  },
  child_cardiac_arrest: {
    scene_safe: {
      right: ['check the scene is safe', "make sure the poolside isn't slippery", 'move her away from the pool', "get her away from the water's edge", 'look for danger', "make sure I won't slip in"],
      wrong: ['jump in the pool', 'start CPR', 'call 911', 'check her pulse'],
    },
    check_response: withCheck({
      right: ['tap her and shout', "check if she's breathing normally", 'listen for a breath', 'see if she responds', 'talk to her and see if she wakes'],
      wrong: ['give her rescue breaths', 'start rescue breathing', 'check her pulse', 'start CPR'],
    }),
    cpr_first: {
      right: ['start CPR', 'CPR first', 'two minutes of CPR, then call', 'give rescue breaths and compressions first', "I'd start compressions straight away", 'give 2 minutes of CPR then call 911'],
      wrong: ['call first', 'call 911 first', "I'd phone first", 'check for response and normal breathing', 'run and get my phone'],
    },
    call_911: {
      right: ['call 911', 'now I call nine one one', 'phone an ambulance and get an AED', 'call emergency services'],
      wrong: ['keep doing CPR', 'check her pulse', 'give up'],
    },
    compressions_child: {
      right: ['one or two hands, a third of her chest, fast', 'push about 2 inches deep at 100 to 120', '5 cm deep, fast, with one hand', 'two hands on the centre of her chest', 'five centimetres deep with one hand'],
      wrong: ['two fingers', 'gently press her tummy', 'call 911'],
    },
    ratio_child: {
      right: ['yes, 15 to 2', 'fifteen two', 'it becomes fifteen to two', '15:2 with two rescuers', 'we switch to 15 compressions and 2 breaths', 'yes it changes to fifteen and two'],
      wrong: ['no, it stays 30 to 2', 'still thirty two', 'nothing changes', 'the ratio is the same', 'keep going at 30:2', '30 to 2', 'the ratio stays the same'],
    },
    aed_pediatric: {
      right: ['use the child pads', 'paediatric pads if it has them', 'switch it to the child setting', 'adult pads if there are no child ones', 'pads front and back', 'smaller pads for kids'],
      wrong: ['go back to compressions', 'turn it on', "don't use it on a child", "it's the same as an adult"],
    },
  },
  choking_adult: {
    assess_choking: {
      right: ["ask her if she's choking", "I'd ask are you choking", 'see if she can cough or speak', 'check if she can breathe'],
      wrong: ['give her back blows', 'do the Heimlich', 'hit her on the back', 'call 911', 'slap her back'],
    },
    encourage_cough: {
      right: ['encourage her to keep coughing', 'let her cough', 'stay with her and watch', 'do nothing but keep an eye on her'],
      wrong: ['back blows', 'give her abdominal thrusts', 'do the heimlich now', 'give her some water'],
    },
    back_blows: {
      right: ['lean her forward and give five back blows', '5 back blows between the shoulder blades', 'slap her back hard between the shoulder blades', 'back slaps'],
      wrong: ['abdominal thrusts', 'the heimlich', 'keep encouraging her to cough'],
    },
    abdominal_thrusts: {
      right: ['abdominal thrusts', 'five abdominal thrusts', 'do the Heimlich', 'fist just above her belly button and pull in and up', 'stand behind her and thrust upwards', 'fist just above the navel and pull in and up'],
      wrong: ['five more back blows', 'give her five more', 'keep going with back blows', 'lie her down'],
    },
    repeat_cycle: {
      right: ['keep alternating until it comes out', 'repeat 5 and 5 until it clears', 'keep going until she can breathe or passes out', 'alternate back blows and thrusts'],
      wrong: ['stop after one round', 'give up', 'just do back blows'],
    },
    if_unresponsive: {
      right: ['lower her to the floor and start CPR', 'call 911 and start compressions', 'get her on the ground and begin chest compressions', 'look in her mouth and start CPR'],
      wrong: ['do a finger sweep of her mouth', 'keep doing back blows', 'put her in the recovery position', 'wait for her to wake up'],
    },
  },
  recovery_position: {
    check_response_breathing: withCheck({
      right: ["whether he's breathing normally", "check he's breathing and not responding", 'tap and shout, then look for normal breathing for 10 seconds', 'listen for a breath for ten seconds', 'see if he responds'],
      wrong: ['give him rescue breaths', 'check his pulse', 'start CPR', 'roll him on his side'],
    }),
    call_911: {
      right: ['call 911', "I'd call an ambulance", 'phone for help', 'call nine one one now', 'phone for an ambulance'],
      wrong: ['keep checking his breathing until help arrives', 'wait to see if he wakes up', 'start CPR'],
    },
    roll_to_side: {
      right: ['roll him onto his side', 'put him in the recovery position', 'turn him on his side'],
      wrong: ['start CPR', 'leave him on his back', 'sit him up'],
    },
    open_airway: {
      right: ['tilt his head back', 'lift his chin to keep the airway open', 'keep his mouth pointing down so it drains', 'keep his airway open'],
      wrong: ['lay him down', 'put a pillow under his head', 'give him water', 'give him water in his mouth'],
    },
    monitor_breathing: {
      right: ['stay with him and keep checking his breathing', 'monitor his breathing until the ambulance comes', 'keep him warm and watch him', 'roll him to the other side after 30 minutes'],
      wrong: ['give him rescue breaths', 'check his pulse every minute', 'leave him and go get help', 'give him something to drink'],
    },
  },
};

describe('every step, every answer people give', () => {
  test('the table covers every step of every drill', () => {
    for (const scenario of SCENARIOS) expect(Object.keys(ANSWERS[scenario.id]).sort(), scenario.id).toEqual(scenario.steps.map((s) => s.key).sort());
  });

  for (const scenario of SCENARIOS) {
    for (const step of scenario.steps) {
      const { right, wrong } = ANSWERS[scenario.id][step.key];
      test.each(right)(`${scenario.id} / ${step.key}: right: %s`, (answer) => {
        expect(grade(step, answer).ok).toBe(true);
      });
      test.each(wrong)(`${scenario.id} / ${step.key}: wrong: %s`, (answer) => {
        expect(grade(step, answer).ok).toBe(false);
      });
    }
  }

  test('every step still takes its own label as right', () => {
    for (const scenario of SCENARIOS) for (const s of scenario.steps) expect(grade(s, s.label).ok, `${scenario.id}/${s.key}`).toBe(true);
  });

  test('a wrong order or a dangerous move gets its own correction, not a generic nudge', () => {
    const step = (id: string, key: string) => find(id)!.steps.find((s) => s.key === key)!;
    expect(grade(step('child_cardiac_arrest', 'ratio_child'), 'it stays thirty two').note).toContain('15 to 2');
    expect(grade(step('choking_adult', 'if_unresponsive'), 'finger sweep her mouth').note).toContain('blind finger sweep');
    expect(grade(step('recovery_position', 'check_response_breathing'), 'check his pulse').note).toContain('pulse');
  });
});

describe('the normaliser', () => {
  test.each([
    ['30:2', '30:2'], ['thirty two', '30:2'], ['thirty-two', '30:2'], ['30 to two', '30:2'], ['thirty to 2', '30:2'], ['30/2', '30:2'], ['30 and 2', '30:2'], ['32', '30:2'],
    ['fifteen two', '15:2'], ['15 to 2', '15:2'],
    ['nine one one', '911'], ['9-1-1', '911'], ['one one two', '112'],
    ["I'd call", 'you would call'], ['tells me to stop', 'tells you to stop'], ["he's breathing", 'they is breathing'],
    ["the water's edge", 'water edge'], ['start rescue breathing', 'start rescue breaths'], ['do mouth to mouth', 'do rescue breaths'],
    ['Look, listen and feel for a breath.', 'look listen and feel for breath'],
    ['feel for her breath', 'feel for they breath'], ['feel for his breath', 'feel for they breath'], ['tells me my turn', 'tells you you turn'],
    ['Is she okay?', 'is they ok'], ['are you alright', 'are you ok'], ['is he all right', 'is they ok'],
  ])('%s → %s', (said, form) => {
    expect(answerForm(said)).toBe(form);
  });

  test('phrases: all parts in any order, any alternative, each from a word start, "$" a whole word', () => {
    const said = (t: string) => ` ${answerForm(t)} `;
    expect(matches(said("he's okay, I checked"), 'check|see|is + ok$')).toBe(true);
    expect(matches(said('look around'), 'ok$')).toBe(false);          // not inside "look"
    expect(matches(said('give two breaths'), 'breath$')).toBe(false); // "breaths" is giving them
    expect(matches(said('he is unresponsive'), 'unrespon')).toBe(true);
    expect(matches(said('check his breathing'), 'listen|check + breathing')).toBe(true);
    expect(matches(said('check his mouth'), 'listen|check + breathing')).toBe(false);
    // "cue ~N target": the cue at most N words before its target, not anywhere.
    expect(matches(said('see if he breathes'), 'see ~3 breathes')).toBe(true);
    expect(matches(said('see if she is breathing'), 'see ~3 breathing')).toBe(false);   // four words apart
    expect(matches(said('see if she is breathing'), 'see|if|is ~3 breathing')).toBe(true);
    expect(matches(said('if you think about it he is breathing'), 'if ~3 breathing')).toBe(false);
    expect(matches(said('breathing, is it?'), 'is ~3 breathing')).toBe(false);   // after, not before
    expect(matches(said('he ok?'), 'you|they ~1 ok$')).toBe(true);
  });

  test('a range or a count that is not a ratio is left alone', () => {
    expect(answerForm('100 to 120 a minute')).toBe('100 to 120 minute');
    expect(answerForm('push 2 inches deep')).toBe('push 2 inches deep');
  });
});
