/**
 * `VcsError.details` — the structured facts behind a refusal (`PLAN-M13.md` P12, `Q208` finding 6): a caller
 * turning `VCS-DIRTY-TREE` into its own message needs the file list as data, not parsed back out of prose
 * (a file can be named `a, b.txt`).
 *
 * @see specs/20 §20.2
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { VcsError } from '../src/errors.ts';
import { assertCleanWorkingTree } from '../src/git.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('VcsError.details', () => {
  it('is undefined when the error carries none', () => {
    expect(new VcsError({ code: 'X', message: 'm', remedy: 'Do it.' }).details).toBeUndefined();
  });

  it('carries the structured facts it was given', () => {
    const error = new VcsError({ code: 'X', message: 'm', remedy: 'Do it.', details: { n: 1 } });
    expect(error.details).toEqual({ n: 1 });
  });

  it('VCS-DIRTY-TREE carries every dirty file as data, including names that would break a comma split', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'forge-vcs-dirty-'));
    dirs.push(cwd);
    await execa('git', ['init', '--quiet'], { cwd });
    await writeFile(path.join(cwd, 'a, b.txt'), 'x');
    await writeFile(path.join(cwd, 'c.txt'), 'x');

    const error = await assertCleanWorkingTree(cwd).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VcsError);
    expect((error as VcsError).code).toBe('VCS-DIRTY-TREE');
    expect((error as VcsError).details).toEqual({ dirtyFiles: ['a, b.txt', 'c.txt'] });
  });
});
