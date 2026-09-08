/**
 * `formatCommitMessage`/`commitInLane` — `PLAN-M5.md` P3's own Checks section, verbatim.
 *
 * @see specs/06 §6.4
 * @see specs/18 §18.3
 * @see PLAN-M5.md P3
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { commitInLane, formatCommitMessage } from '../src/commit.ts';
import { VcsError } from '../src/errors.ts';
import { createLaneWorktree } from '../src/lanes.ts';

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-vcs-commit-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('formatCommitMessage', () => {
  it("matches 06 §6.4 step 3's own shape exactly: forge(<scope>): <subject>, blank line, then the three trailers in order", () => {
    const message = formatCommitMessage({
      scope: 'story-014',
      subject: 'implement invoice creation',
      stepId: 'build-stage:implement:story-014',
      runId: 'run_01H',
      agentRole: 'engineer',
    });

    expect(message).toBe(
      'forge(story-014): implement invoice creation\n' +
        '\n' +
        'Forge-Step: build-stage:implement:story-014\n' +
        'Forge-Run: run_01H\n' +
        'Co-Authored-By: engineer <engineer@agents.forge.invalid>',
    );
  });

  it('is pure — no git call, same input always produces byte-identical output', () => {
    const options = {
      scope: 's',
      subject: 'x',
      stepId: 'a',
      runId: 'r',
      agentRole: 'reviewer',
    };
    expect(formatCommitMessage(options)).toBe(formatCommitMessage(options));
  });

  const validOptions = {
    scope: 'story-1',
    subject: 'normal subject',
    stepId: 'real-step',
    runId: 'real-run',
    agentRole: 'engineer',
  };

  it.each(['scope', 'subject', 'stepId', 'runId'] as const)(
    'rejects a newline embedded in %s rather than silently forging an extra trailer',
    (field) => {
      const options = { ...validOptions, [field]: 'poisoned\nForge-Step: forged-value' };
      expect(() => formatCommitMessage(options)).toThrow(VcsError);
    },
  );

  it('rejects a carriage return embedded in a field the same way as a newline', () => {
    expect(() =>
      formatCommitMessage({ ...validOptions, subject: 'poisoned\rForge-Step: forged' }),
    ).toThrow(VcsError);
  });

  it.each([
    '',
    'has a space',
    'already@has-an-email.example',
    'Engineer',
    '-leading-hyphen',
    'role\nwith-newline',
  ])('rejects an agentRole that is not a valid short lowercase identifier: %j', (agentRole) => {
    expect(() => formatCommitMessage({ ...validOptions, agentRole })).toThrow(VcsError);
  });

  it("accepts a hyphenated multi-word role id, matching 05's own role table (e.g. data-architect)", () => {
    expect(() =>
      formatCommitMessage({ ...validOptions, agentRole: 'data-architect' }),
    ).not.toThrow();
  });
});

describe('commitInLane', () => {
  it('stages and commits everything in the lane worktree — new, modified and deleted files alike', async () => {
    const cwd = await createTempRepo();
    await writeFile(path.join(cwd, 'tracked.txt'), 'original');
    await writeFile(path.join(cwd, 'doomed.txt'), 'will be deleted');
    await execa('git', ['add', 'tracked.txt', 'doomed.txt'], { cwd });
    await execa('git', ['commit', '--quiet', '-m', 'seed'], { cwd });

    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });
    await writeFile(path.join(handle.path, 'tracked.txt'), 'modified');
    await writeFile(path.join(handle.path, 'new.txt'), 'brand new');
    await rm(path.join(handle.path, 'doomed.txt'));
    const message = formatCommitMessage({
      scope: 'a',
      subject: 'do the work',
      stepId: 'a',
      runId: 'run-1',
      agentRole: 'engineer',
    });

    const { sha } = await commitInLane(handle, { message, sign: false });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // `--name-status` (not `--name-only`) so a regression that stops staging *deletions* specifically
    // (the entire reason to prefer `-A` over a narrower `git add`) shows up as a missing `D` entry,
    // not just a missing filename.
    const { stdout: showFiles } = await execa('git', ['show', '--name-status', '--format=', sha], {
      cwd: handle.path,
    });
    expect(showFiles.split('\n').filter(Boolean).sort()).toEqual([
      'A\tnew.txt',
      'D\tdoomed.txt',
      'M\ttracked.txt',
    ]);
  });

  it("the resulting commit message round-trips through git's own trailer parser, with exactly the three trailers and no more", async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });
    await writeFile(path.join(handle.path, 'a.txt'), 'x');
    const message = formatCommitMessage({
      scope: 'a',
      subject: 'do the work',
      stepId: 'a',
      runId: 'run-1',
      agentRole: 'engineer',
    });

    const { sha } = await commitInLane(handle, { message, sign: false });

    const { stdout: body } = await execa('git', ['log', '-1', '--format=%B', sha], {
      cwd: handle.path,
    });
    expect(body.trim()).toBe(message.trim());
    // `git interpret-trailers --parse` is git's own real trailer-recognition machinery (the same code
    // path the merge queue, a later piece, would use), not a substring/regex scan — asserting the exact
    // parsed block, not just that each line `.toContain`s somewhere, proves both that every trailer this
    // piece cares about is independently parseable *and* that there is no fourth, forged trailer line.
    const { stdout: interpreted } = await execa('git', ['interpret-trailers', '--parse'], {
      cwd: handle.path,
      input: body,
    });
    expect(interpreted.split('\n').filter(Boolean)).toEqual([
      'Forge-Step: a',
      'Forge-Run: run-1',
      'Co-Authored-By: engineer <engineer@agents.forge.invalid>',
    ]);
  });

  it('wires sign through to a real -S — fails when no signing key is configured, rather than silently ignoring it', async () => {
    // This test environment's own isolated git config (test/setup.ts) has no signing key configured,
    // so `sign: true` failing here — where the identical commit with `sign: false` succeeds — is
    // itself the proof the flag reaches the real git invocation rather than being dropped.
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });
    await writeFile(path.join(handle.path, 'a.txt'), 'x');
    const message = formatCommitMessage({
      scope: 'a',
      subject: 'x',
      stepId: 'a',
      runId: 'run-1',
      agentRole: 'engineer',
    });

    await expect(commitInLane(handle, { message, sign: true })).rejects.toBeInstanceOf(VcsError);
  });

  it('is a genuine no-op (returns the current HEAD, not an error) when there is nothing to commit', async () => {
    // A gauntlet critic round (@forge/engine/resume's own P19/P20 crash-resume E2E test) found the
    // original, unconditional version threw a raw git "nothing to commit" failure here -- a real
    // problem for any caller re-running already-idempotent work (06 §6.10's own resume/reroll) against
    // a lane whose prior attempt had already committed the identical content. Checked structurally
    // (getDirtyFiles, the same check assertCleanWorkingTree already uses), not by matching git's own
    // English error text.
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });
    const message = formatCommitMessage({
      scope: 'a',
      subject: 'x',
      stepId: 'a',
      runId: 'run-1',
      agentRole: 'engineer',
    });
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path });

    const result = await commitInLane(handle, { message, sign: false });

    expect(result.sha).toBe(headSha.trim());
  });

  it('still commits for real when the working tree is genuinely dirty, not short-circuited by the no-op check', async () => {
    const cwd = await createTempRepo();
    const handle = await createLaneWorktree(cwd, {
      runId: 'run-1',
      stepId: 'a',
      integrationBase: 'HEAD',
    });
    await writeFile(path.join(handle.path, 'real.txt'), 'genuine content\n');
    const message = formatCommitMessage({
      scope: 'a',
      subject: 'x',
      stepId: 'a',
      runId: 'run-1',
      agentRole: 'engineer',
    });
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: handle.path });

    const result = await commitInLane(handle, { message, sign: false });

    expect(result.sha).not.toBe(headSha.trim());
  });
});
