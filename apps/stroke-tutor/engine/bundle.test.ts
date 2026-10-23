// The reference strokes must never reach the browser: a page that ships them
// lets a curious learner read every answer in devtools, and the drill becomes
// tracing. The page may import the shared types, the director and the judge
// (the safety net's phrases), which import only types; nothing that holds or
// grades the characters.
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ONLY = ['engine/characters.ts', 'engine/strokes.ts', 'engine/tutor.ts', 'engine/lesson.ts', 'engine/strokes.parity.json', 'server.ts'];

/** Every file of this app the page loads, following value imports (an `import type` is erased). */
function pageFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(ts|tsx)$/.test(file)) return;
    const source = readFileSync(join(app, file), 'utf8');
    for (const match of source.matchAll(/^import\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      const [, typeOnly, spec] = match;
      if (typeOnly || !spec.startsWith('.')) continue;
      const target = normalize(join(dirname(file), spec));
      if (target.startsWith('..')) continue;   // the shared kit, outside this app
      visit(target);
    }
  };
  visit(entry);
  return seen;
}

test('the page never loads a module that holds the reference strokes', () => {
  const loaded = pageFiles('page/main.tsx');
  expect(loaded.has('page/App.tsx')).toBe(true);
  expect(loaded.has('engine/director.ts')).toBe(true);
  for (const file of SERVER_ONLY) expect(loaded.has(file), file).toBe(false);
});

test('the director and the judge, which the page loads, import nothing but types', () => {
  const loaded = pageFiles('page/main.tsx');
  for (const file of ['engine/director.ts', 'engine/judge.ts']) {
    expect(loaded.has(file), file).toBe(true);
    const source = readFileSync(join(app, file), 'utf8');
    const imports = [...source.matchAll(/^import\s+(.*)$/gm)].map((m) => m[1]);
    expect(imports.length, file).toBeGreaterThan(0);
    for (const line of imports) expect(line, file).toMatch(/^type\s|^\{\s*[^}]*\}\s+from\s+'\.\/types\.ts'/);
  }
});
