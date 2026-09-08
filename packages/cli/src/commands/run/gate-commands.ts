/**
 * `forge gate <list|check|approve|reject|waive>` — `03` §3.2.4.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.3
 */
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import {
  applyWaiver,
  buildGateReport,
  evaluateGate,
  type GateDefinition,
  type GateReport,
  type Waiver,
} from '@forge/engine/gates';
import { GateNotFoundError, runShellCommand } from '@forge/engine/dispatch';
import { appendEvent } from '@forge/telemetry/events';

import { loadGateRegistry } from './gates.ts';

export interface GateCommandContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly checksRoot: string;
  readonly runId: string;
  readonly clock?: Clock;
}

export async function gateList(ctx: GateCommandContext): Promise<readonly GateDefinition[]> {
  const registry = await loadGateRegistry(ctx.paths, ctx.checksRoot);
  return [...registry.values()];
}

async function findGateOrThrow(ctx: GateCommandContext, gateId: string): Promise<GateDefinition> {
  const registry = await loadGateRegistry(ctx.paths, ctx.checksRoot);
  const definition = registry.get(gateId);
  if (definition === undefined) {
    throw new ForgeError('RUN-050', { gateId }, { cause: new GateNotFoundError(gateId) });
  }
  return definition;
}

/** `check <id>`: re-evaluates without approving — `10` §10.3 gate rule 3's own non-mutating read
 * path. Real: the identical `evaluateGate`/`buildGateReport` pipeline `@forge/engine/dispatch`'s own
 * `createGateEvaluator` wraps for a live run, called here directly. Emits no event — the whole point
 * of "does not mutate" (a caller that *wants* the result recorded calls `approve`/`reject` next,
 * which do). */
export async function gateCheck(ctx: GateCommandContext, gateId: string): Promise<GateReport> {
  const definition = await findGateOrThrow(ctx, gateId);
  const evaluated = await evaluateGate(definition, ctx.projectRoot, (check) =>
    runShellCommand(check.run, ctx.projectRoot),
  );
  return buildGateReport(definition, evaluated);
}

async function emitGateEvent(
  ctx: GateCommandContext,
  type: 'GateApproved' | 'GateRejected' | 'GateWaived',
  gateId: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  await appendEvent(ctx.projectRoot, ctx.runId, {
    type,
    runId: ctx.runId,
    ts: clock.now(),
    payload: { gateId, ...payload },
  });
}

export async function gateApprove(
  ctx: GateCommandContext,
  gateId: string,
  reason?: string,
): Promise<void> {
  await emitGateEvent(ctx, 'GateApproved', gateId, { reason });
}

export async function gateReject(
  ctx: GateCommandContext,
  gateId: string,
  reason: string,
): Promise<void> {
  await emitGateEvent(ctx, 'GateRejected', gateId, { reason });
}

export interface WaiveInput {
  readonly reason: string;
  readonly owner: string;
  readonly expiresAt: string;
}

/** `waive <id> --reason --expires`: the real `evaluateGate` → `applyWaiver` → `buildGateReport`
 * pipeline (`@forge/engine/gates`) — `10` §10.3 rule 1's own real enforcement (`GATE-504`/`GATE-505`
 * for a malformed or already-lapsed waiver), not re-implemented here, only driven — recorded as a
 * real `GateWaived` event carrying the real, validated `reason`/`owner`/`expiresAt`. */
export async function gateWaive(
  ctx: GateCommandContext,
  gateId: string,
  input: WaiveInput,
): Promise<GateReport> {
  const definition = await findGateOrThrow(ctx, gateId);
  const clock = ctx.clock ?? SYSTEM_CLOCK;

  const evaluated = await evaluateGate(definition, ctx.projectRoot, (check) =>
    runShellCommand(check.run, ctx.projectRoot),
  );
  const waiver: Waiver = input;
  const waived = applyWaiver(evaluated, waiver, Date.parse(clock.now()));

  await emitGateEvent(ctx, 'GateWaived', gateId, {
    reason: input.reason,
    owner: input.owner,
    expiresAt: input.expiresAt,
  });

  return buildGateReport(definition, waived);
}
