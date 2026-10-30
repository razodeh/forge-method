/**
 * `resolvePackageRoot`/`walkUpForPackageJson`/`readPackageVersion` — locating and reading another
 * workspace package's own install directory, the way `@forge/diagrams/render/bundle.ts` already
 * does for `mermaid`.
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readOwnPackageVersion,
  readPackageVersion,
  resolveOwnPackageRoot,
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

// `resolveOwnPackageRoot`/`readOwnPackageVersion` were previously exercised only incidentally,
// through real CLI dispatch (`bin.test.ts`'s own real subprocess invocations, `dispatch/index.
// test.ts`'s real "--version" case, `commands/dispatch/shared.ts`'s real `modules/` roster
// resolution) -- never directly, by this file, the one dedicated to this module. That left this
// module's own per-file coverage entirely dependent on which OTHER files happened to run alongside
// it, confirmed concretely when `bin.test.ts` was isolated into its own CI job for this session's own
// "CI capacity" piece: a real, scoped sibling-only coverage run (the same technique `SPEC-QUESTIONS.md`
// Q365 Decision 3 used) measured this module dropping to 60% functions / 70% branches without it. These
// 2 direct tests close that gap at its real source instead, so this module's own floor no longer rides
// on a CLI-dispatch test file that exists for a different reason.
describe('resolveOwnPackageRoot', () => {
  it("finds this package's own real root, whose package.json really is named forge-method", () => {
    const root = resolveOwnPackageRoot(import.meta.url);
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      readonly name?: unknown;
    };
    expect(manifest.name).toBe('forge-method');
  });
});

describe('readOwnPackageVersion', () => {
  it("reads this package's own real version field", () => {
    expect(readOwnPackageVersion(import.meta.url)).toBe('0.0.0');
  });

  it('falls back to 0.0.0 when the real package.json has no (or a non-string) version field', async () => {
    const root = await tempDir();
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'forge-method', version: 123 }),
    );
    const nested = path.join(root, 'src', 'init');
    await mkdir(nested, { recursive: true });
    const fakeModuleUrl = pathToFileURL(path.join(nested, 'fake.ts')).toString();
    expect(readOwnPackageVersion(fakeModuleUrl)).toBe('0.0.0');
  });
});
