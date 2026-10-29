import { describe, expect, it } from 'vitest';
import { EXHIBITS } from './catalogue.ts';
import { pins } from './floorplan.ts';
import { GUESTS } from './guests.ts';
import { LANGS } from './lang.ts';
import { TRANSLATIONS } from './translations.ts';
import { ENGLISH } from '../page/i18n.ts';

const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
const others = LANGS.filter((l) => l.id !== 'en').map((l) => l.id as Exclude<typeof l.id, 'en'>);

describe.each(others)('the tour in %s', (lang) => {
  const t = TRANSLATIONS[lang];

  it('has every screen string, with its {placeholders}', () => {
    expect(Object.keys(t.ui).sort()).toEqual(Object.keys(ENGLISH).sort());
    for (const [key, english] of Object.entries(ENGLISH)) {
      expect(t.ui[key].trim(), key).not.toBe('');
      expect(holes(t.ui[key]), key).toBe(holes(english));
    }
  });

  it('has every work, every field, and the story and things to look for line for line', () => {
    expect(Object.keys(t.works).sort()).toEqual(EXHIBITS.map((e) => e.id).sort());
    for (const e of EXHIBITS) {
      const w = t.works[e.id];
      for (const field of ['title', 'artist', 'date', 'medium', 'gallery', 'original'] as const) expect(w[field].trim(), `${e.id}.${field}`).not.toBe('');
      expect(w.story.length, `${e.id}.story`).toBe(e.story.length);
      expect(w.lookFor.length, `${e.id}.lookFor`).toBe(e.lookFor.length);
    }
  });

  it('has the floor plan, the guests and the names', () => {
    for (const n of ['1', '2', '3', '4']) expect(t.rooms[n].length, `room ${n}`).toBeGreaterThanOrEqual(1);
    for (const n of ['1', '2', '3', '4']) expect(t.rooms[n].length, `room ${n}`).toBeLessThanOrEqual(2);
    expect(Object.keys(t.pins).sort()).toEqual(EXHIBITS.map((e) => e.id).sort());
    for (const g of GUESTS) expect(t.guests[g.id].name && t.guests[g.id].meet, g.id).toBeTruthy();
    for (const v of Object.values(t.names)) expect(v.trim()).not.toBe('');
  });

  it('keeps every pin label clear of its neighbours on the floor plan', () => {
    // 8-unit text: about 4.6 units for a Latin or Cyrillic letter, 8 for a Chinese, Japanese or Korean character.
    const width = (s: string) => [...s].reduce((w, c) => w + (/[ᄀ-ᇿ぀-ヿ㐀-鿿가-힯＀-￯]/.test(c) ? 8 : 4.6), 0);
    const all = pins();
    for (const a of all) for (const b of all) {
      if (a === b || a.y !== b.y) continue;
      expect((width(t.pins[a.exhibit.id]) + width(t.pins[b.exhibit.id])) / 2 + 4, `${t.pins[a.exhibit.id]} / ${t.pins[b.exhibit.id]}`).toBeLessThan(Math.abs(a.x - b.x));
    }
  });
});

describe('the browser\'s language', () => {
  it('picks the tour\'s language by script or region for Chinese, by the first part for the rest', async () => {
    const { browserLang } = await import('../page/i18n.ts');
    expect(browserLang('zh-TW')).toBe('zh-TW');
    expect(browserLang('zh-HK')).toBe('zh-TW');
    expect(browserLang('zh-Hant-TW')).toBe('zh-TW');
    expect(browserLang('zh-CN')).toBe('zh-CN');
    expect(browserLang('zh')).toBe('zh-CN');
    expect(browserLang('de-AT')).toBe('de');
    expect(browserLang('es-419')).toBe('es');
    expect(browserLang('ko-KR')).toBe('ko');
    expect(browserLang('pt-BR')).toBe('en');
  });
});
