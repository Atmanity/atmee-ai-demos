import { describe, expect, it } from 'vitest';
import { buildFallbackPlan } from '../engine/plan.ts';
import { planFileName, planText } from './plan-text.ts';

describe('the plan to keep', () => {
  const plan = { ...buildFallbackPlan('Full body', 'Beginner'), plan_title: 'Full Body Foundations' };

  it('holds the moves, the limits they obey and who built it', () => {
    const text = planText(plan, { minutes: 20, injuries: ['knee'] }, 'Sammy', new Date('2026-10-23T12:00:00Z'));
    expect(text).toContain('FULL BODY FOUNDATIONS');
    expect(text).toContain('Full body · Beginner · 20 min');
    expect(text).toContain('Built around: 20 min cap · Working around: knee');
    expect(text).toContain(' 1. Bodyweight squats, 12 reps');
    expect(text).toContain('  - March in place, 30 seconds');
    expect(text).toContain('Built with Sammy on Spotter, 23 October 2026.');
  });

  it('leaves out what is empty, and never a paused condition', () => {
    const text = planText({ ...plan, coaching_cues: [] }, { clearance: ['pregnancy'] }, 'Sammy');
    expect(text).not.toContain('FORM CUES');
    expect(text).not.toContain('Built around');
    expect(text).not.toContain('pregnancy');
  });

  it('is named after the plan', () => {
    expect(planFileName(plan)).toBe('spotter-full-body-foundations.txt');
    expect(planFileName({ ...plan, plan_title: '!!!' })).toBe('spotter-plan.txt');
  });
});
