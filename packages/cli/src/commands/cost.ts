/**
 * `forge cost` — `03` §3.2.8: a real, project-wide spend report, built directly on `@forge/telemetry`'s
 * own already-built cost ledger (`18` §18.5) — never a second, independent accounting.
 *
 * @see specs/03 §3.2.8
 * @see specs/18 §18.5
 */
import { listDirEntriesSorted, pathExists, type ProjectPaths } from '@forge/core/fs';
import { readEvents } from '@forge/telemetry/events';
import {
  attributedSpend,
  checkBudget,
  projectLedger,
  type LedgerEntry,
} from '@forge/telemetry/ledger';
import type { ForgeConfig } from '@forge/schemas/config';

export interface CostCommandContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly config: ForgeConfig;
}

export interface CostReport {
  readonly totalUsd: number;
  readonly byRun: ReadonlyMap<string, number>;
  readonly byAgent: ReadonlyMap<string, number>;
  readonly byModel: ReadonlyMap<string, number>;
  readonly budgetStatus: 'ok' | 'warning' | 'breached';
}

async function listRunIds(ctx: CostCommandContext): Promise<readonly string[]> {
  // `.forge/state/` is a denied prefix under `resolveWithin` (`@forge/core/fs`'s own containment
  // rule) -- `resolveState` is the one sanctioned way to reach inside it.
  const runsDir = ctx.paths.resolveState('runs');
  if (!(await pathExists(runsDir))) return [];
  const entries = await listDirEntriesSorted(runsDir);
  return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
}

function sumInto(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/** Every real `LedgerEntry` across every real run this project has ever executed — `projectLedger`
 * itself only ever projects one run's own event stream at a time, so this walks every real run
 * directory and concatenates. */
async function allLedgerEntries(ctx: CostCommandContext): Promise<readonly LedgerEntry[]> {
  const runIds = await listRunIds(ctx);
  const entries: LedgerEntry[] = [];
  for (const runId of runIds) {
    entries.push(...(await projectLedger(readEvents(ctx.projectRoot, runId))));
  }
  return entries;
}

/** The real, project-wide cost report — total spend, grouped by run/agent/model (each entry's own
 * real `costUsd`, summed directly, not `attributedSpend`'s own per-step retry-aware view, which this
 * report has no single step to ask about), and the real, current `checkBudget` status against
 * `config.budget.dailyUsd` (the one real, project-wide cap `03` §3.2.8's own bare `forge cost`
 * invocation, with no `--run`/`--step` scope of its own, can meaningfully compare a *total* against). */
export async function costReport(ctx: CostCommandContext): Promise<CostReport> {
  const entries = await allLedgerEntries(ctx);

  const byRun = new Map<string, number>();
  const byAgent = new Map<string, number>();
  const byModel = new Map<string, number>();
  let totalUsd = 0;

  for (const entry of entries) {
    totalUsd += entry.costUsd;
    sumInto(byRun, entry.runId, entry.costUsd);
    sumInto(byAgent, entry.agent, entry.costUsd);
    sumInto(byModel, entry.model, entry.costUsd);
  }

  const budgetStatus = checkBudget({ spent: totalUsd, cap: ctx.config.budget.dailyUsd });

  return { totalUsd, byRun, byAgent, byModel, budgetStatus };
}

/** A real, single step's own real, retry-attributed spend (`18` §18.5's own worked "reports $6, not
 * $2" example) — `--step <runId>/<stepId>`'s own real backing. */
export async function costForStep(
  ctx: CostCommandContext,
  runId: string,
  stepId: string,
): Promise<number> {
  const entries = await projectLedger(readEvents(ctx.projectRoot, runId));
  return attributedSpend(entries, stepId);
}
