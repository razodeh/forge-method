/**
 * `06` §6.3's own scheduler as one stateful coordinator: wraps `computeReadySet`/`orderReadyNodes`/
 * `admitsMoreConcurrency` around a run's own live status/running state, exposing one `next()` call per
 * scheduling tick. Also the one place `@forge/engine/budget`'s own `canAdmit` (`PLAN-M5.md` P17) gets a
 * real say over a tick's own admission decisions, via the constructor's own optional `canAdmit` callback —
 * this module still has no dependency on, or awareness of, that one.
 *
 * @see specs/06 §6.3, §6.9
 * @see PLAN-M5.md P12, P17
 */
import { ForgeError } from '@forge/core/errors';

import { globsOverlap, type AgentId, type StepNode } from '../plan/index.ts';
import { admitsMoreConcurrency } from './concurrency.ts';
import { orderReadyNodes } from './ordering.ts';
import { computeReadySet } from './ready-set.ts';
import type { ConcurrencyLimits, StepStatus } from './types.ts';

export class Scheduler {
  private readonly nodes: readonly StepNode[];
  private readonly byId: ReadonlyMap<string, StepNode>;
  private limits: ConcurrencyLimits;
  private readonly seed: string;
  private readonly resourceClassOf: (node: StepNode) => string | undefined;
  private readonly canAdmit: (node: StepNode) => boolean;
  private readonly statuses = new Map<string, StepStatus>();
  private readonly running = new Set<string>();

  /** `resourceClassOf` is optional and defaults to "no node has a resource class" — `StepNode` itself has
   * no such field (`ConcurrencyLimits`'s own doc comment has the fuller reasoning), so a caller that
   * doesn't care about this one limit class pays nothing for it. `canAdmit` is the identical shape of seam
   * for a second, independent admission axis: `@forge/engine/budget`'s own `canAdmit(node, budgetState)`
   * (`PLAN-M5.md` P17) curried down to this one-argument form by whoever constructs this scheduler and
   * owns a `BudgetState` — the same "two mutually unaware modules, wired together only by whichever future
   * piece owns the real run loop" split `setLimits`'s own doc comment already establishes for
   * `@forge/engine/backpressure`. Defaults to "always admit," so a caller with no budget concept yet pays
   * nothing for it either.
   *
   * Throws `ForgeError('RUN-036')` if `nodes` contains two different objects sharing the same `id` — a
   * critic round found that `byId` (below) silently keeps only the last-declared duplicate, so once the
   * *other* one is ever marked running, every claim/agent it carried disappears from this scheduler's own
   * safety tracking with no error at all: a real concurrency-limit or claim-conflict violation, not merely
   * stale bookkeeping (`@forge/engine/plan`'s own `computeCriticalPath` accepts the identical "last
   * duplicate wins" shape for its own `byId`, but that map only ever feeds an advisory display value, not
   * a live safety mechanism — the stakes here are categorically different). `@forge/engine/plan`'s own
   * `compileRunPlan` already rejects a duplicate compiled id before a well-formed caller ever reaches this
   * constructor, so this check is defense against a caller bypassing that pipeline (a hand-built
   * `StepNode[]`) or a future bug in it, not a normal, expected-to-happen business outcome — the same
   * "never assume an earlier validation pass is the only path to a piece of code" lesson this milestone
   * has already learned more than once, applied here before any tick's own tracking can be compromised by
   * it rather than after. */
  constructor(
    nodes: readonly StepNode[],
    limits: ConcurrencyLimits,
    seed: string,
    resourceClassOf: (node: StepNode) => string | undefined = () => undefined,
    canAdmit: (node: StepNode) => boolean = () => true,
  ) {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (seen.has(node.id)) throw new ForgeError('RUN-036', { id: node.id });
      seen.add(node.id);
    }

    this.nodes = nodes;
    this.byId = new Map(nodes.map((node) => [node.id, node]));
    this.limits = limits;
    this.seed = seed;
    this.resourceClassOf = resourceClassOf;
    this.canAdmit = canAdmit;
  }

  status(id: string): StepStatus {
    return this.statuses.get(id) ?? 'pending';
  }

  markRunning(id: string): void {
    this.statuses.set(id, 'running');
    this.running.add(id);
  }

  markSucceeded(id: string): void {
    this.statuses.set(id, 'succeeded');
    this.running.delete(id);
  }

  markFailed(id: string): void {
    this.statuses.set(id, 'failed');
    this.running.delete(id);
  }

  /** `06` §6.8's own failure-classification/replan concern (not built yet, `PLAN-M5.md` P16) decides
   * *when* a step should be skipped; this method just records the outcome so the ready set and every
   * downstream node waiting on it are handled correctly (never `'succeeded'`, so nothing that depends on
   * it is ever considered ready). */
  markSkipped(id: string): void {
    this.statuses.set(id, 'skipped');
    this.running.delete(id);
  }

  /** Replaces the limits this scheduler enforces on every subsequent `next()` call — the seam
   * `@forge/engine/backpressure` (`PLAN-M5.md` P13) uses to feed its own, independently-computed
   * concurrency ceiling in: a caller owning both a `Scheduler` and a `BackpressureState` calls this once
   * per tick with `{ ...originalLimits, global: Math.min(originalLimits.global, backpressureState.ceiling)
   * }` before calling `next()`, so a rate-limit signal takes effect on the very next scheduling decision.
   * Deliberately a plain setter rather than a constructor-only field: unlike `nodes`/`seed` (fixed for a
   * run's own lifetime), `06` §6.3's own concurrency limits are explicitly a *moving* quantity backpressure
   * must be able to change between ticks, the same "this piece enforces whatever limits it is handed, it
   * does not decide what they should be" stance `ConcurrencyLimits`'s own doc comment already takes, now
   * also true across time, not just across callers. `@forge/engine/backpressure` itself never imports this
   * class (nor is imported by it) — the two modules stay mutually unaware of each other, wired together
   * only by whichever future piece owns the real run loop. */
  setLimits(limits: ConcurrencyLimits): void {
    this.limits = limits;
  }

  private runningNodes(): readonly StepNode[] {
    return [...this.running]
      .map((id) => this.byId.get(id))
      .filter((node): node is StepNode => node !== undefined);
  }

  /** One scheduling tick: the ready set, ordered by `06` §6.3's own four-level tiebreak, filtered down to
   * whatever the concurrency limits actually admit right now. Nodes are admitted greedily in priority
   * order — each admission's own claims and agent/resource-class usage count against every candidate
   * considered *after* it in this same call, not just against what was already running before this tick
   * started, so two ready nodes with overlapping claims (or the same exclusive agent) are never both
   * admitted in the same tick even if nothing was running yet to conflict with. Does not itself mark
   * anything `'running'` — a caller does that (`markRunning`) once it has actually launched what this
   * method returned, the same "this piece computes, the caller acts" split every other pure function in
   * `@forge/engine/plan` already uses. */
  next(): readonly StepNode[] {
    const runningNodes = this.runningNodes();
    const runningClaims = runningNodes.flatMap((node) => node.produces);
    const ready = computeReadySet(this.nodes, this.statuses, runningClaims);
    const ordered = orderReadyNodes(ready, this.nodes, this.seed);

    // Derived from the same filtered `runningNodes` as `perAgent`/`perResourceClass` just below, not the
    // raw `this.running.size` -- a verify round found those three disagreed if `this.running` ever held an
    // id absent from `this.byId` (only reachable via a caller's own bug: calling `markRunning` with an id
    // that was never one of the nodes this scheduler was constructed with), silently over-counting the
    // global limit against a phantom node that contributed nothing to the other three counters.
    let global = runningNodes.length;
    const perAgent = new Map<AgentId, number>();
    for (const node of runningNodes) {
      if (node.agent !== undefined) perAgent.set(node.agent, (perAgent.get(node.agent) ?? 0) + 1);
    }
    const perResourceClass = new Map<string, number>();
    for (const node of runningNodes) {
      const resourceClass = this.resourceClassOf(node);
      if (resourceClass !== undefined)
        perResourceClass.set(resourceClass, (perResourceClass.get(resourceClass) ?? 0) + 1);
    }

    const admitted: StepNode[] = [];
    const admittedClaims: string[] = [...runningClaims];

    for (const node of ordered) {
      const conflictsWithThisTick = node.produces.some((glob) =>
        admittedClaims.some((claim) => globsOverlap(glob, claim)),
      );
      if (conflictsWithThisTick) continue;

      const resourceClass = this.resourceClassOf(node);
      const admits = admitsMoreConcurrency({ node, resourceClass }, this.limits, {
        global,
        perAgent,
        perResourceClass,
      });
      if (!admits) continue;

      if (!this.canAdmit(node)) continue;

      admitted.push(node);
      admittedClaims.push(...node.produces);
      global += 1;
      if (node.agent !== undefined) perAgent.set(node.agent, (perAgent.get(node.agent) ?? 0) + 1);
      if (resourceClass !== undefined)
        perResourceClass.set(resourceClass, (perResourceClass.get(resourceClass) ?? 0) + 1);
    }

    return admitted;
  }
}
