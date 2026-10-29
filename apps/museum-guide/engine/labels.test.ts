import { describe, expect, it } from 'vitest';
import { labelUrl, parseLabel } from './labels.ts';

describe('label codes', () => {
  it('round-trips a label link', () => {
    const url = labelUrl('https://atmee-demos.example/', 'night-watch');
    expect(url).toBe('https://atmee-demos.example/apps/museum-guide/?exhibit=night-watch');
    expect(parseLabel(url)?.id).toBe('night-watch');
  });

  it('reads a label printed from another host, and the short form', () => {
    expect(parseLabel('http://localhost:5190/apps/museum-guide/?exhibit=mona-lisa')?.id).toBe('mona-lisa');
    expect(parseLabel('http://localhost:5190/apps/museum-guide?exhibit=mona-lisa')?.id).toBe('mona-lisa');
    expect(parseLabel('  meridian:The-Kiss ')?.id).toBe('the-kiss');
  });

  it.each([
    'https://example.com/?exhibit=mona-lisa',
    'https://example.com/apps/museum-guide/?exhibit=guernica',
    'https://example.com/apps/museum-guide/',
    'javascript:alert(1)//apps/museum-guide/?exhibit=mona-lisa',
    'meridian:',
    'TICKET 0042',
  ])('is no label: %s', (text) => {
    expect(parseLabel(text)).toBeNull();
  });
});
