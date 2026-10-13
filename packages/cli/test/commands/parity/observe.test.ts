/**
 * `observeParityDeclaration` — P3's own observation engine (`PLAN-M16.md` P3, `13` F-TEST-9): given a
 * loaded declaration and a tree, runs each case's command for real and produces a raw, typed
 * observation per surface. Real subprocess fixtures and real git repositories throughout
 * (`QUALITY-BAR.md` R6): a mock is used nowhere in this file.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listOrphanedWorktrees, removeLaneWorktree } from '@forge/vcs';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { computeParityDeclarationDigest } from '../../../src/commands/parity/digest.ts';
import { observeParityDeclaration } from '../../../src/commands/parity/observe.ts';
import type { ParityDeclaration } from '../../../src/commands/parity/declaration-types.ts';
import type {
  ParityCaseResult,
  ParityDeclarationObservation,
} from '../../../src/commands/parity/observe-types.ts';
import { minimalDeclaration } from './fixtures.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-observe-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

/** A repository with two real commits, `marker.txt` differing between them -- shared by every test
 * (both the root-identity ones and the reference-side ones) that needs a real, resolvable
 * `reference.ref` distinct from the candidate's own current `HEAD`. */
async function repoWithTwoRevisions(): Promise<{
  readonly dir: string;
  readonly oldSha: string;
  readonly newSha: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-observe-ref-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, 'marker.txt'), 'OLD CONTENT', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'old'], { cwd: dir });
  const { stdout: oldSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  await writeFile(path.join(dir, 'marker.txt'), 'NEW CONTENT', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'new'], { cwd: dir });
  const { stdout: newSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return { dir, oldSha: oldSha.trim(), newSha: newSha.trim() };
}

function findCase(
  observation: ParityDeclarationObservation,
  surface: string,
  caseIndex = 0,
): ParityCaseResult['result'] {
  const found = observation.cases.find(
    (entry) => entry.surface === surface && entry.caseIndex === caseIndex,
  );
  if (found === undefined) throw new Error(`no case result for ${surface}[${String(caseIndex)}]`);
  return found.result;
}

describe('observeParityDeclaration: the process surface (specs/22 M16 P3)', () => {
  it('observes stdout, stderr and exit code exactly, byte for byte', async () => {
    const dir = await freshProject();
    const declaration: ParityDeclaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stdout.write('out-bytes'); process.stderr.write('err-bytes'); process.exitCode = 3;"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    const observation = outcome.observation;
    if (observation.surface !== 'process') throw new Error('expected process surface');
    expect(observation.stdout?.text).toBe('out-bytes');
    expect(observation.stderr?.text).toBe('err-bytes');
    expect(observation.exit).toEqual({ kind: 'code', code: 3 });
  });

  it('observes a signal-killed command as that signal, never a synthesized exit code', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.kill(process.pid, 'SIGTERM'); setTimeout(()=>{}, 5000);"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'process') throw new Error('expected process surface');
    expect(outcome.observation.exit).toEqual({ kind: 'signal', signal: 'SIGTERM' });
  });

  it('the pinned locale and timezone are observable, not the host machine’s own', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stdout.write(process.env.TZ + ' ' + process.env.LC_ALL + ' ' + process.env.LANG)"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: { ...process.env, TZ: 'America/New_York', LC_ALL: 'en_US.UTF-8' },
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'process') throw new Error('expected process surface');
    expect(outcome.observation.stdout?.text).toBe('UTC C.UTF-8 C.UTF-8');
  });

  it('a secret set in the PARENT process environment is not visible to the case, proven by actually setting one and echoing the real environment', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stdout.write(JSON.stringify(process.env))"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const parentEnv = { ...process.env, FORGE_P3_CANARY_SECRET: 'sk-canary-should-not-leak' };
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'process') throw new Error('expected process surface');
    expect(outcome.observation.stdout?.text).not.toContain('FORGE_P3_CANARY_SECRET');
    expect(outcome.observation.stdout?.text).not.toContain('sk-canary-should-not-leak');
  });

  it('a case exceeding its timeoutMs fails typed (RUN-118) and leaves no process behind, confirmed by a real pid liveness check', async () => {
    const dir = await freshProject();
    const markerPath = path.join(dir, 'grandchild.pid');
    const grandchildPath = path.join(dir, 'grandchild.cjs');
    const parentPath = path.join(dir, 'parent.cjs');
    await writeFile(
      grandchildPath,
      "require('node:fs').writeFileSync(process.argv[2], String(process.pid));\nfor (;;) { /* busy */ }\n",
      'utf8',
    );
    await writeFile(
      parentPath,
      "const { spawn } = require('node:child_process');\n" +
        "const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { detached: true, stdio: 'ignore' });\n" +
        'child.unref();\n' +
        'for (;;) { /* hangs; only the outer timeout -- never an early exit -- triggers the kill */ }\n',
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `node ${JSON.stringify(parentPath)} ${JSON.stringify(grandchildPath)} ${JSON.stringify(markerPath)}`,
          stability: { runs: 3 },
          cases: [{ timeoutMs: 1_200 }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-118');

    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    expect(Number.isInteger(pid)).toBe(true);
    try {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      expect(alive, `the detached grandchild pid ${String(pid)} must not survive the timeout`).toBe(
        false,
      );
    } finally {
      // A timing-sensitive assertion like the one above can flake under real host contention
      // (confirmed directly: a verify run on a genuinely busy host once found this exact marker
      // still alive, and nothing in the test went back to clean it up afterward, leaving a real,
      // CPU-burning orphan on the host indefinitely). Force-kill the marker regardless of the
      // assertion's own outcome, so a flake here is a red test, never a leaked process.
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone -- the common, expected case.
      }
    }
  }, 15_000);

  it('a case whose output exceeds its cap fails typed (RUN-119) and the observation is never returned as if it were complete', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stdout.write('x'.repeat(5_000_000))"`,
          stability: { runs: 3 },
          cases: [{ outputCapBytes: 1_000 }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-119');
  });

  it('a secret-bearing stdout is refused (RUN-121) before anything comparable is returned', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stdout.write('key: AKIAABCDEFGHIJKLMNOP')"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-121');
  });

  it('a lossy-UTF-8 stdout is refused (RUN-122) before anything comparable is returned', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stdout.write(Buffer.from([0x68,0x69,0xff,0xfe]))"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-122');
  });

  it('does not re-vet the composed line against the observed tree -- only P2’s load-time vet (against the project tree) ever decides refusal, so a command that was vetted fine at load but whose own target is absent in a DIFFERENT observed tree fails at runtime, never with a vet refusal', async () => {
    const dir = await freshProject();
    await writeFile(path.join(dir, 'present-at-head.txt'), 'hi', 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add file'], { cwd: dir });
    // A scratch "observed tree" that genuinely lacks the file the vetted command names -- modelling
    // the reference's own scratch worktree at an older ref without re-deriving worktree creation here.
    const otherTree = await mkdtemp(path.join(tmpdir(), 'forge-p3-othertree-'));
    dirs.push(otherTree);
    // A real repository of its own -- `takeTreeSnapshot` genuinely needs one; the point of this
    // test is that the COMMAND vet is never re-run here, not that git itself is skippable.
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: otherTree });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: otherTree });
    await execa('git', ['config', 'user.name', 't'], { cwd: otherTree });
    await writeFile(path.join(otherTree, '.gitkeep'), '', 'utf8');
    await execa('git', ['add', '-A'], { cwd: otherTree });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: otherTree });
    const declaration = minimalDeclaration({
      surfaces: {
        process: { run: 'cat present-at-head.txt', stability: { runs: 3 }, cases: [{}] },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: otherTree,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    // Not refused -- genuinely attempted and failed at runtime (a real `cat`, real nonzero exit),
    // because this module never calls `vetStoredCommand` a second time against `otherTree`.
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'process') throw new Error('expected process surface');
    expect(outcome.observation.exit).toEqual({ kind: 'code', code: 1 });
  });

  it('a secret-bearing STDERR is refused (RUN-121) exactly as stdout is', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stderr.write('key: AKIAABCDEFGHIJKLMNOP')"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-121');
  });

  it('a lossy-UTF-8 STDERR is refused (RUN-122) exactly as stdout is', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "process.stderr.write(Buffer.from([0x68,0x69,0xff,0xfe]))"`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-122');
  });

  it('a declared input whose overlay source does not exist under .forge/parity/ fails typed (RUN-128)', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "0"`,
          stability: { runs: 3 },
          cases: [{ inputs: [{ from: '.forge/parity/never-created.txt', to: 'in.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-128');
  });

  it('an overlay source that is a directory, not a file, also fails typed (RUN-128), never a raw unwrapped exception', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, '.forge', 'parity'), { recursive: true });
    await mkdir(path.join(dir, '.forge', 'parity', 'a-directory'), { recursive: true });
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "0"`,
          stability: { runs: 3 },
          cases: [{ inputs: [{ from: '.forge/parity/a-directory', to: 'in.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-128');
  });

  it('a declared input whose destination passes through an in-project symlink fails typed (RUN-125) end to end -- never silently observed as clean while the write actually leaked past the declared destination (round-2 critic finding)', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, '.forge', 'parity'), { recursive: true });
    await writeFile(path.join(dir, '.forge', 'parity', 'fixture.txt'), 'should not leak', 'utf8');
    await mkdir(path.join(dir, 'safe-dir'), { recursive: true });
    await symlink(path.join(dir, 'safe-dir'), path.join(dir, 'subdir'));
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `${process.execPath} -e "0"`,
          stability: { runs: 3 },
          cases: [{ inputs: [{ from: '.forge/parity/fixture.txt', to: 'subdir/leaked.txt' }] }],
        },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(observation, 'process');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-125');
    // Never landed at the symlink's real target either -- the write was refused before it happened,
    // not merely cleaned up (and silently swallowed) afterwards.
    await expect(readFile(path.join(dir, 'safe-dir', 'leaked.txt'), 'utf8')).rejects.toThrow();
  });

  it('a case that commits (changing HEAD mid-case) is unclean, not merely a file-level difference', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: {
          run: `git commit --quiet --allow-empty -m mid-case`,
          stability: { runs: 3 },
          cases: [{}],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'process');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    expect(outcome.clean).toBe(false);
  });
});

describe('observeParityDeclaration: the file surface (specs/22 M16 P3)', () => {
  it('observes a declared output file’s full bytes in text mode', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').mkdirSync('out',{recursive:true});require('node:fs').writeFileSync('out/result.txt','the real output\\n')"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'out/result.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    expect(outcome.observation.files).toEqual([
      {
        path: 'out/result.txt',
        content: {
          mode: 'text',
          bytes: Buffer.from('the real output\n'),
          text: 'the real output\n',
        },
      },
    ]);
  });

  it('observes only the sha256 of a bytes-mode output, never its content', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').writeFileSync('result.bin', Buffer.from([1,2,3,4]))"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'result.bin', mode: 'bytes' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    const { createHash } = await import('node:crypto');
    expect(outcome.observation.files).toEqual([
      {
        path: 'result.bin',
        content: {
          mode: 'bytes',
          sha256: createHash('sha256')
            .update(Buffer.from([1, 2, 3, 4]))
            .digest('hex'),
        },
      },
    ]);
  });

  it('a stale output file from a previous run cannot leak into the observation (the decoy-file test)', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, 'out'), { recursive: true });
    await writeFile(path.join(dir, 'out', 'result.txt'), 'DECOY FROM A PRIOR RUN', 'utf8');
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          // Touches nothing at all.
          run: `${process.execPath} -e "0"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'out/result.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    expect(outcome.observation.files).toEqual([
      { path: 'out/result.txt', content: { mode: 'absent' } },
    ]);
  });

  it('a declared input is overlaid before the case runs and removed after it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-observe-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await mkdir(path.join(dir, '.forge', 'parity', 'inputs'), { recursive: true });
    await writeFile(
      path.join(dir, '.forge', 'parity', 'inputs', 'fixture.txt'),
      'FIXTURE BYTES',
      'utf8',
    );
    await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });

    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').copyFileSync('overlay-in.txt','out.txt')"`,
          stability: { runs: 3 },
          cases: [
            {
              inputs: [{ from: '.forge/parity/inputs/fixture.txt', to: 'overlay-in.txt' }],
              outputs: [{ path: 'out.txt' }],
            },
          ],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    expect(outcome.observation.files[0]?.content).toEqual({
      mode: 'text',
      bytes: Buffer.from('FIXTURE BYTES'),
      text: 'FIXTURE BYTES',
    });
    // Removed after the case.
    await expect(readFile(path.join(dir, 'overlay-in.txt'), 'utf8')).rejects.toThrow();
  });

  it('a case that writes outside its declared outputs is unclean', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').writeFileSync('declared.txt','ok'); require('node:fs').writeFileSync('undeclared.txt','surprise')"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'declared.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    expect(outcome.clean).toBe(false);
  });

  it('a case that writes only its declared outputs is clean', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').writeFileSync('declared.txt','ok')"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'declared.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    expect(outcome.clean).toBe(true);
  });

  it('the candidate is observed in place, never through a copy: the case’s own command genuinely runs with the real project root as its cwd, not a copy nobody checks', async () => {
    const dir = await freshProject();
    const realDir = await realpath(dir);
    // The command reports its OWN `process.cwd()` back as a declared output -- the one piece of
    // ground truth that tells apart "ran in the real project root" from "ran in a copy of it
    // somewhere else": a copy's cwd would be a DIFFERENT real path, never `realDir`.
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').writeFileSync('cwd.txt', process.cwd())"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'cwd.txt' }] }],
        },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(observation, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    expect(outcome.observation.files[0]?.content).toMatchObject({ text: realDir });
    // Independently, a SEPARATE process started afresh, outside this piece entirely, still finds the
    // declared output cleaned away again at the real root (never left behind in some copy instead).
    await expect(readFile(path.join(dir, 'cwd.txt'), 'utf8')).rejects.toThrow();
  });

  it('refuses (RUN-125) a declared output path that passes through a symlink', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, 'real-target'), { recursive: true });
    await symlink(path.join(dir, 'real-target'), path.join(dir, 'link-dir'));
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "0"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'link-dir/result.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-125');
  });

  it('a declared output file whose own content is secret-bearing is refused (RUN-121) before anything comparable is returned', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').writeFileSync('result.txt','key: AKIAABCDEFGHIJKLMNOP')"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'result.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-121');
  });

  it('a declared output file whose own content is not valid UTF-8 (in text mode) is refused (RUN-122)', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').writeFileSync('result.txt', Buffer.from([0x68,0x69,0xff,0xfe]))"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'result.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-122');
  });
});

describe('observeParityDeclaration: the library surface (specs/22 M16 P3)', () => {
  async function projectWithProbe(
    probeSource: string,
  ): Promise<{ dir: string; probeRelative: string }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-p3-observe-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 't'], { cwd: dir });
    await mkdir(path.join(dir, '.forge', 'parity', 'probes'), { recursive: true });
    const probeRelative = '.forge/parity/probes/probe.mjs';
    await writeFile(path.join(dir, probeRelative), probeSource, 'utf8');
    await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    return { dir, probeRelative };
  }

  it('observes a well-formed {ok:true,value} probe result', async () => {
    const { dir, probeRelative } = await projectWithProbe(
      'console.log(JSON.stringify({ok:true,value:21*2}))',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        library: { run: `node ${probeRelative}`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'library');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'library') throw new Error('expected library surface');
    expect(outcome.observation.result).toEqual({ ok: true, value: 42 });
  });

  it('observes a well-formed {ok:false,error} probe result', async () => {
    const { dir, probeRelative } = await projectWithProbe(
      'console.log(JSON.stringify({ok:false,error:{name:"TypeError",message:"boom"}}))',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        library: { run: `node ${probeRelative}`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'library');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'library') throw new Error('expected library surface');
    expect(outcome.observation.result).toEqual({
      ok: false,
      error: { name: 'TypeError', message: 'boom' },
    });
  });

  it('a malformed probe stdout fails typed (RUN-123), never a guess at what the probe meant', async () => {
    const { dir, probeRelative } = await projectWithProbe('console.log("not json at all")');
    const declaration = minimalDeclaration({
      surfaces: {
        library: { run: `node ${probeRelative}`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'library');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-123');
  });

  it('a probe’s own byte change moves the declaration’s digest -- P2 and P3’s contracts actually compose', async () => {
    const { dir, probeRelative } = await projectWithProbe(
      'console.log(JSON.stringify({ok:true,value:1}))',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        library: { run: `node ${probeRelative}`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const probeBytesBefore = await readFile(path.join(dir, probeRelative));
    const digestBefore = computeParityDeclarationDigest(
      declaration,
      [],
      [{ path: probeRelative, bytes: probeBytesBefore }],
    );
    await writeFile(
      path.join(dir, probeRelative),
      'console.log(JSON.stringify({ok:true,value:2}))',
      'utf8',
    );
    const probeBytesAfter = await readFile(path.join(dir, probeRelative));
    const digestAfter = computeParityDeclarationDigest(
      declaration,
      [],
      [{ path: probeRelative, bytes: probeBytesAfter }],
    );
    expect(digestAfter).not.toBe(digestBefore);

    // And the OBSERVATION itself genuinely reflects the changed probe bytes, proving the two
    // pieces' contracts compose rather than merely asserting the digest changed in isolation.
    const results = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'library');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'library') throw new Error('expected library surface');
    expect(outcome.observation.result).toEqual({ ok: true, value: 2 });
  });
});

describe('observeParityDeclaration: refuses win32 outright rather than composing an unproven line (specs/22 M16 P3) (Q294/Q295)', () => {
  // No Windows host exists in this environment to prove a platform-conditional composition safe
  // (this piece's own DECISION, see its report) -- `process.platform` is faked here the one way
  // this codebase's own discipline allows a mock at all ("failure injection the OS will not give
  // you on demand"), restored in a `finally` so no other test ever sees the fake value.
  async function withFakePlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
    const real = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
      return await fn();
    } finally {
      if (real !== undefined) Object.defineProperty(process, 'platform', real);
    }
  }

  it('refuses typed (ENV-007) on win32, before any worktree is created or any process spawns', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    await withFakePlatform('win32', async () => {
      await expect(
        observeParityDeclaration({
          declaration,
          side: 'candidate',
          projectRoot: dir,
          parentEnv: process.env,
        }),
      ).rejects.toMatchObject({ code: 'ENV-007' });
    });
    // Nothing ran: the real project tree is exactly as it was (no worktree, no case output).
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });

  it('observes normally again once the fake platform is restored (the guard is real, not a permanent side effect)', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    expect(findCase(observation, 'process').outcome).toBe('observed');
  });
});

describe('observeParityDeclaration: the observed root, as given and resolved (specs/22 M16 P3)', () => {
  // P4's own always-on root-path normalisation step (`13` F-TEST-9's Normalisation bullet) needs
  // the exact pair this `root` field supplies; these tests prove it is the REAL pair, not merely a
  // string this piece happens to already have lying around.

  it('candidate side: root.asGiven is the literal projectRoot passed in, and root.real is its realpath, identical when projectRoot has no symlink in it', async () => {
    const dir = await freshProject();
    const declaration = minimalDeclaration({
      surfaces: {
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    expect(observation.root.asGiven).toBe(dir);
    expect(observation.root.real).toBe(await realpath(dir));
  });

  it('candidate side: root.real resolves a real symlink in projectRoot, never left as the symlinked path root.asGiven itself still is', async () => {
    const realDir = await freshProject();
    const linkDir = path.join(path.dirname(realDir), `${path.basename(realDir)}-link`);
    await symlink(realDir, linkDir);
    dirs.push(linkDir);
    const declaration = minimalDeclaration({
      surfaces: {
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: linkDir,
      parentEnv: process.env,
    });
    expect(observation.root.asGiven).toBe(linkDir);
    expect(observation.root.real).toBe(await realpath(realDir));
    expect(observation.root.real).not.toBe(observation.root.asGiven);
  });

  it('reference side: root.asGiven/root.real both name the scratch worktree’s own real path, which lane creation already resolves before building it', async () => {
    const { dir, oldSha: ref } = await repoWithTwoRevisions();
    const declaration = minimalDeclaration({
      reference: { ref },
      surfaces: {
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: ref,
      parentEnv: process.env,
    });
    expect(observation.root.real).toBe(observation.root.asGiven);
    expect(observation.root.asGiven).toContain(path.join('.forge', 'state', 'worktrees'));
    // The worktree is gone by the time this call returns -- `root` names where it WAS.
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  });
});

describe('observeParityDeclaration: the reference side (a scratch worktree) (specs/22 M16 P3)', () => {
  it('observes the reference at its OWN declared ref, not at the candidate’s current HEAD', async () => {
    const { dir, oldSha } = await repoWithTwoRevisions();
    const declaration = minimalDeclaration({
      reference: { ref: oldSha },
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').copyFileSync('marker.txt','out.txt')"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'out.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: oldSha,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    expect(outcome.observation.files[0]?.content).toMatchObject({ text: 'OLD CONTENT' });
    // The candidate's own real HEAD (and its own real marker.txt) are untouched by observing the
    // reference.
    const { stdout: headAfter } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    expect(headAfter.trim()).not.toBe(oldSha);
    await expect(readFile(path.join(dir, 'marker.txt'), 'utf8')).resolves.toBe('NEW CONTENT');
  });

  it('removes the scratch worktree after a case that throws (never leaves it behind)', async () => {
    const { dir } = await repoWithTwoRevisions();
    // A declared output path through a symlink makes `readDeclaredOutputContent` throw mid-case --
    // real, not simulated.
    await mkdir(path.join(dir, 'real'), { recursive: true });
    await symlink(path.join(dir, 'real'), path.join(dir, 'link'));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add symlink'], { cwd: dir });
    const { stdout: refWithLink } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    const declaration = minimalDeclaration({
      reference: { ref: refWithLink.trim() },
      surfaces: {
        file: {
          run: `${process.execPath} -e "0"`,
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'link/result.txt' }] }],
        },
      },
    });
    const beforeCount = (await listOrphanedWorktrees(dir)).length;
    await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: refWithLink.trim(),
      parentEnv: process.env,
    });
    expect((await listOrphanedWorktrees(dir)).length).toBe(beforeCount);
  });

  it('removes the scratch worktree created before a real SIGKILL mid-observation, via the real second-layer orphan sweep (the M15 binding-sigkill pattern)', async () => {
    const { dir } = await repoWithTwoRevisions();
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    const scriptDir = await mkdtemp(path.join(tmpdir(), 'forge-p3-observe-sigkill-script-'));
    dirs.push(scriptDir);
    const scriptPath = path.join(scriptDir, 'runner.mjs');
    const observeUrl = new URL('../../../src/commands/parity/observe.ts', import.meta.url).href;
    const declarationLiteral = JSON.stringify(
      minimalDeclaration({
        reference: { ref: headSha.trim() },
        surfaces: {
          process: {
            run: `${process.execPath} -e "setInterval(()=>{},1000)"`,
            stability: { runs: 3 },
            cases: [{ timeoutMs: 60_000 }],
          },
        },
      }),
    );
    await writeFile(
      scriptPath,
      `import { observeParityDeclaration } from ${JSON.stringify(observeUrl)};
console.log('STARTED');
await observeParityDeclaration({ declaration: ${declarationLiteral}, side: 'reference', projectRoot: ${JSON.stringify(dir)}, referenceSha: ${JSON.stringify(headSha.trim())}, parentEnv: process.env });
`,
      'utf8',
    );
    const { spawn } = await import('node:child_process');
    const child = spawn('node', ['--experimental-strip-types', scriptPath], { detached: true });
    const pid = child.pid;
    if (pid === undefined) throw new Error('failed to spawn');
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('STARTED')) resolve();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        reject(new Error(`exited early with code ${String(code)}`));
      });
    });
    // Give the worktree creation a moment to actually land before killing.
    await new Promise((resolve) => setTimeout(resolve, 800));
    process.kill(-pid, 'SIGKILL');
    await new Promise<void>((resolve) => {
      const check = (): void => {
        try {
          process.kill(pid, 0);
          setTimeout(check, 20);
        } catch {
          resolve();
        }
      };
      check();
    });
    const orphans = await listOrphanedWorktrees(dir);
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    for (const handle of orphans) {
      await removeLaneWorktree(dir, handle, { retain: false });
    }
    expect(await listOrphanedWorktrees(dir)).toEqual([]);
  }, 20_000);

  it('fails typed (RUN-124) when the scratch worktree itself cannot be created (a referenceSha that names no real commit)', async () => {
    const dir = await freshProject();
    const bogusSha = 'f'.repeat(40);
    const declaration = minimalDeclaration({
      reference: { ref: bogusSha },
      surfaces: {
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    await expect(
      observeParityDeclaration({
        declaration,
        side: 'reference',
        projectRoot: dir,
        referenceSha: bogusSha,
        parentEnv: process.env,
      }),
    ).rejects.toMatchObject({ code: 'RUN-124' });
  });

  it('runs a surface’s own setup before any of its cases, only on the reference side', async () => {
    const { dir, oldSha: ref } = await repoWithTwoRevisions();
    const declaration = minimalDeclaration({
      reference: { ref },
      surfaces: {
        file: {
          run: `${process.execPath} -e "require('node:fs').copyFileSync('built.txt','out.txt')"`,
          setup: [
            `${process.execPath} -e "require('node:fs').writeFileSync('built.txt','built by setup')"`,
          ],
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'out.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: ref,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'observed')
      throw new Error(`expected observed, got ${outcome.outcome}`);
    if (outcome.observation.surface !== 'file') throw new Error('expected file surface');
    expect(outcome.observation.files[0]?.content).toMatchObject({ text: 'built by setup' });
  });

  it('a setup command that exits non-zero fails every case of that surface typed (RUN-127), without aborting other surfaces', async () => {
    const { dir, oldSha: ref } = await repoWithTwoRevisions();
    const declaration = minimalDeclaration({
      reference: { ref },
      surfaces: {
        file: {
          run: `${process.execPath} -e "0"`,
          setup: ['false'],
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'out.txt' }] }, { outputs: [{ path: 'out2.txt' }] }],
        },
        process: { run: `${process.execPath} -e "0"`, stability: { runs: 3 }, cases: [{}] },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: ref,
      parentEnv: process.env,
    });
    const fileOutcome0 = findCase(results, 'file', 0);
    const fileOutcome1 = findCase(results, 'file', 1);
    if (fileOutcome0.outcome !== 'failed') throw new Error('expected failed');
    if (fileOutcome1.outcome !== 'failed') throw new Error('expected failed');
    expect(fileOutcome0.failure.error.code).toBe('RUN-127');
    expect(fileOutcome1.failure.error.code).toBe('RUN-127');
    // The unrelated `process` surface is unaffected by the `file` surface's own setup failure.
    const processOutcome = findCase(results, 'process');
    if (processOutcome.outcome !== 'observed') throw new Error('expected observed');
  });

  it('a setup command whose output exceeds its cap fails typed (RUN-127) naming the cap breach', async () => {
    const { dir, oldSha: ref } = await repoWithTwoRevisions();
    const declaration = minimalDeclaration({
      reference: { ref },
      surfaces: {
        file: {
          run: `${process.execPath} -e "0"`,
          setup: [`${process.execPath} -e "process.stdout.write('x'.repeat(50_000_000))"`],
          stability: { runs: 3 },
          cases: [{ outputs: [{ path: 'out.txt' }] }],
        },
      },
    });
    const results = await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: ref,
      parentEnv: process.env,
    });
    const outcome = findCase(results, 'file');
    if (outcome.outcome !== 'failed') throw new Error(`expected failed, got ${outcome.outcome}`);
    expect(outcome.failure.error.code).toBe('RUN-127');
  });
});

describe(
  'observeParityDeclaration (specs/22 M17 P14): the candidate-isolation exemption is keyed to ' +
    "whether THIS CASE'S OWN command references a .forge/parity/probes/ path, never to the " +
    'surface kind',
  () => {
    it(
      'a "process" surface (not "library") whose own run invokes a real, committed script at ' +
        '.forge/parity/probes/ is correctly exempted too -- a real regression a gauntlet round ' +
        "found and reproduced live: the ORIGINAL fix special-cased surfaceKind === 'library', " +
        'which broke this exact, spec-sanctioned pattern (13 F-TEST-9 defines library as "a ' +
        'process surface whose command is a reviewed probe script under .forge/parity/probes/", ' +
        'implying any process-shaped surface may use it) for every OTHER surface kind',
      async () => {
        const dir = await freshProject();
        await mkdir(path.join(dir, '.forge', 'parity', 'probes'), { recursive: true });
        await writeFile(
          path.join(dir, '.forge', 'parity', 'probes', 'process-helper.mjs'),
          "process.stdout.write('ok');\n",
          'utf8',
        );
        await execa('git', ['add', '-A'], { cwd: dir });
        await execa('git', ['commit', '--quiet', '-m', 'add probe script'], { cwd: dir });

        const declaration = minimalDeclaration({
          surfaces: {
            process: {
              run: `node .forge/parity/probes/process-helper.mjs`,
              stability: { runs: 1 },
              cases: [{}],
            },
          },
        });
        const results = await observeParityDeclaration({
          declaration,
          side: 'candidate',
          projectRoot: dir,
          parentEnv: process.env,
        });
        const outcome = findCase(results, 'process');
        // Before this fix: `ERR_MODULE_NOT_FOUND` (the exact failure class the original,
        // library-only exclusion existed to prevent, now hitting a surface it did not cover).
        if (outcome.outcome !== 'observed')
          throw new Error(`expected observed, got ${outcome.outcome}: ${JSON.stringify(outcome)}`);
        if (outcome.observation.surface !== 'process') throw new Error('expected process surface');
        expect(outcome.observation.stdout?.text).toBe('ok');
      },
    );
  },
);
