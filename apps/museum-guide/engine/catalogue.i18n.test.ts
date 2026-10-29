import { describe, expect, it } from 'vitest';
import { EXHIBITS, findExhibit } from './catalogue.ts';
import { localize } from './catalogue.i18n.ts';

describe('finding a work by the name Edmund says in the visitor\'s language', () => {
  // He uses the records' titles (the language rule tells him to), so show_exhibit gets them as spoken.
  it.each(['zh-TW', 'zh-CN', 'ja', 'ko', 'ru'] as const)('finds every work by its %s title', (lang) => {
    for (const e of EXHIBITS) expect(findExhibit(localize(e, lang).title)?.id, `${lang} ${localize(e, lang).title}`).toBe(e.id);
  });

  it('finds a work by its title inside a longer phrase', () => {
    expect(findExhibit('達文西的《蒙娜麗莎》')?.id).toBe('mona-lisa');
  });
});
