// The page bundle never contains the scenario content. Whatever page/App.tsx
// imports, directly or not, ships to the browser; scenarios.ts holds every
// step's label, and the label is the answer to the question on screen. So the
// content, the tutor and the judge stay server-side, and this walks the import
// graph to keep it that way.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_ONLY = ['engine/scenarios.ts', 'engine/tutor.ts', 'engine/judge.ts', 'engine/drill.ts', 'engine/assess.ts'].map((f) => resolve(here, '..', f));

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      if (/\.(css)$/.test(spec)) continue;
      stack.push(resolve(dirname(file), spec));
    }
  }
  return seen;
}

test('nothing the page imports reaches the scenario content', () => {
  const files = reachable(resolve(here, 'main.tsx'));
  expect(files.has(resolve(here, 'App.tsx'))).toBe(true);
  expect(files.has(resolve(here, '../engine/director.ts'))).toBe(true);   // the walk does follow engine imports
  for (const file of SERVER_ONLY) expect(files.has(file), file).toBe(false);
});
