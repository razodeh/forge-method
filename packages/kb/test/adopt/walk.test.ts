/** `walkRepository` — the single-pass walker every SURVEY/INVENTORY extractor shares. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { walkRepository } from '../../src/adopt/walk.ts';
import { populateFixture } from './fixtures.ts';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFixtureDir(
  prefix: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  await populateFixture(dir, files);
  return dir;
}

describe('walkRepository', () => {
  it('finds every real file, sorted, with POSIX-relative paths', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-walk-', {
      'b.txt': '',
      'a.txt': '',
      'nested/c.txt': '',
    });
    const files = await walkRepository(rootDir);
    expect(files.map((f) => f.relPath)).toEqual(['a.txt', 'b.txt', 'nested/c.txt']);
  });

  it('never descends into a default-ignored directory', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-walk-ignored-', {
      'node_modules/some-pkg/index.js': '',
      '.git/HEAD': '',
      'src/real.ts': '',
    });
    const files = await walkRepository(rootDir);
    expect(files.map((f) => f.relPath)).toEqual(['src/real.ts']);
  });

  it('respects a caller-supplied ignore set instead of the default', async () => {
    const rootDir = await makeFixtureDir('forge-kb-adopt-walk-custom-ignore-', {
      'keep/a.ts': '',
      'skip-me/b.ts': '',
    });
    const files = await walkRepository(rootDir, new Set(['skip-me']));
    expect(files.map((f) => f.relPath)).toEqual(['keep/a.ts']);
  });
});
