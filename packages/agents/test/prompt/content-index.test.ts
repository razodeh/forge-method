/**
 * `BRIEF_INDEX`/`PROMPT_INDEX` (`@forge/templates`) invariants — `PLAN-M13.md` P1.
 *
 * Unlike the closed-union indexes (`WORKFLOW_INDEX`, `TEMPLATE_INDEX`, ...), these two are open
 * `Record<string, string>` maps that `PLAN-M13.md` P2/P3 grow entry by entry, so nothing in the type
 * system stops a bad entry. `forge init` (`readIndexed`) flattens each entry to its own basename under
 * `.forge/briefs/` or `.forge/prompts/`, and both validators and the loader accept only
 * `<kind>/<basename>.md` — so an entry whose key, path or basename disagrees would silently write a
 * file no reference can ever resolve. Vacuously true while both indexes are empty (P1's disclosed,
 * temporary state, `SPEC-QUESTIONS.md` Q197); it starts protecting the moment P2/P3 land content.
 *
 * Lives in `@forge/agents` because it needs both `@forge/templates` and this package's own
 * reference predicate, and `templates` may import no `@forge/*` package (`02` §2.2).
 *
 * @see specs/22 M13
 * @see PLAN-M13.md P1
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BRIEF_INDEX, PROMPT_INDEX } from '@forge/templates';

import { isWellFormedContentReference } from '../../src/prompt/index.ts';

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'templates',
);

describe.each([
  ['briefs', BRIEF_INDEX],
  ['prompts', PROMPT_INDEX],
] as const)('%s index', (kind, index) => {
  it('maps each key to templates/<kind>/<key>.md, a real, non-empty file', () => {
    for (const [key, relPath] of Object.entries(index)) {
      expect(key, 'key must be a single path segment').not.toMatch(/[/\\]/);
      expect(relPath).toBe(`templates/${kind}/${key}.md`);
      const abs = path.join(templatesRoot, relPath);
      expect(existsSync(abs), `${relPath} must exist`).toBe(true);
      expect(
        readFileSync(abs, 'utf8').trim().length,
        `${relPath} must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('flattens to unique, resolvable <kind>/<basename>.md references', () => {
    const refs = Object.values(index).map((relPath) => `${kind}/${path.basename(relPath)}`);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) expect(isWellFormedContentReference(ref), ref).toBe(true);
  });

  it('has no file under templates/<kind>/ that the index does not name', () => {
    const dir = path.join(templatesRoot, 'templates', kind);
    if (!existsSync(dir)) return;
    const named = new Set(Object.values(index).map((relPath) => path.basename(relPath)));
    for (const file of readdirSyncMd(dir))
      expect(named.has(file), `${kind}/${file} is unindexed`).toBe(true);
  });
});

function readdirSyncMd(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
}
