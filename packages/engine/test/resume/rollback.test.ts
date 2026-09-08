/**
 * `rollbackLaneToBase` — a thin wrapper over `@forge/vcs`'s own `resetLaneWorktree`; this test proves
 * the wiring is real (a real tmp-dir lane worktree actually gets reset), not that `resetLaneWorktree`
 * itself works (that's `packages/vcs/test/lanes.test.ts`'s own job).
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { createLaneWorktree } from '@forge/vcs';
import { describe, expect, it } from 'vitest';

import { rollbackLaneToBase } from '../../src/resume/rollback.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-resume-rollback-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('rollbackLaneToBase', () => {
  it('resets a real lane worktree back to the given commit, discarding uncommitted work', async () => {
    const cwd = await createTempRepo();
    const lane = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: lane.path });
    await writeFile(path.join(lane.path, 'crashed-session.txt'), 'never should have survived\n');

    await rollbackLaneToBase(lane, headSha.trim());

    await expect(readFile(path.join(lane.path, 'crashed-session.txt'), 'utf8')).rejects.toThrow();
  });
});
