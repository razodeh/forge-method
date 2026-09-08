/**
 * `forge status` / `forge lanes` / `forge logs` — `03` §3.2.4: real, current state read from the real
 * durable event log (`@forge/telemetry`'s own `readEvents`) via `@forge/engine/resume`'s own
 * `reconstructRunState` (M5 P18) — the identical replay machinery the crash-resume capstone already
 * proves correct, not a second, parallel state-tracking mechanism.
 *
 * @see specs/03 §3.2.4
 */
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import { reconstructRunState, type RunState } from '@forge/engine/resume';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';

import { readRunLock, type RunLock } from './lock.ts';

async function resolveRunId(paths: ProjectPaths, runId: string | undefined): Promise<string> {
  if (runId !== undefined) return runId;
  const pointer = paths.resolveState('last-run.json');
  if (!(await pathExists(pointer))) {
    throw new ForgeError('RUN-048', undefined);
  }
  const { runId: lastRunId } = JSON.parse(await readTextFile(pointer)) as {
    readonly runId: string;
  };
  return lastRunId;
}

export interface RunStatusView {
  readonly runId: string;
  readonly runStatus: RunState['runStatus'];
  readonly spentUsd: number;
  readonly stepCounts: Readonly<Record<string, number>>;
  readonly unresolvedStepIds: readonly string[];
  readonly lock: RunLock | undefined;
}

export async function runStatus(
  paths: ProjectPaths,
  projectRoot: string,
  runId: string | undefined,
): Promise<RunStatusView> {
  const resolvedRunId = await resolveRunId(paths, runId);
  const runState = await reconstructRunState(readEvents(projectRoot, resolvedRunId));
  const lock = await readRunLock(paths);

  const stepCounts: Record<string, number> = {};
  for (const status of runState.stepStatuses.values()) {
    stepCounts[status] = (stepCounts[status] ?? 0) + 1;
  }

  return {
    runId: resolvedRunId,
    runStatus: runState.runStatus,
    spentUsd: runState.spentUsd,
    stepCounts,
    unresolvedStepIds: runState.unresolvedStepIds,
    lock: lock?.runId === resolvedRunId ? lock : undefined,
  };
}

export interface LaneView {
  readonly laneId: string;
  readonly status: string;
  readonly stepId: string | undefined;
  readonly baseSha: string | undefined;
}

export async function runLanes(
  paths: ProjectPaths,
  projectRoot: string,
  runId: string | undefined,
): Promise<readonly LaneView[]> {
  const resolvedRunId = await resolveRunId(paths, runId);
  const runState = await reconstructRunState(readEvents(projectRoot, resolvedRunId));

  return [...runState.laneStatuses.entries()].map(([laneId, status]) => {
    const origin = runState.laneOrigins.get(laneId);
    return { laneId, status, stepId: origin?.stepId, baseSha: origin?.baseSha };
  });
}

export interface RunLogsOptions {
  readonly runId?: string;
  readonly stepId?: string;
}

/** Every real event this run has ever emitted, optionally filtered to one step — a real async
 * generator over `readEvents`, not a materialized array, so `--follow` (a future piece's own job:
 * this milestone builds no live-tail polling loop, only the real, replayable data it would tail) can
 * be layered on without this function's own shape changing. */
export async function* runLogs(
  paths: ProjectPaths,
  projectRoot: string,
  options: RunLogsOptions,
): AsyncGenerator<ForgeEvent> {
  const resolvedRunId = await resolveRunId(paths, options.runId);
  for await (const event of readEvents(projectRoot, resolvedRunId)) {
    if (options.stepId !== undefined && event.stepId !== options.stepId) continue;
    yield event;
  }
}
