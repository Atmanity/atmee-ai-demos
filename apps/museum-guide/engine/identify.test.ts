import { describe, expect, it } from 'vitest';
import { EXHIBITS } from './catalogue.ts';
import { fromModel, IDENTIFY_SCHEMA, identifyPrompt } from './identify.ts';

describe('identifying a camera frame', () => {
  it('offers the model every work, and none', () => {
    const prompt = identifyPrompt('what is this?');
    for (const e of EXHIBITS) expect(prompt).toContain(`- ${e.id}:`);
    expect(prompt).toContain('asked: "what is this?"');
    expect(IDENTIFY_SCHEMA.properties.id.enum).toEqual([...EXHIBITS.map((e) => e.id), 'none']);
  });

  it('believes a confident pick of a catalogue work', () => {
    const r = fromModel({ id: 'great-wave', confidence: 'high', seen: 'a blue print of a wave' });
    expect(r.kind).toBe('found');
    expect(r.kind === 'found' && r.exhibit.title).toBe('The Great Wave off Kanagawa');
    expect(fromModel({ id: 'great-wave', confidence: 'medium', seen: '' }).kind).toBe('found');
  });

  it('does not believe a guess, a made-up id or a malformed answer', () => {
    expect(fromModel({ id: 'great-wave', confidence: 'low', seen: 'blurry blue' })).toEqual({ kind: 'unclear', seen: 'blurry blue' });
    expect(fromModel({ id: 'guernica', confidence: 'high', seen: 'x' }).kind).toBe('unclear');
    expect(fromModel({}).kind).toBe('unclear');
  });

  it('says when it is none of the works', () => {
    expect(fromModel({ id: 'none', confidence: 'high', seen: 'a fire extinguisher' })).toEqual({ kind: 'not_in_catalogue', seen: 'a fire extinguisher' });
    expect(fromModel({ id: 'none', confidence: 'low', seen: 'dark' }).kind).toBe('unclear');
  });
});
