/**
 * `runTranslatorProof` — a real `SIGKILL`, never a simulated crash, between the probe being written
 * and this function's own `finally` cleanup: a fresh critic round's own repro, confirming the gap
 * `proof.ts`'s own doc comment names ("there is no way to run cleanup code during an unstoppable
 * kill itself") and the fix (`reclaimStaleProbe`, read back by the NEXT invocation) actually closes
 * it end to end, the identical real-process-kill pattern `binding-sigkill.test.ts`/
 * `hunk-mutation-sigkill.test.ts` already establish for the comparable git-worktree case.
 *
 * @see specs/22 M17 P6
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../../../scripts/lib/node-ts-flag.mjs';
import { runTranslatorProof } from '../../../../src/commands/loop/test/proof.ts';

const FIXTURE_CHILD_PATH = fileURLToPath(
  new URL('./fixtures/proof-sigkill-child.ts', import.meta.url),
);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-proof-sigkill-'));
  dirs.push(dir);
  return dir;
}

/** Spawns the real fixture child (detached, its own process group), waits for its own `STARTED`
 * line, then `SIGKILL`s the WHOLE GROUP after a short, fixed delay -- the fixture's own configured
 * command sleeps 5 real seconds, a wide enough margin that two small, fsync'd file writes (the lock,
 * then the probe) are always long done well before this delay elapses, on any real machine. A
 * process-GROUP kill, not a bare `child.kill()`: `runTranslatorProof` itself spawns a further real
 * shell subprocess for the configured `run` command, which a single-pid kill would orphan (the
 * identical real bug `binding-sigkill.test.ts`'s own doc comment names, `SPEC-QUESTIONS.md` Q149). */
async function spawnAndKill(projectRoot: string, probeRelPath: string): Promise<void> {
  const child = spawn(
    process.execPath,
    [TS_NODE_FLAG, FIXTURE_CHILD_PATH, projectRoot, probeRelPath],
    { detached: true },
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error('fixture child failed to spawn (no pid)');

  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('STARTED')) resolve();
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      reject(
        new Error(
          `fixture child exited before STARTED (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ESRCH') throw error;
  }

  await new Promise<void>((resolve) => {
    const check = (): void => {
      try {
        process.kill(pid, 0);
        setTimeout(check, 10);
      } catch {
        resolve();
      }
    };
    check();
  });
}

describe('runTranslatorProof -- a real SIGKILL between writing the probe and cleanup (specs/22 M17 P6)', () => {
  it('leaves the probe and its crash-recovery lock behind, and the NEXT call reclaims both before writing its own', async () => {
    const dir = await tempDir();
    const staleProbeRelPath = 'probe.test.js';

    await spawnAndKill(dir, staleProbeRelPath);

    // The kill genuinely landed mid-flight: both the probe and its lock survive the process's own
    // death, since nothing can run a `finally` block during an unstoppable SIGKILL.
    const staleProbePath = path.join(dir, staleProbeRelPath);
    const lockPath = path.join(dir, '.forge', 'test-adopt', '.proof-probe.lock.json');
    await expect(readFile(staleProbePath, 'utf8')).resolves.not.toBeUndefined();
    await expect(readFile(lockPath, 'utf8')).resolves.toContain(staleProbeRelPath);

    // A fresh, uninterrupted call reclaims the stale probe and lock before writing its OWN probe --
    // proven by using a DIFFERENT probe path: if reclaim did not run, this call would still succeed
    // (no path collision), so the real assertion is what is left on disk afterwards, not merely that
    // this call did not throw.
    await writeFile(
      path.join(dir, 'baseline.test.js'),
      `
const test = require('node:test');
const assert = require('node:assert');
test('baseline passes', () => { assert.strictEqual(1 + 1, 2); });
`,
      'utf8',
    );
    const result = await runTranslatorProof({
      command: { run: `${process.execPath} --test`, output: { source: 'stdout' }, format: 'tap' },
      cwd: dir,
      paths: new ProjectPaths(dir),
      createTempPath: () => path.join(dir, 'tmp-output-fresh.raw'),
      probe: {
        path: 'probe-2.test.js',
        content: `
const test = require('node:test');
const assert = require('node:assert');
test('PROBE deliberately fails', () => { assert.strictEqual(1, 2); });
`,
        expectedName: 'PROBE deliberately fails',
      },
      runnerVersion: process.version,
      now: () => '2026-01-01T00:00:00.000Z',
    });
    expect(result.ok).toBe(true);

    // Nothing left behind at all: the stale probe from the killed run, its lock, and this run's own
    // probe (removed by its own, uninterrupted `finally`).
    await expect(readFile(staleProbePath, 'utf8')).rejects.toThrow();
    await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(dir, 'probe-2.test.js'), 'utf8')).rejects.toThrow();
  }, 20_000);
});
