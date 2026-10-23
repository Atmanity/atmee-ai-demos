// Ported from the original `test_constraints_reach_the_plan.py`, the parse
// cases of `test_clearance_stops_the_session.py` and the label/enforce cases
// of `test_the_injury_is_acknowledged.py`.
//
// The symptom they pin: played live, typed "full body, beginner, but I only
// have 20 minutes, no equipment at all, and a bad left knee". The plan came
// back at 25 minutes with "Bodyweight lunges, 10 reps each leg" in it, and
// told again, the coach SAID "let's keep it to 20 minutes without lunges"
// while the card never changed. The plan prompt was "Build my {level} {goal}
// plan now"; nothing else the user said reached the model, and nothing checked
// the model's answer against it.
import { describe, expect, it } from 'vitest';
import * as cons from './constraints.ts';
import { FitnessState } from './state.ts';
import type { FitnessPlan } from './types.ts';

const aPlan = (over: Partial<FitnessPlan> = {}): FitnessPlan => ({
  plan_title: 'Beginner Full Body Blast',
  goal: 'full body',
  level: 'Beginner',
  duration_minutes: 25,
  warmup_steps: ['Arm circles: 1 minute', 'Bodyweight squats: 10 reps'],
  workout_steps: ['Push-ups: 8-10 reps', 'Bodyweight lunges: 10 reps each leg', 'Plank hold: 20-30 seconds'],
  coaching_cues: ['Move with control'],
  ...over,
});
const parse = cons.parseConstraints;

describe('what the user actually typed', () => {
  it('hears the sentence that was dropped, whole', () => {
    const heard = parse('full body, beginner, but I only have 20 minutes, no equipment at all, and a bad left knee');
    expect(heard.minutes).toBe(20);
    expect(heard.equipment).toBe('none');
    expect(heard.injuries).toContain('knee');
    expect(heard.avoid).toContain('lunge');
  });

  it.each([
    ['I only have 20 minutes', 20],
    ['about 45 mins today', 45],
    ['half an hour is all I have', 30],
    ["I've got an hour", 60],
    ['give me a 15-minute session', 15],
    ['no time limit', null],
    // Out of range on both sides: a two-minute workout is a joke and a
    // four-hundred-minute one is a mis-transcription.
    ['two minutes', null],
    ['400 minutes', null],
  ] as const)('reads or sensibly refuses a duration: %s', (text, minutes) => {
    expect(parse(text).minutes).toBe(minutes);
  });

  it('reads a duration said in words (new in this port: a recogniser may not write digits)', () => {
    expect(parse("I've only got twenty minutes").minutes).toBe(20);
    expect(parse('a forty-five minute session').minutes).toBe(45);
    expect(parse('twenty five minutes max').minutes).toBe(25);
  });

  it.each(['no equipment at all', "I don't have any equipment", 'bodyweight only please', "I haven't got any weights"])(
    'hears having nothing to train with: %s',
    (text) => expect(parse(text).equipment).toBe('none'),
  );

  it('keeps the one thing you own as text', () => {
    expect(parse("I've got a kettlebell").equipment).toBe('kettlebell');
  });

  it.each([['a bad left knee', 'knee'], ['my shoulder hurts', 'shoulder'], ['sore lower back', 'back'], ['dodgy ankle', 'ankle']])(
    'hears an injury however it is phrased: %s',
    (text, part) => expect(parse(text).injuries).toContain(part),
  );

  it('bans a move with no injury named', () => {
    expect(parse('no lunges please').avoid).toContain('lunge');
  });

  it('does not mistake "no equipment" for an exercise called equipment', () => {
    // `no <word>` is how a move is banned, so "no equipment" used to print a
    // nonsense chip on the board.
    expect(parse('no equipment').avoid).not.toContain('equipment');
  });
});

describe('the prompt, which is where they were being dropped', () => {
  it('carries the limits instead of only the goal', () => {
    const clause = cons.constraintClause(parse('only 20 minutes, no equipment, bad knee'));
    expect(clause).toContain('20 minutes');
    expect(clause).toContain('NO equipment');
    expect(clause).toContain('knee');
    expect(clause).toContain('lunge');
  });

  it('adds nothing when there is nothing', () => {
    expect(cons.constraintClause(cons.EMPTY)).toBe('');
  });
});

describe('enforcement, because the prompt alone is not enough', () => {
  it('cuts a 25 minute plan to the 20 the user asked for', () => {
    expect(cons.enforce(aPlan(), parse('only 20 minutes')).duration_minutes).toBe(20);
  });

  it('leaves a plan shorter than the cap alone', () => {
    expect(cons.enforce(aPlan({ duration_minutes: 12 }), parse('20 minutes')).duration_minutes).toBe(12);
  });

  it('does not let lunges survive a bad knee', () => {
    const plan = cons.enforce(aPlan(), parse('my left knee is bad'));
    expect(plan.workout_steps.join(' ').toLowerCase()).not.toContain('lunge');
    expect(plan.warmup_steps.join(' ').toLowerCase()).not.toContain('squat');
  });

  it('refills a section the bans emptied from the safe moves that pass', () => {
    // A blank Workout list reads as a broken app and leaves nothing to demo.
    const plan = cons.enforce(aPlan(), parse('bad knee, sore shoulder and a bad wrist'));
    expect(plan.workout_steps.length).toBeGreaterThan(0);
    expect(plan.warmup_steps.length).toBeGreaterThan(0);
  });

  it('does not let dumbbells survive no equipment', () => {
    const plan = cons.enforce(aPlan({ workout_steps: ['Goblet squats with a dumbbell: 12 reps', 'Wall sit: 30 seconds'] }), parse('I have no equipment'));
    expect(plan.workout_steps.some((s) => s.toLowerCase().includes('dumbbell'))).toBe(false);
  });

  it('changes nothing with nothing to enforce', () => {
    const after = cons.enforce(aPlan(), cons.EMPTY);
    expect(after.duration_minutes).toBe(25);
    expect(after.workout_steps).toEqual(aPlan().workout_steps);
  });

  it('returns a new plan rather than editing the one on screen', () => {
    // It once mutated its argument and returned the same object, so the
    // rebuild's fallback compared a plan with itself and never said what changed.
    const plan = aPlan();
    const enforced = cons.enforce(plan, parse('my knee is bad'));
    expect(enforced).not.toBe(plan);
    expect(plan.workout_steps).toContain('Bodyweight lunges: 10 reps each leg');
    expect(enforced.workout_steps.some((s) => s.toLowerCase().includes('lunge'))).toBe(false);
    expect(enforced.coaching_cues).not.toBe(plan.coaching_cues);
  });

  it('leaves a section empty rather than wrong when nothing safe is left', () => {
    // The last-resort fallback ran exactly when the bans had emptied the safe
    // list too, so the one move it forced back in was a banned one.
    const c = parse('I have a bad shoulder, a bad ankle and a bad back');
    const plan = cons.enforce(aPlan({ warmup_steps: [], workout_steps: [] }), c);
    for (const step of [...plan.warmup_steps, ...plan.workout_steps]) expect(cons.stepIsAllowed(step, c), step).toBe(true);
  });
});

describe('accumulating across turns', () => {
  it('keeps the duration when the knee comes ten turns later', () => {
    const state = new FitnessState();
    expect(state.noteConstraints(parse('only 20 minutes'))).toBe(true);
    expect(state.noteConstraints(parse('oh and my knee is bad'))).toBe(true);
    expect(state.constraints.minutes).toBe(20);
    expect(state.constraints.injuries).toContain('knee');
  });

  it('lets a change of mind about the duration win', () => {
    const state = new FitnessState();
    state.noteConstraints(parse('20 minutes'));
    state.noteConstraints(parse('actually make it 40 minutes'));
    expect(state.constraints.minutes).toBe(40);
  });

  it('does not count a turn with no constraints as a change', () => {
    // The change flag triggers a rebuild; ordinary talk must not redraw the board.
    const state = new FitnessState();
    state.noteConstraints(parse('20 minutes'));
    expect(state.noteConstraints(parse('that sounds great, thanks'))).toBe(false);
  });

  it('keeps a bare clearance disclosure on merge', () => {
    // `merge_constraints` once omitted `clearance`, so this merged to EMPTY
    // and the state never changed.
    const heard = parse("I'm 7 months pregnant");
    expect(heard.clearance).toEqual(['pregnancy']);
    const state = new FitnessState();
    expect(state.noteConstraints(heard)).toBe(true);
    expect(state.constraints.clearance).toEqual(['pregnancy']);
    expect(state.constraintsPayload().clearance).toEqual(['pregnancy']);
  });
});

describe('what the board and the avatar are told', () => {
  it('tells the board what was heard', () => {
    const state = new FitnessState();
    state.noteConstraints(parse('20 minutes, no equipment, bad knee'));
    const body = state.flowPayload().constraints;
    expect(body.minutes).toBe(20);
    expect(body.equipment).toBe('none');
    expect(body.injuries).toEqual(['knee']);
  });

  it('sends an empty body, not noise, when nothing was said', () => {
    expect(new FitnessState().flowPayload().constraints).toEqual({});
  });

  it('carries them in the snapshot too', () => {
    const state = new FitnessState();
    state.noteConstraints(parse('no equipment'));
    expect(state.snapshot().constraints).toEqual({ equipment: 'none' });
  });

  it('gives the avatar one short line, not the whole ban list', () => {
    const line = cons.summaryLine(parse('20 minutes, no equipment, bad knee'));
    expect(line).toBe('20 min cap · no equipment · working around knee');
    expect(line.length).toBeLessThan(120);
  });
});

describe('constraint-matching bugs', () => {
  it('keeps a press ban through pluralisation', () => {
    // `rstrip("s")` strips EVERY trailing s: "press" became "pre".
    for (const said of ['no press', 'no presses', 'avoid presses']) {
      const c = parse(said);
      expect(c.avoid, said).toContain('press');
      expect(cons.stepIsAllowed('Overhead press, 10 reps', c), said).toBe(false);
    }
  });

  it('bans an injured joint by its own name', () => {
    // The safe fallback warm-up for a bad shoulder was "Shoulder rolls".
    expect(cons.stepIsAllowed('Shoulder rolls, 30 seconds', parse("I've got a bad shoulder"))).toBe(false);
    expect(cons.stepIsAllowed('Ankle circles, 20 seconds each side', parse('sore ankle today'))).toBe(false);
  });

  it('bans the movements for an injury named by the tissue', () => {
    // Live: "I've got a torn ACL" matched nothing and the plan kept lunges.
    for (const said of ["I've got a torn ACL", 'my meniscus is shot', 'rotator cuff injury', 'herniated disc', 'achilles trouble']) {
      const c = parse(said);
      expect(c.injuries.length, said).toBeGreaterThan(0);
      expect(cons.hasAny(c), said).toBe(true);
    }
    const acl = parse("I've got a torn ACL");
    expect(cons.stepIsAllowed('Walking lunges, 10 each leg', acl)).toBe(false);
    expect(cons.stepIsAllowed('Jump squats, 12 reps', acl)).toBe(false);
  });

  it('does not fire a short injury name inside an ordinary word', () => {
    // "acl" is in "obstacle": someone training for an obstacle course lost
    // squats, lunges, jumping and running.
    for (const said of ['I am training for an obstacle course', 'it was a miracle', 'that was quite a spectacle']) {
      const c = parse(said);
      expect(c.injuries, said).toEqual([]);
      expect(cons.stepIsAllowed('Jump squats, 12 reps', c), said).toBe(true);
    }
    expect(parse('I have a torn ACL').injuries).toContain('knee');
  });

  it('does not let one ban swallow the next', () => {
    const c = parse('no equipment and no lunges');
    expect(c.avoid).toContain('lunge');
    expect(c.equipment).toBe('none');
    const both = parse('no squats and no burpees');
    expect(both.avoid).toEqual(expect.arrayContaining(['squat', 'burpee']));
    expect(parse('no press').avoid).toContain('press');
    expect(parse('no presses').avoid).toContain('press');
    expect(parse('no lunges today').avoid).toContain('lunge');
  });

  it('lands the forms people actually use', () => {
    // A trailing \b blocked "shin splints" and "patellar".
    expect(parse('shin splints are killing me').injuries).toContain('ankle');
    expect(parse('patellar tendonitis').injuries).toContain('knee');
    expect(parse('two fractures').clearance).toContain('a fracture');
    expect(parse('I had concussions').clearance).toContain('a recent concussion');
    expect(parse('broken ribs').clearance).toContain('a fracture');
  });

  it('keeps the false positives gone', () => {
    for (const said of ['training for an obstacle course', 'it was a miracle', 'a dizzying number of reps', 'thanks for the cooperation', 'my treadmill is broken']) {
      const c = parse(said);
      expect(c.injuries, said).toEqual([]);
      expect(c.clearance, said).toEqual([]);
    }
  });
});

describe('the clearance hold, as parsed', () => {
  it('escalates a condition no substitution fixes instead of adapting to it', () => {
    // Told "I'm 7 months pregnant", the original returned the identical six
    // moves, deadlifts included, and never suggested seeing anyone.
    const c = parse("I'm 7 months pregnant");
    expect(c.clearance).toContain('pregnancy');
    const line = cons.clearanceLine(c.clearance);
    expect(line).toContain('not able to program');
    expect(line).toContain('doctor');
    expect(line).toContain('professional');
    const summary = cons.summaryLine(c);
    expect(summary).toContain('professional');
    expect(summary.startsWith('SESSION ON HOLD')).toBe(true);
    for (const said of ['I had knee surgery last month', 'I get chest pain when I exert myself', 'I have a heart condition']) {
      expect(parse(said).clearance.length, said).toBeGreaterThan(0);
    }
  });

  it('holds for a condition however it is reported: a verb, a past tense, a plural', () => {
    // Bugbot: "I broke my wrist" and "I fractured my ankle" matched nothing, nor
    // did "surgeries": the page kept offering moves after the disclosure.
    const cases: [string, string][] = [
      ['I broke my wrist last month', 'a fracture'], ['I fractured my ankle in June', 'a fracture'], ['she broke her collarbone', 'a fracture'],
      ['I had two surgeries this year', 'recent surgery'], ["I've been having dizziness", 'dizziness'], ['two pregnancies, the last one in spring', 'pregnancy'],
      ['I just had a baby', 'recent childbirth'], ['I was concussed playing rugby', 'a recent concussion'], ['I have hypertension', 'high blood pressure'],
    ];
    for (const [said, label] of cases) expect(parse(said).clearance, said).toContain(label);
    for (const said of ['I broke my routine last week', 'I broke a sweat', 'my treadmill is broken', 'a faint smell of rubber']) {
      expect(parse(said).clearance, said).toEqual([]);
    }
  });

  it('does not freeze a session on ordinary sentences', () => {
    // A match halts everything with no way back, so a false positive costs
    // the whole workout. "cooperation" contains "operation"; "broken" is what
    // people say about treadmills and habits.
    for (const said of ['thanks for the cooperation', 'my treadmill is broken', 'I broke my routine last week', 'my operation at work runs late', 'that was a dizzying number of reps']) {
      expect(parse(said).clearance, said).toEqual([]);
    }
  });

  it('still freezes it for the real thing', () => {
    const cases: [string, string][] = [
      ['I had an operation last month', 'recent surgery'],
      ['I have a broken wrist', 'a fracture'],
      ["I'm 7 months pregnant", 'pregnancy'],
      ['I get chest pain when I exert myself', 'chest pain'],
      ['I feel dizzy when I stand up', 'dizziness'],
      ['I had a heart attack two years ago', 'a cardiac history'],
      ['I had surgery on my abdomen last month', 'recent surgery'],
    ];
    for (const [said, label] of cases) expect(parse(said).clearance, said).toContain(label);
  });

  it('freezes on the tense people actually use', () => {
    // "I fainted at the gym last week" matched nothing: the hold never armed.
    for (const said of ['I fainted at the gym last week', 'I fainted twice while running']) {
      expect(parse(said).clearance, said).toContain('fainting');
    }
  });

  it('names every condition in one sentence', () => {
    expect(cons.clearanceLine(['pregnancy', 'recent surgery'])).toContain('pregnancy and recent surgery');
    expect(cons.clearanceLine([])).toBe('');
  });
});

describe('acknowledging what was just said', () => {
  it('names what was just said, not everything ever heard', () => {
    const before = parse('only 20 minutes');
    const after = cons.mergeConstraints(before, parse('and my knee is bad'));
    const labels = cons.newConstraintLabels(before, after);
    expect(labels).toEqual(['your knee']);
    // The ban list an injury implies is not a recital.
    expect(labels.join(' ')).not.toContain('lunge');
  });

  it('says a banned move back as a person would, never "no presss" or "no jumpings"', () => {
    const labels = cons.newConstraintLabels(cons.EMPTY, parse('no press, no jumping, no lunges, no crunches and no high knees'));
    expect(labels).toEqual(expect.arrayContaining(['no presses', 'no jumping', 'no lunges', 'no crunches', 'no high knees']));
    for (const label of labels) expect(label, label).not.toMatch(/sss\b|ings\b|hs\b/);
  });

  it('never acknowledges a clearance condition as if it were built around', () => {
    expect(cons.newConstraintLabels(cons.EMPTY, parse("I'm pregnant"))).toEqual([]);
  });

  it('words the ack for a plan being rebuilt and for one still to come', () => {
    expect(cons.acknowledgementLine(['your knee'], true)).toBe("Noted on your knee — I'm rebuilding the plan around it now.");
    expect(cons.acknowledgementLine(['20 minutes', 'no equipment'], false)).toBe("Noted on 20 minutes and no equipment — I'll build the plan around it.");
    expect(cons.acknowledgementLine([], true)).toBe('');
  });
});

/**
 * The injury reader, as a table: each injury verb (broke, fractured, cracked,
 * dislocated, and their nouns) with the body parts it is said of, in every
 * shape people use, holds; the same words under a hedge ("nearly", "almost",
 * "never", "didn't", "isn't"), and the idioms and stretches, do not. A pause
 * has no way back, so a false hold costs the whole workout; a missed one
 * coaches someone with a fracture.
 */
describe('the injury reader: verb × part × shape × hedge', () => {
  const VERBS = [
    { past: 'broke', participle: 'broken', base: 'break', noun: 'break', parts: ['wrist', 'ankle', 'collarbone'], label: 'a fracture' },
    { past: 'fractured', participle: 'fractured', base: 'fracture', noun: 'fracture', parts: ['ankle', 'wrist', 'rib'], label: 'a fracture' },
    { past: 'cracked', participle: 'cracked', base: 'crack', noun: 'crack', parts: ['rib', 'wrist'], label: 'a fracture' },
    { past: 'dislocated', participle: 'dislocated', base: 'dislocate', noun: 'dislocation', parts: ['shoulder', 'knee'], label: 'a dislocation' },
  ];
  const holds: [string, string][] = [];
  const hedged: string[] = [];
  for (const v of VERBS) {
    for (const part of v.parts) {
      for (const said of [
        `I ${v.past} my ${part}`, `I ${v.past} my left ${part} last year`, `she ${v.past} her ${part}`,
        `my ${part} is ${v.participle}`, `my ${part} got ${v.participle}`, `my right ${part} was ${v.participle} in June`,
        `a ${v.participle} ${part}`, `a ${part} ${v.noun}`, `a ${v.noun} in my ${part}`,
      ]) holds.push([said, v.label]);
      hedged.push(
        `I nearly ${v.past} my ${part}`, `I almost ${v.past} my ${part}`, `I never ${v.past} my ${part}`,
        `I didn't ${v.base} my ${part}`, `my ${part} isn't ${v.participle}`, `my ${part} is not ${v.participle}`,
        `luckily my ${part} wasn't ${v.participle}`,
      );
    }
  }
  holds.push(
    ['two fractures', 'a fracture'], ['a stress fracture in my foot', 'a fracture'], ['broken ribs', 'a fracture'],
    ['I broke a bone in my hand', 'a fracture'], ['I fractured a vertebra', 'a fracture'], ['I cracked two ribs', 'a fracture'],
    ['a dislocation last year', 'a dislocation'], ['I fractured my back', 'a fracture'], ['I broke my wrist, it is a fracture', 'a fracture'],
    // A hedge elsewhere in the sentence does not cancel the report.
    ["I can't believe I broke my wrist", 'a fracture'], ['I never thought I would say it but I fractured my ankle', 'a fracture'],
    ['not sure it matters, I dislocated my shoulder', 'a dislocation'], ["I don't know how I cracked a rib", 'a fracture'],
  );
  hedged.push("I've never had a fracture", 'no dislocations so far', "nothing's broken, just bruised");
  const idioms = [
    'I cracked my back this morning', 'I cracked my neck', 'I crack my knuckles a lot', 'I cracked my knuckles', 'this is breaking my back',
    'my back is killing me', 'I broke a sweat', 'I broke my back moving furniture all weekend', 'that nearly broke my neck', 'break a leg',
    'it broke my heart', "I'm breaking in new shoes", 'my neck is cracking', 'my team feels fractured', 'a fractured relationship',
    'I felt dislocated after the move', 'my phone screen is cracked', 'I broke the record', 'it sounds like a broken record', 'I cracked the code',
    'I cracked my knee getting up', 'I crack my wrists before typing', 'the plan is broken', 'I need a break', 'I took a break in my workout',
    'I broke my routine last week', 'my treadmill is broken',
  ];

  it.each(holds)('holds: %s', (said, label) => expect(parse(said).clearance).toContain(label));
  it.each(hedged)('a hedge cancels it: %s', (said) => expect(parse(said).clearance).toEqual([]));
  it.each(idioms)('an idiom or a stretch does not hold: %s', (said) => expect(parse(said).clearance).toEqual([]));
});
