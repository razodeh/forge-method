/**
 * `resolvePackageRoot`/`walkUpForPackageJson`/`readPackageVersion` — locating and reading another
 * workspace package's own install directory, the way `@forge/diagrams/render/bundle.ts` already
 * does for `mermaid`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readPackageVersion,
  resolvePackageRoot,
  walkUpForPackageJson,
} from '../../src/init/package-root.ts';

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-package-root-'));
  cleanupDirs.push(dir);
  return dir;
}

describe('resolvePackageRoot', () => {
  it('finds the real @forge/templates package root, whose own package.json really names it', () => {
    const root = resolvePackageRoot('@forge/templates');
    expect(root.endsWith(path.join('packages', 'templates'))).toBe(true);
  });

  it('finds the real @forge/agents package root too', () => {
    const root = resolvePackageRoot('@forge/agents');
    expect(root.endsWith(path.join('packages', 'agents'))).toBe(true);
  });
});

describe('walkUpForPackageJson', () => {
  it('returns the starting directory when its own package.json already matches', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@acme/x' }));
    expect(walkUpForPackageJson(dir, '@acme/x')).toBe(dir);
  });

  it('walks past a package.json that exists but names a different package', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@acme/x' }));
    const nested = path.join(root, 'src', 'deep');
    await mkdir(nested, { recursive: true });
    // A package.json at the nested level that names something else entirely — the walk must not
    // stop here just because *a* package.json exists.
    await writeFile(path.join(root, 'src', 'package.json'), JSON.stringify({ name: 'unrelated' }));
    expect(walkUpForPackageJson(nested, '@acme/x')).toBe(root);
  });

  it('walks past a directory with no package.json at all', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@acme/x' }));
    const nested = path.join(root, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    expect(walkUpForPackageJson(nested, '@acme/x')).toBe(root);
  });

  it('throws when no ancestor package.json ever names the target, all the way to the filesystem root', async () => {
    const dir = await tempDir();
    expect(() => walkUpForPackageJson(dir, '@acme/this-does-not-exist-anywhere')).toThrow();
  });
});

describe('readPackageVersion', () => {
  it('reads the real version field of a real installed package', () => {
    expect(readPackageVersion('@forge/templates')).toBe('0.0.0');
  });
});
