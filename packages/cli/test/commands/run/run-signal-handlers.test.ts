/**
 * The signal handlers a run installs (`PLAN-M13.md` P12): scoped to the run, removed afterwards, exit with
 * the shell's `128 + signal` code, and always remove the launcher shim first (`process.exit` runs no
 * `finally` block).
 *
 * @see specs/02 §2.6
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
// Genuinely test-only, the identical exemption `helpers.ts` documents for its own `tmpdir` import.
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLauncherShim,
  removeLiveLauncherShims,
} from '../../../src/commands/run/launcher-shim.ts';
import {
  handleInterrupt,
  handleSigterm,
  installRunSignalHandlers,
  runWorkflow,
} from '../../../src/commands/run/run.ts';
import {
  FIXTURE_WORKFLOW_ID,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
} from './helpers.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  removeLiveLauncherShims();
  await cleanupAll();
});

const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
const counts = (): number[] => SIGNALS.map((signal) => process.listenerCount(signal));

describe('installRunSignalHandlers', () => {
  it('adds one listener per signal and removes exactly those when disposed', () => {
    const before = counts();
    const dispose = installRunSignalHandlers();
    expect(counts()).toEqual(before.map((n) => n + 1));
    dispose();
    expect(counts()).toEqual(before);
  });

  it('a whole in-process run leaves the process signal listeners as it found them', async () => {
    const project = await createTestProject();
    const before = counts();
    await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-signals',
      host: 'test-host',
    });
    expect(counts()).toEqual(before);
  });
});

describe('interrupt handlers', () => {
  it('exit with 128 + the signal number and remove the launcher shim first', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'forge-signal-test-'));
    await mkdir(parent, { recursive: true });
    const shim = await createLauncherShim(
      { execPath: process.execPath, execArgv: [], entry: '/x.js', env: { PATH: '/usr/bin' } },
      process.platform,
      () => path.join(parent, 'shim'),
    );
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    handleInterrupt(130);
    expect(exit).toHaveBeenCalledWith(130);
    expect(existsSync(shim.binDir)).toBe(false);
    handleInterrupt(129);
    expect(exit).toHaveBeenLastCalledWith(129);
    handleSigterm();
    expect(exit).toHaveBeenLastCalledWith(0);
    await rm(parent, { recursive: true, force: true });
  });
});
