/**
 * `modules/fm-web/catalog/*.entry.yaml` (`PLAN-M10.md` P3, `19` §19.1's own "frontend catalog depth"
 * row) -- proves the two real entries this module ships load cleanly through `@forge/catalog`'s own
 * already-real `loadCatalogRegistry`/`catalogEntrySchema`, the identical mechanism
 * `packages/catalog/test/registry/load.test.ts` already exercises against its own fixtures. Not
 * re-listed in `module.yaml`'s own `provides.catalog` -- see that file's own header comment for why
 * (the same reasoning `modules/fm-core/module.yaml` already established for its own real catalog
 * non-ownership).
 *
 * @see specs/12 §12.2
 * @see PLAN-M10.md P3
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadCatalogRegistry } from '../../src/registry/load.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const fmWebCatalogDir = path.join(repoRoot, 'modules', 'fm-web', 'catalog');

describe('modules/fm-web/catalog — real, shipped content', () => {
  it('loads with zero issues', () => {
    const { issues } = loadCatalogRegistry(fmWebCatalogDir);
    expect(issues).toEqual([]);
  });

  it('tailwind (kind: frontend) loads with its own real fields', () => {
    const { registry } = loadCatalogRegistry(fmWebCatalogDir);
    const entry = registry.get('frontend', 'tailwind');
    expect(entry?.name).toBe('Tailwind CSS');
    expect(entry?.kind).toBe('frontend');
    expect(entry?.agent_friendliness).toBe('high');
  });

  it('axe-core (kind: testing) loads with its own real fields', () => {
    const { registry } = loadCatalogRegistry(fmWebCatalogDir);
    const entry = registry.get('testing', 'axe-core');
    expect(entry?.name).toBe('axe-core');
    expect(entry?.kind).toBe('testing');
    expect(entry?.pairs_with).toContain('playwright');
  });

  it('exactly the two real entries this module ships, no more and no fewer', () => {
    const { registry } = loadCatalogRegistry(fmWebCatalogDir);
    expect(registry.get('frontend', 'tailwind')).toBeDefined();
    expect(registry.get('testing', 'axe-core')).toBeDefined();
    // Neither entry collides with an existing id already shipped by @forge/catalog's own real,
    // stack-agnostic registry (the one this module's entries are meant to add depth to, not replace).
    expect(registry.get('frontend', 'react')).toBeUndefined();
  });
});
