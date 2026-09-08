/**
 * `forge pause` / `forge abort` — real `SIGTERM`/`SIGKILL` against a real, locked, still-running
 * process, and `assertStopped`'s own real RUN-049 refusal when the target process survives.
 *
 * @see specs/03 §3.2.4
 */
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { abortRun, assertStopped, pauseRun } from '../../../src/commands/run/control.ts';
import { acquireRunLock, isProcessAlive } from '../../../src/commands/run/lock.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('pauseRun / abortRun', () => {
  it('pauseRun sends a real SIGTERM that a real process without a handler dies from', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
    const pid = child.pid!;
    await acquireRunLock(project.paths, {
      pid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await pauseRun(project.paths);
    expect(result.stopped).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('abortRun sends a real SIGKILL, which a process cannot catch or ignore', async () => {
    const project = await createTestProject();
    const child = spawn('node', [
      '-e',
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
    ]);
    const pid = child.pid!;
    await acquireRunLock(project.paths, {
      pid,
      host: 'h',
      runId: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await abortRun(project.paths);
    expect(result.stopped).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
  });
});

describe('assertStopped', () => {
  it('does not throw for a real stopped result', () => {
    expect(() => {
      assertStopped({ lock: { pid: 1, host: 'h', runId: 'r', startedAt: 't' }, stopped: true });
    }).not.toThrow();
  });

  it('throws RUN-049 when the process genuinely survived the signal', () => {
    expect(() => {
      assertStopped({ lock: { pid: 1, host: 'h', runId: 'r', startedAt: 't' }, stopped: false });
    }).toThrow(expect.objectContaining({ code: 'RUN-049' }));
  });
});
