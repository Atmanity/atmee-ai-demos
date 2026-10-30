import { describe, expect, it } from 'vitest';
import { EXHIBITS, exhibitById, findExhibit, recordText } from './catalogue.ts';

describe('the catalogue', () => {
  it('has unique ids, an image per work and a next work that exists', async () => {
    const { existsSync } = await import('node:fs');
    expect(new Set(EXHIBITS.map((e) => e.id)).size).toBe(EXHIBITS.length);
    for (const e of EXHIBITS) {
      expect(existsSync(`apps/museum-guide/exhibits/${e.id}.webp`), e.id).toBe(true);
      expect(exhibitById(e.next), `${e.id} -> ${e.next}`).not.toBeNull();
      expect(e.next).not.toBe(e.id);
    }
  });

  it.each([
    ['the Mona Lisa', 'mona-lisa'],
    ['La Gioconda', 'mona-lisa'],
    ['starry night', 'starry-night'],
    ['Van Gogh', 'starry-night'],
    ["Vermeer's girl", 'pearl-earring'],
    ['the girl with the pearl earring', 'pearl-earring'],
    ['the great wave', 'great-wave'],
    ['Hokusai', 'great-wave'],
    ['the night watch by Rembrandt', 'night-watch'],
    ['Klimt', 'the-kiss'],
    ['wanderer above the sea of fog', 'wanderer'],
    ['Botticelli Venus', 'birth-of-venus'],
    ['great-wave', 'great-wave'],
  ])('finds %s', (words, id) => {
    expect(findExhibit(words)?.id).toBe(id);
  });

  it.each(['the Sistine Chapel', 'Guernica', '', 'the painting'])('finds nothing for %j', (words) => {
    expect(findExhibit(words)).toBeNull();
  });

  it('gives Edmund the whole record, with where to go next', () => {
    const text = recordText(exhibitById('starry-night')!);
    expect(text).toContain('"The Starry Night" by Vincent van Gogh, June 1889');
    expect(text).toContain('Gallery 3');
    expect(text).toContain('Museum of Modern Art');
    expect(text).toContain('Suggested next: "The Kiss"');
  });
});

describe('the catalogue in other languages', () => {
  it('has every work in Traditional Chinese and Japanese, with every field filled', async () => {
    const { allIds, localize, translatedIds } = await import('./catalogue.i18n.ts');
    for (const lang of ['zh-TW', 'ja'] as const) {
      expect(translatedIds(lang)).toEqual(allIds());
      for (const e of EXHIBITS) {
        const t = localize(e, lang);
        for (const field of ['title', 'artist', 'date', 'medium', 'gallery', 'original'] as const) expect(t[field], `${lang} ${e.id} ${field}`).not.toBe(e[field]);
        expect(t.story.length, `${lang} ${e.id} story`).toBe(e.story.length);
        expect(t.lookFor.length, `${lang} ${e.id} lookFor`).toBe(e.lookFor.length);
        expect(t.next).toBe(e.next);
      }
    }
  });

  it('tells a guide to keep to the visitor\'s language, and says nothing for English', async () => {
    const { languageRule } = await import('./lang.ts');
    expect(languageRule('en')).toBeNull();
    expect(languageRule('zh-TW')).toMatch(/Traditional Chinese.*Speak only in it/);
    expect(languageRule('ja')).toMatch(/Japanese.*Speak only in it/);
  });
});
