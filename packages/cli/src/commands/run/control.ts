/**
 * `forge pause` / `forge abort [runId]` — `03` §3.2.4: "Control a running supervisor via the lock
 * socket." Real signals against a real, locked PID — see `lock.ts`'s own doc comment for exactly
 * what `SIGTERM`/`SIGKILL` do and do not guarantee here.
 *
 * @see specs/03 §3.2.4
 */
import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';

import { isProcessAlive, stopLockedProcess, type RunLock } from './lock.ts';

export interface StopResult {
  readonly lock: RunLock;
  readonly stopped: boolean;
}

async function stop(paths: ProjectPaths, signal: 'SIGTERM' | 'SIGKILL'): Promise<StopResult> {
  const lock = await stopLockedProcess(paths, signal);
  return { lock, stopped: !isProcessAlive(lock.pid) };
}

/** `forge pause`: `SIGTERM`. Real, event-log-durable state survives regardless (`forge resume`
 * picks up from wherever the log left off) — this milestone builds no cooperative mid-batch pause, so
 * "paused" and "aborted" differ only in which signal was sent, not in how resumable the result is. */
export async function pauseRun(paths: ProjectPaths): Promise<StopResult> {
  return stop(paths, 'SIGTERM');
}

/** `forge abort`: `SIGKILL` — cannot be caught or ignored by the target process at all. */
export async function abortRun(paths: ProjectPaths): Promise<StopResult> {
  return stop(paths, 'SIGKILL');
}

export function assertStopped(result: StopResult): void {
  if (!result.stopped) {
    throw new ForgeError('RUN-049', { pid: result.lock.pid });
  }
}
