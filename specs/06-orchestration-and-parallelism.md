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
                    PlatformAdapter session (Claude Code or a configured adapter)
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
  laneAffinity?: 'exclusive' | 'shared' | 'inline';   // inline = run in supervisor (in the integration worktree), no lane
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

- Lanes never touch `.forge/state/`. A lane may write a `docs/forge/` path (the KB included) only if
  it is one of the step's declared `outputs` or lies in its `produces` (§6.7); any other KB change
  from a lane goes through the KB proposal channel, applied by the supervisor on the integration
  branch (this prevents KB merge conflicts entirely).
- A lane whose step succeeded and which no `merge` step lands is enqueued in the merge queue by the engine
  as soon as the step succeeds (between scheduling ticks, in plan order), and lanes are created from the
  integration branch tip (a stacked lane excepted, below), so a later step, an inline step and a gate see it. A `merge` step lands the lanes
  of the steps in its dependency closure (not only its direct predecessors), stopping at a `gate` or another
  `merge`, which are integration checkpoints (a step upstream of a checkpoint is integrated before it, so
  what a gate reads is there); it batches and orders them and is never bypassed. A lane no `merge` lands is
  checked by the run's `execution.mergeChecks` (§6.5 steps 3 and 5; each optional, none configured means none
  run). An inline step runs in the integration worktree, serialised with the merge queue, and must leave it
  unchanged.
- A lane a `merge` lands is not integrated before that merge, so a step that builds on one is **stacked**: when
  exactly one of a step's dependencies has a lane that is still waiting for the same `merge` (a dependency whose
  lane is contained in another such lane's adds nothing), the step's lane is created from that lane's head, not
  from the integration tip, and the step starts from the predecessor's committed output. The merge lands the
  lanes in dependency order; the successor's lane holds the predecessor's commits, so once the predecessor has
  landed the successor's rebase replays only its own. A step that depends on several such lanes none of which
  contains the others branches from the integration tip and does not see them (`LaneCreated` lists them as
  `unstackedPredecessors`). The base is recorded as the lane's `baseSha`, which resume restores. A `swarm-review`
  step stacked on the lane it reviews runs its perspective sessions in that lane's worktree.
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

A merge policy's `preChecks`/`postChecks` (and `execution.mergeChecks`) name a check set, not a command: `fast`
is the `typecheck`, `lint` and `unit` layers, `full` adds `integration` and `contract` (`e2e`, `nfr` and `smoke`
need a deployed environment and belong to the gates), and a single layer name is that layer alone; each layer
runs `execution.testCommands.<layer>` (`13` F-TEST-1) with a timeout and an output cap. Any other value is a shell
command. A layer with no command is skipped and recorded on `MergeStarted`; a set none of whose layers has one
refuses the merge before anything is landed (`MERGE-CHECKS-UNCONFIGURED`, naming the config keys), because
a check that cannot run has not passed.

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
- A step's claim is the set of paths it may write: its `produces` globs plus, when it is an `agent`
  step that declares `outputs`, the `18` §18.7 paths of those outputs (the output contract is checked for
  `agent` steps only, so a `command` step's declared outputs are not part of its claim). This is what `05` §5.5 rule 6 means by "paths you
  own for this step"; a role's `file_ownership` is its default territory for keeping unrelated lanes
  apart and does not narrow a declared output.
- At lane completion, the actual changed file set is diffed against the claim. **Out-of-claim
  writes** are a policy violation:
  - `strict` (default for `autonomous`): revert out-of-claim files, fail the step, log.
  - `warn` (default for `guided`): keep, but flag in the merge review and require approval.
  - An `agent` step that declares `outputs` is always `strict`, whatever the autonomy level: its claim is
    `produces` plus the outputs' `18` §18.7 paths, so `strict` never reverts a declared output; an
    out-of-claim write reverts the file, records a `PolicyViolation` event, and **fails the step**.
    `warn` remains the `guided` default for a step that declares neither `outputs` nor `produces` (a
    `command` step). An `agent` step with an empty claim (below) has no `write` grant at all and is
    enforced `strict` too: whatever such a step writes is out-of-claim by definition, so it reverts and
    fails the step the same way.
- **An empty claim means no write.** An `agent` step that declares neither `outputs` nor `produces` is given no
  `write` grant, whatever its agent's definition says: the effective `write` is the agent's grant AND a
  non-empty claim (`20` §20.1), and block [6] of its prompt says so. The one exception is a caller that confines
  a session's writes itself (`forge debug`'s FIX scans its diff against the protected set). A `produces` entry
  that starts with `!` is an exclusion, not a glob: it removes the paths it matches from the claim (subtracted,
  never unioned), and the reserved entry `!@protected` removes the protected set (`20` §20.2: CI and hook
  configuration, package manifests and test-runner configuration, credentials and `.env*`, editor and agent-tool
  configuration, the project's document roots). A step that writes "the project" wherever a defect or a
  migration leads declares `produces: ['**', '!@protected']`. Whatever a claim says, an `agent` step's claim
  never reaches `.git/`, `.forge/` or a `.env` file, and a path a claim excludes is reverted under `warn`
  as well as `strict`. The withheld grant is the first control, not the only one: an agent's `exec`
  allowlist can still change files, so whatever an empty-claim step changes is reverted under `warn` as well as
  `strict` (it got past the grant), and claim enforcement (this section) is the second control.
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
