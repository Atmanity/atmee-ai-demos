import { describe, expect, it, vi } from 'vitest';
import { createAdvancer, EARLY_WORDS, MIN_ANSWERS, type AdvanceOptions, type Verdict } from './advance.ts';

function setup(verdicts: Verdict[], rundown = ['B', 'C']) {
  const left = [...rundown];
  const judged: string[] = [];
  const moved: string[] = [];
  const exhausted = vi.fn();
  let enabled = true;
  let release: (() => void) | null = null;
  const opts: AdvanceOptions = {
    judge: vi.fn(async (topic) => { judged.push(topic); return verdicts.shift() ?? { done: false, reason: '' }; }),
    next: () => left.shift() ?? null,
    move: (topic) => { moved.push(topic); advancer.topic(topic); },
    exhausted,
    enabled: () => enabled,
  };
  const advancer = createAdvancer(opts);
  const answer = async (n = 1) => { for (let i = 0; i < n; i++) { advancer.line({ who: 'host', text: 'q' }); advancer.line({ who: 'guest', text: 'a' }); await Promise.resolve(); await Promise.resolve(); } };
  return { advancer, opts, judged, moved, exhausted, answer, off: () => { enabled = false; }, release };
}

describe('auto-advance', () => {
  it(`asks the judge only once the topic has had ${MIN_ANSWERS} answers`, async () => {
    const s = setup([]);
    s.advancer.topic('A');
    await s.answer(MIN_ANSWERS - 1);
    expect(s.judged).toEqual([]);
    await s.answer();
    expect(s.judged).toEqual(['A']);
  });

  it('stays on the topic while the judge says it is still going', async () => {
    const s = setup([{ done: false, reason: '' }, { done: false, reason: '' }]);
    s.advancer.topic('A');
    await s.answer(3);
    expect(s.moved).toEqual([]);
  });

  it('moves to the next topic when the judge says it has run its course, and counts afresh', async () => {
    const s = setup([{ done: true, reason: 'covered' }]);
    s.advancer.topic('A');
    await s.answer(MIN_ANSWERS);
    expect(s.moved).toEqual(['B']);
    await s.answer(MIN_ANSWERS - 1);
    expect(s.judged).toEqual(['A']);
  });

  it("drops a verdict about a topic the producer replaced meanwhile", async () => {
    let finish!: (v: Verdict) => void;
    const s = setup([]);
    s.opts.judge = () => new Promise((r) => { finish = r; });
    s.advancer.topic('A');
    s.advancer.line({ who: 'guest', text: 'a' });
    s.advancer.line({ who: 'guest', text: 'a' });
    s.advancer.topic('Producer topic');
    finish({ done: true, reason: 'covered' });
    await Promise.resolve(); await Promise.resolve();
    expect(s.moved).toEqual([]);
  });

  it('tells the booth once when the rundown is used up', async () => {
    const s = setup([{ done: true, reason: '' }, { done: true, reason: '' }], []);
    s.advancer.topic('A');
    await s.answer(MIN_ANSWERS * 2);
    expect(s.moved).toEqual([]);
    expect(s.exhausted).toHaveBeenCalledOnce();
  });

  it('does nothing while it is off (auto-advance off, or the wrap asked for)', async () => {
    const s = setup([{ done: true, reason: '' }]);
    s.off();
    s.advancer.topic('A');
    await s.answer(MIN_ANSWERS * 2);
    expect(s.judged).toEqual([]);
  });

  it('keeps going when the judge fails', async () => {
    const s = setup([]);
    let calls = 0;
    s.opts.judge = async () => { calls++; if (calls === 1) throw new Error('model down'); return { done: true, reason: '' }; };
    s.advancer.topic('A');
    await s.answer(MIN_ANSWERS);
    expect(s.moved).toEqual([]);
    await s.answer();
    expect(s.moved).toEqual(['B']);
  });

  it(`judges mid-answer once the answer is ${EARLY_WORDS} words long, and not again when it ends`, async () => {
    const s = setup([{ done: true, reason: 'covered' }]);
    s.advancer.topic('A');
    await s.answer(MIN_ANSWERS - 1);
    const words = (n: number) => Array.from({ length: n }, () => 'silk').join(' ');
    s.advancer.hearing(words(EARLY_WORDS - 1));
    expect(s.judged).toEqual([]);
    s.advancer.hearing(words(EARLY_WORDS));
    await Promise.resolve(); await Promise.resolve();
    expect(s.judged).toEqual(['A']);
    expect(s.moved).toEqual(['B']);
    s.advancer.line({ who: 'guest', text: words(EARLY_WORDS + 5) });
    await Promise.resolve();
    expect(s.judged).toEqual(['A']);
  });

  it('does not judge mid-answer before the topic has had enough answers', async () => {
    const s = setup([]);
    s.advancer.topic('A');
    s.advancer.hearing(Array.from({ length: EARLY_WORDS }, () => 'silk').join(' '));
    await Promise.resolve();
    expect(s.judged).toEqual([]);
  });

  it("does not count a new guest's hello as an answer", async () => {
    const s = setup([]);
    s.advancer.topic('A', true);
    s.advancer.line({ who: 'guest', text: 'hello' });
    await s.answer(MIN_ANSWERS - 1);
    expect(s.judged).toEqual([]);
    await s.answer();
    expect(s.judged).toEqual(['A']);
  });
});
