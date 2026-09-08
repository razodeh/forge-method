/**
 * `06` §6.3's own scheduler: ready-set computation, the four-level ordering tiebreak, and three
 * concurrency-limit classes plus an adapter-reported one. **Must be deterministic given a seed** — this
 * milestone's own second acceptance criterion, and `21` §21.1's own explicit "a flaky scheduler test means
 * the scheduler is non-deterministic, which is a bug in the scheduler" — so nothing in this submodule ever
 * reads wall-clock time, `Math.random`, or object/Map iteration order where that order isn't itself
 * already a deterministic function of the input.
 *
 * @see specs/06 §6.3
 * @see specs/21 §21.1, §21.3
 * @see PLAN-M5.md P12
 */
import type { AgentId, StepNode } from '../plan/index.ts';

/** No spec page enumerates a closed run-time status set the way `06` §6.2 does for compile-time fields —
 * this is entirely this piece's own invention, kept to exactly what `computeReadySet` itself needs to
 * decide "has this step's own dependency already finished successfully, and is this step itself still
 * eligible to run at all": `'pending'` (not yet started, the only status a node can transition *out* of
 * into any of the other four — a node never re-enters `'pending'`), `'running'`, `'succeeded'`, `'failed'`,
 * `'skipped'` (a later piece's own failure-classification/replan decision, `06` §6.8 — this piece only
 * needs to know a skipped step is not, and will never become, `'succeeded'`, the same as `'failed'` for
 * ready-set purposes). Retry — re-attempting a `'failed'` step — is `06` §6.8's own concern, not modelled
 * here: a caller that decides to retry simply moves that step's own status back to `'pending'` itself. */
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

/** `06` §6.3's own three concurrency-limit classes plus the adapter-reported one, as a caller-supplied
 * value — this piece enforces whatever limits it is handed, it does not decide what they should be. Per-
 * agent and per-resource-class limits are `ReadonlyMap`s keyed by whatever the caller's own policy
 * considers "the same agent"/"the same resource class": `06` §6.3's own "`exclusive` agents = 1" example
 * describes a *value* a caller would set for a role `05`'s own (unbuilt, `Q62`) per-role config already
 * marks `parallel_safety.exclusive: true` — this piece has no registry to look that up in itself, so it
 * never tries to. `perResourceClass` is symmetric: nothing on a compiled `StepNode` names its own resource
 * class (no field for it anywhere in `06` §6.2's own interface, the identical "referenced in prose, not
 * representable in the compiled type" shape `Q73`'s own finding 1 already named for `06` §6.2 rule 4's own
 * "phase") — a caller wanting this limit enforced supplies both the limit *and* (via `AdmissionCandidate`,
 * `concurrency.ts`) which class a given node belongs to. */
export interface ConcurrencyLimits {
  readonly global: number;
  readonly perAgent: ReadonlyMap<AgentId, number>;
  readonly perResourceClass: ReadonlyMap<string, number>;
  readonly adapterMax?: number | undefined;
}

/** The other half of `ConcurrencyLimits`: how many are *currently running* in each of the same four
 * classes, computed however the caller's own live run state makes easiest — this piece never tries to
 * derive it from a bare list of running ids itself, since "which resource class does this step belong to"
 * is exactly the caller-owned policy `ConcurrencyLimits`'s own doc comment already explains this piece has
 * no way to derive on its own. */
export interface RunningCounts {
  readonly global: number;
  readonly perAgent: ReadonlyMap<AgentId, number>;
  readonly perResourceClass: ReadonlyMap<string, number>;
}

/** A single ready node, paired with whichever resource class (if any) the caller's own policy assigns it
 * for the purposes of `admitsMoreConcurrency`'s own per-resource-class check — `StepNode` itself has no
 * such field (see `ConcurrencyLimits`'s own doc comment), so a caller that cares about this limit class at
 * all supplies the mapping per node, once, at the point it already knows it. */
export interface AdmissionCandidate {
  readonly node: StepNode;
  readonly resourceClass?: string | undefined;
}
