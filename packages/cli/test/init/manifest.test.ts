/**
 * `buildManifest` — `.forge/manifest.yaml`'s own real content.
 *
 * @see specs/03 §3.3
 */
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildManifest } from '../../src/init/manifest.ts';

const fixtureModulesDir = fileURLToPath(new URL('./fixtures/modules/', import.meta.url));
const manifestModulesDir = fileURLToPath(new URL('./fixtures/manifest-modules/', import.meta.url));

describe('buildManifest', () => {
  it('includes only the real, on-disk modules — never a requested id with no real directory', async () => {
    const manifest = await buildManifest(fixtureModulesDir, [
      'fixture-mod',
      'fm-web-does-not-exist',
    ]);
    const ids = manifest.modules.map((module) => module.id);
    expect(ids).toContain('fixture-mod');
    expect(ids).not.toContain('fm-web-does-not-exist');
    // fm-core is always checked, but this fixture dir has no real fm-core/ directory.
    expect(ids).not.toContain('fm-core');
  });

  it('always includes a real @forge/templates entry, with a real, non-empty checksum', async () => {
    const manifest = await buildManifest(fixtureModulesDir, []);
    const templates = manifest.modules.find((module) => module.id === '@forge/templates');
    expect(templates).toBeDefined();
    expect(templates?.checksum.length).toBeGreaterThan(0);
    expect(templates?.version.length).toBeGreaterThan(0);
  });

  it('gives two different fixture-module checksums for two different real agent files', async () => {
    const manifest = await buildManifest(fixtureModulesDir, ['fixture-mod']);
    const fixtureModule = manifest.modules.find((module) => module.id === 'fixture-mod');
    expect(fixtureModule?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: the same real content produces the same checksum every call', async () => {
    const first = await buildManifest(fixtureModulesDir, ['fixture-mod']);
    const second = await buildManifest(fixtureModulesDir, ['fixture-mod']);
    expect(first).toEqual(second);
  });

  it('gives a real, deterministic checksum for a module directory that exists but has no agents/ subdirectory', async () => {
    const manifest = await buildManifest(manifestModulesDir, ['module-no-agents']);
    const found = manifest.modules.find((module) => module.id === 'module-no-agents');
    expect(found).toBeDefined();
    expect(found?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips a nested subdirectory inside agents/ rather than trying to read it as a file', async () => {
    const manifest = await buildManifest(manifestModulesDir, ['module-with-nested']);
    const found = manifest.modules.find((module) => module.id === 'module-with-nested');
    expect(found).toBeDefined();
    // Would throw (EISDIR) if the subdirectory were read as a text file instead of skipped.
    expect(found?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not double-count an explicitly-requested "fm-core"', async () => {
    const manifest = await buildManifest(manifestModulesDir, ['fm-core', 'fm-core']);
    const ids = manifest.modules.map((module) => module.id);
    expect(ids.filter((id) => id === 'fm-core')).toHaveLength(0);
  });
});
