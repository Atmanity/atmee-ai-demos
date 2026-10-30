import { describe, expect, test } from 'vitest';
import { contrast, DEFAULT_THEME, mix, themeFrom } from './theme.ts';

const good = { mood: 'sunlit disco strut', bg: '#1a0b2e', surface: '#26143f', ink: '#fdf3ff', dim: '#c8b3d9', accent: '#ff4fa3', glow: '#ffd23f', font: 'Righteous', backdrop: 'pulse' };

describe('a model\'s theme, made safe', () => {
  test('a good answer is kept as it is', () => {
    expect(themeFrom(good)).toEqual({ ...good });
  });

  test('a light background is darkened, and the text still reads on it', () => {
    const t = themeFrom({ ...good, bg: '#f4e9d8', ink: '#fafafa', dim: '#dddddd' });
    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(t.dim, t.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('text too dark for the background is lightened until it reads', () => {
    const t = themeFrom({ ...good, ink: '#3a3a3a', dim: '#222222', accent: '#300010' });
    expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(t.dim, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
  });

  test('bad colours, an unknown font or backdrop, and no answer fall back to the house look', () => {
    const t = themeFrom({ ...good, accent: 'pink', font: 'Comic Sans', backdrop: 'lasers', mood: ' ' });
    expect(t.font).toBe(DEFAULT_THEME.font);
    expect(t.backdrop).toBe(DEFAULT_THEME.backdrop);
    expect(t.mood).toBe(DEFAULT_THEME.mood);
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    expect(themeFrom(null)).toBe(DEFAULT_THEME);
  });

  test('mix moves a colour toward white or black', () => {
    expect(mix('#000000', 1)).toBe('#ffffff');
    expect(mix('#ffffff', -1)).toBe('#000000');
    expect(mix('#808080', 0)).toBe('#808080');
  });
});
