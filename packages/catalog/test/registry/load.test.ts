/**
 * `loadCatalogRegistry` — `PLAN-M6.md` C1's own Checks section.
 *
 * @see specs/12 §12.2
 * @see PLAN-M6.md C1
 */
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCatalogRegistry } from '../../src/registry/load.ts';
import { POSTGRESQL } from '../fixtures/postgresql.ts';

async function makeCatalogDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-catalog-load-'));
}

describe('loadCatalogRegistry', () => {
  it('reads every <dir>/<kind>/<id>.entry.yaml into the registry', async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);

    const { registry, issues } = loadCatalogRegistry(dir);

    expect(issues).toEqual([]);
    expect(registry.get('datastore', 'postgresql')?.name).toBe('PostgreSQL');
  });

  it('reads entries from more than one kind directory', async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore'), { recursive: true });
    await mkdir(path.join(dir, 'language'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);
    const language = POSTGRESQL.replace('id: postgresql', 'id: typescript')
      .replace('kind: datastore', 'kind: language')
      .replace('name: PostgreSQL', 'name: TypeScript');
    await writeFile(path.join(dir, 'language', 'typescript.entry.yaml'), language);

    const { registry } = loadCatalogRegistry(dir);

    expect(registry.all()).toHaveLength(2);
    expect(registry.get('language', 'typescript')?.name).toBe('TypeScript');
  });

  it('ignores a non-.entry.yaml file in a kind directory', async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);
    await writeFile(path.join(dir, 'datastore', 'README.md'), '# not a catalog entry');

    const { registry } = loadCatalogRegistry(dir);

    expect(registry.all()).toHaveLength(1);
  });

  it('ignores a non-directory entry at the top level of the catalog dir', async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);
    await writeFile(path.join(dir, 'README.md'), '# not a kind directory');

    const { registry, issues } = loadCatalogRegistry(dir);

    expect(registry.all()).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it('ignores a subdirectory nested inside a kind directory', async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore', 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);

    const { registry, issues } = loadCatalogRegistry(dir);

    expect(registry.all()).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it('collects an issue for a malformed entry, named by its own relative path, rather than aborting the whole load', async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);
    await writeFile(
      path.join(dir, 'datastore', 'broken.entry.yaml'),
      POSTGRESQL.replace('kind: datastore', 'kind: not-a-real-kind').replace(
        'id: postgresql',
        'id: broken',
      ),
    );

    const { registry, issues } = loadCatalogRegistry(dir);

    expect(registry.get('datastore', 'postgresql')).toBeDefined();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toContain('datastore/broken.entry.yaml');
  });

  it("collects an issue when an entry's own kind field does not match its directory", async () => {
    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'framework'), { recursive: true });
    await writeFile(path.join(dir, 'framework', 'postgresql.entry.yaml'), POSTGRESQL);

    const { registry, issues } = loadCatalogRegistry(dir);

    expect(registry.get('framework', 'postgresql')).toBeUndefined();
    expect(issues.some((issue) => issue.message.includes('does not match its directory'))).toBe(
      true,
    );
  });

  it('a directory that does not exist yields an empty registry, no thrown error', () => {
    const { registry, issues } = loadCatalogRegistry('/nonexistent/forge-catalog-dir');
    expect(registry.all()).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('a kind directory that cannot be read (e.g. permission-denied) is skipped, not a thrown error', async () => {
    if (process.getuid?.() === 0) return; // root ignores directory permissions; nothing to prove here.

    const dir = await makeCatalogDir();
    await mkdir(path.join(dir, 'datastore'), { recursive: true });
    await writeFile(path.join(dir, 'datastore', 'postgresql.entry.yaml'), POSTGRESQL);
    const unreadable = path.join(dir, 'language');
    await mkdir(unreadable, { recursive: true });
    await chmod(unreadable, 0o000);

    try {
      const { registry } = loadCatalogRegistry(dir);
      expect(registry.all()).toHaveLength(1);
      expect(registry.get('datastore', 'postgresql')).toBeDefined();
    } finally {
      await chmod(unreadable, 0o755);
    }
  });
});
