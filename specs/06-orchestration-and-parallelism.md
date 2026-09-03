# 06 — Orchestration and Parallel Execution

## 6.1 Execution model overview

```
Workflow definition  ──compile──▶  Run Plan (DAG of StepNodes)
                                        │
                                   Scheduler
                          ┌─────────────┼─────────────┐
                       Lane A        Lane B        Lane C        (git worktrees)
                          │             │             │
                     LaneRunner    LaneRunner    LaneRunner
                          │             │             │
                    PlatformAdapter session (Claude Code / CodeMachine)
                          └─────────────┴─────────────┘
                                        │
                                  Merge Queue ──▶ integration branch ──▶ Gate checks
```

## 6.2 The Run Plan

A run plan is a DAG produced by compiling a workflow against current project state.

```ts
interface StepNode {
  id: string;                       // stable: `${workflowId}:${stepId}[:${itemKey}]`
  kind: 'agent' | 'command' | 'gate' | 'elicit' | 'session' | 'subworkflow' | 'fanout' | 'merge';
  agent?: AgentId;
  brief?: string;                   // template ref
  inputs: ArtifactRef[];
  outputs: OutputContract[];
  dependsOn: string[];              // step ids
  produces: ResourceClaim[];        // file globs written
  consumes: ResourceClaim[];        // file globs read (advisory)
  laneAffinity?: 'exclusive' | 'shared' | 'inline';   // inline = run in supervisor, no worktree
  retry: RetryPolicy;
  limits: { maxTurns: number; wallClockMs: number; maxCostUsd: number };
  autonomy?: AutonomyLevel;         // step-level override
  idempotencyKey: string;           // used for resume
  onFailure: 'block' | 'continue' | 'escalate' | 'replan';
}
```

**Plan compilation rules:**

1. Expand `fanout` nodes over their collection (e.g. one node per story in the stage) using the
   item's ID in the step id so resume is stable.
2. Insert implicit dependencies from **contract freeze**: any step that writes an interface contract
   is an ancestor of every step that consumes it (see §6.6).
3. Insert implicit dependencies from **resource claims**: two steps whose `produces` globs intersect
   are serialised (or the plan is rejected as ambiguous if both are `exclusive`).
4. Insert gate nodes at their declared positions; a gate depends on everything in its phase.
5. Topologically sort; reject cycles with a rendered Mermaid graph showing the cycle.
6. Compute critical path and estimated cost; show both before execution.

`forge plan stage <id> --graph` renders the DAG as Mermaid for the user.

## 6.3 Scheduler

- **Ready set** = nodes whose dependencies are `succeeded` and whose resource claims don't conflict
  with a running node.
- **Ordering** among ready nodes: (1) unblocks the most downstream work, (2) on the critical path,
  (3) lowest estimated cost, (4) stable tie-break by `seed` + node id.
- **Concurrency limits:** global `--concurrency`; per-agent limits (`exclusive` agents = 1);
  per-resource-class limits (e.g. at most one migration-writing step at a time); adapter-level
  limits (`maxConcurrentSessions` reported by the adapter, to respect provider rate limits).
- **Admission control:** before launching, check remaining budget ≥ node's `maxCostUsd`; if not,
  raise `BUD-` and enter `waiting-budget`.
- **Backpressure:** on adapter rate-limit signals (e.g. `api_retry` events with `error: rate_limit`),
  the scheduler reduces effective concurrency multiplicatively (halve, floor 1) and restores it
  additively after a quiet period. This is required for real-world usability at concurrency > 2.

## 6.4 Lanes and git isolation

Each non-inline step runs in a **lane**:

```
.forge/state/worktrees/<laneId>/          git worktree
branch:  forge/<runId>/<stepId-slug>      branched from the integration branch
```

Lane lifecycle:

1. `git worktree add -b forge/<...> <path> <integration-base>`
2. Run adapter session with `cwd` = worktree path.
3. Agent commits inside the lane (conventional commits, `forge(<story>): …`, trailer
   `Forge-Step: <stepId>`, `Forge-Run: <runId>`, `Co-Authored-By:` the agent role).
4. On success → enqueue in merge queue. On failure → keep the worktree for inspection, mark lane
   `failed`, attach diff + logs.
5. After merge (or on abandon) → `git worktree remove --force`, delete branch (configurable retain).

**Rules:**

- Lanes never touch `.forge/state/` or `docs/forge/kb/` unless the step's ownership grants it.
  KB writes from lanes go through the KB proposal channel, applied by the supervisor on the
  integration branch (this prevents KB merge conflicts entirely).
- `.gitignore` MUST exclude `.forge/state/`. Worktrees live there, so they never self-reference.
- Non-git projects: FORGE requires git. `init` offers to `git init`. If refused, parallelism is
  disabled and lanes degrade to sequential in-place execution with a loud warning.

## 6.5 Merge queue

Serial, one merge at a time, on the integration branch (`forge/integration/<stage>` by default,
configurable to merge directly to a trunk).

Per candidate:

1. `git fetch` (no-op locally) + rebase lane branch onto current integration head.
2. **Conflict?** → `conflict resolution policy`:
   - `agent` (default): spawn a `merge-resolver` step with both lanes' intents, the conflicting
     hunks, and the relevant specs; the resolver must produce a build-and-test-passing resolution.
   - `human`: surface the conflict modal.
   - `abort`: fail the lane and replan.
3. Run the **pre-merge check set** (fast subset: typecheck, lint, affected unit tests) inside the
   lane worktree post-rebase.
4. Merge with `--no-ff` into integration; tag the merge commit with the step id.
5. Run the **post-merge check set** (full build + full test + contract tests) on integration.
   Failure → automatic revert of the merge, lane marked `failed-integration`, and a
   `diagnostician` step is scheduled with the failure evidence.
6. Emit `MergeCompleted`/`MergeReverted` events.

**Speculation is out of scope for v1** (no optimistic parallel merges). Correctness over throughput.

## 6.6 Contract-first parallelism (the key safety mechanism)

Parallel code generation fails when agents independently invent the same interface. FORGE prevents
this structurally:

1. A stage's plan MUST contain a **Contract Freeze** step before any implementation fan-out.
2. That step produces, as machine-readable artifacts:
   - **Interface contracts** — API schemas (OpenAPI/GraphQL SDL/protobuf), internal module
     interfaces (TS types / language-native signatures), event schemas, queue message shapes.
   - **Data contracts** — entity definitions, table/collection schemas, migration IDs.
   - **Error contracts** — error codes, retry semantics, idempotency keys.
   - **Config contracts** — env var names, defaults, secret names.
3. Contracts are written to `docs/forge/specs/interfaces/` and **generated into code** where possible
   (types from schema), so implementations import rather than re-declare.
4. Contracts become **frozen** for the stage: any lane needing a change must emit
   `FORGE_REQUEST_CHANGE` → creates a `ContractChangeRequest` → handled by the owning agent →
   propagated to dependent lanes as a *context update* and, if breaking, a replan.
5. A gate check (`interfaces:frozen`) fails the design gate if any consumer references an undefined
   contract.

This is the single highest-leverage difference between FORGE and naive parallel agent swarms.

## 6.7 File ownership and claims

- Each step declares `produces` globs. The scheduler builds an interval map; overlapping claims are
  serialised.
- At lane completion, the actual changed file set is diffed against the claim. **Out-of-claim
  writes** are a policy violation:
  - `strict` (default for `autonomous`): revert out-of-claim files, fail the step, log.
  - `warn` (default for `guided`): keep, but flag in the merge review and require approval.
- Shared files that are unavoidably touched by many lanes (lockfiles, DI registries, route tables,
  i18n catalogs, `CHANGELOG`) are declared in config as `sharedMutablePaths` with a strategy:
  `serialize` (claim exclusively for the duration), `regenerate` (a post-merge command rebuilds it),
  or `append-only` (merge driver concatenates). A `.gitattributes` merge driver MAY be installed for
  known append-only files.

## 6.8 Retry, failure and escalation

```ts
interface RetryPolicy {
  maxAttempts: number;              // default 3 for agent steps, 1 for gates
  backoffMs: [number, number];      // [initial, max], exponential with jitter
  retryOn: ('transient'|'tool-error'|'validation'|'test-failure'|'timeout')[];
  escalate?: { afterAttempts: number; to: 'stronger-model'|'human'|'diagnostician' };
}
```

Failure classification (implemented in `@forge/engine/failures.ts`):

| Class | Examples | Default handling |
|---|---|---|
| `transient` | network, 429/529, provider overload | retry with backoff; reduce concurrency |
| `auth` | expired token, missing key | halt run, surface remedy |
| `budget` | cost cap reached | pause, ask |
| `validation` | output failed schema/contract | retry once with the validator's exact errors appended; then escalate |
| `test-failure` | generated tests fail | up to N self-fix loops (default 2), then `diagnostician` |
| `tool-error` | agent used a forbidden/failing command | retry with a corrective note; repeated → policy violation |
| `timeout` | wall-clock/turn cap | checkpoint, escalate to stronger model or split the step |
| `policy` | out-of-claim writes, forbidden path, secret leak attempt | fail immediately, no retry, surface to human |
| `conflict` | contradictory inputs (`FORGE_CONFLICT`) | halt the step, route to owning agent or human |

**Never-retry rule:** a step that failed twice with the *same* error signature must not be retried a
third time identically; it must be escalated (stronger model, decomposed into smaller steps, or
handed to a human). Repetition without variation is a known agent failure mode and FORGE detects it
by hashing normalised error output.

## 6.9 Budgets

Three levels, all enforced:

- **Step budget** (`limits.max_cost_usd`) — the adapter is told a cap where supported; FORGE also
  aborts the session when the running total exceeds it.
- **Run budget** (`--budget` / config) — admission control + hard stop.
- **Period budget** (daily/weekly) — tracked in the ledger; exceeding blocks new runs until reset or
  override.

On breach: pause (never silently continue), show the breakdown, and offer raise/finish/abort.

## 6.10 Resumability

Every step transition is an event:
`StepScheduled → StepStarted → StepProgress* → (StepSucceeded | StepFailed | StepAborted)`.

On resume (`forge resume`):

1. Reload event log; rebuild run state.
2. For each `StepStarted` without a terminal event:
   - if the adapter supports session resume **and** the session id is still valid → resume it;
   - else roll the lane worktree back to its last FORGE commit (or the lane base) and re-run the
     step from its idempotency key.
3. Re-validate all artifacts produced so far (they may have been hand-edited); mismatches surface as
   a reconciliation prompt.
4. Re-enter the scheduler loop.

A crash-resume test (kill -9 at 20 randomised points during a fixture run) is a required CI test.

## 6.11 Observability of the orchestration itself

- Every step emits an OpenTelemetry-shaped span into the local trace file
  (`.forge/state/runs/<runId>/trace.ndjson`): `run → phase → step → tool-call`.
- `forge run --otlp <endpoint>` MAY forward spans (opt-in, off by default).
- The TUI's lane detail is a rendering of these spans plus the adapter transcript.
- `forge status --json` returns the full run state for external monitoring.
