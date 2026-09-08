# PLAN-M5 — Engine: workflows, scheduling, lanes, gates

Source: `specs/22` M5, explicitly "the largest milestone... split into pieces of ≤400 lines." **Build:**
`@forge/vcs` (worktrees, lane branches, merge queue, conflict detection, claim enforcement, shared-path
strategies, dirty-tree protection); `@forge/telemetry` (event log with fsync-before-side-effect,
redaction at write time, projections, cost ledger); `@forge/engine` (workflow parser and validator, the
sandboxed expression evaluator, plan compilation with fanout and implicit dependencies, the scheduler
with concurrency/claims/backpressure/admission control, lane runners, gate evaluation with deterministic
and advisory checks, failure classification, retry and escalation, anti-thrash, resume). **Do not
build:** real agents beyond stubs, sessions, brownfield, TUI — all later milestones.

`02` §2.2 declares `engine ← core, kb, agents, adapter-kit, vcs, telemetry, schemas, methods, extensions`,
but `agents`/`methods` are M6 packages that don't exist yet, and nothing in M5's own scope needs real
`kb`/`extensions` content either — the identical shape of forward-dependency conflict Q43 (M3/CLI) and
Q57 (M4/telemetry) already resolved, now compounded with three further M5-specific scoping questions
(what "real agents beyond stubs" concretely means for step execution; workflow/gate *content* — M6's
`@forge/templates` — versus the generic *mechanism* that runs any conforming content, which is M5's own
job; and how `21` §21.2's literal E2/E3 fixtures, which require the not-yet-built CLI and real workflow
content, map onto M5's own `--grep "E3 crash-resume"` exit test). All four resolved the same way, with
full reasoning, in **`SPEC-QUESTIONS.md` Q62** — read it before starting any piece below, since several
pieces' own Surface sections assume its conclusions without re-deriving them.

One spec source, normative: `specs/06-orchestration-and-parallelism.md` (the execution model, scheduler,
lanes, merge queue, contract-first parallelism, claims, retry/failure, budgets, resumability — verbatim
where given); `specs/10-workflow-engine-and-lifecycle.md` §10.1 (workflow DSL, step kinds, expressions,
validation) and §10.3 (gates, gate rules, normative). `specs/18-persistence-config-and-schemas.md` §18.4
(the event log's own `ForgeEvent` shape and catalogue, verbatim) and §18.10 (atomicity/crash-safety
rules) are normative for `@forge/telemetry`. `specs/20-security-safety-and-cost.md` §20.2 (filesystem/
repo safety), §20.4 point on redaction, §20.8 (cost governance) and §20.10's S1/S3/S9/S12 are normative
for what `@forge/vcs`/`@forge/telemetry` must not get wrong. `specs/21-testing-forge-itself.md` §21.3's
"Engine and scheduler" and "VCS and lanes" rows, plus §21.2/§21.3's E2/E3 end-to-end rows (scoped per
Q62 part 4), are normative for this milestone's own required test suites.

Three new packages: `packages/vcs`, `packages/telemetry`, `packages/engine`; none exist yet. Twenty
pieces, ordered so dependencies come first within and across packages — `vcs` and `telemetry` have no
dependency on each other and are ordered per `specs/22`'s own listed Build order (vcs, then telemetry),
not because either requires the other.

---

## P1 — Git primitives, dirty-tree protection, pre-run snapshot

**Mandate:** the lowest-level git operations every later `vcs` piece builds on, plus the one safety gate
that must exist before any lane is ever created: refusing to start a run against a dirty working tree.
`02` §2.1 is explicit that worktree support in git libraries is weak — porcelain status reads go through
`simple-git`, worktree/branch mutation goes through a direct `git` subprocess (`execa`).

**Spec:** `06` §6.4 (lane lifecycle, git requirement); `20` §20.2 points 5–6 (dirty tree halts the run,
never discards uncommitted changes; pre-run snapshot); `20` §20.10 S8.

**Surface:** `@forge/vcs/git`
- `VcsError` — a local `Error` subclass carrying `code`/`remedy` fields shaped like `ForgeError`'s own
  (`02` §2.6) but not that class: `vcs ← schemas` only (`02` §2.2), no `core` edge, so `@forge/core/
  errors`'s real `ForgeError` is structurally unreachable here — the identical position-in-the-graph
  reason `@forge/adapter-kit`/`@forge/testkit` never throw it either (`SPEC-QUESTIONS.md` Q58 point 15).
  `@forge/engine` (which has both `core` and `vcs`) is where a caller wraps a caught `VcsError` into a
  real `ForgeError` with the matching `VCS-`/`ENV-` code, once it needs to surface one to a human.
- `assertGitAvailable(cwd)` — throws `VcsError` (`code: 'ENV-004'`-shaped) if `git` isn't on `PATH` or
  `cwd` isn't inside a repo; per `06` §6.4's own "non-git projects... `init` offers to `git init`. If
  refused, parallelism is disabled" — this function reports the fact, the caller (a later milestone's
  `init`/`run` command) decides what to do with it.
- `getDirtyFiles(cwd): readonly string[]` — porcelain status, untracked included.
- `snapshotRepoState(cwd): { sha: string; dirtyFiles: readonly string[] }` — the pre-run snapshot `20`
  §20.2 point 6 requires, so a later `forge doctor` can report exactly what to return to.
- `assertCleanWorkingTree(cwd)` — throws a `VcsError` naming the dirty files when `getDirtyFiles` is
  non-empty; the three offered remedies (stash/commit/abort) are named in the error's own `remedy`
  text, not implemented here — this package refuses to guess which the user wants.

**Checks:** a dirty tree (staged, unstaged, and untracked cases separately) is detected and named
correctly; a clean tree passes; `snapshotRepoState` on a real fixture repo returns the real HEAD SHA and
an accurate dirty-file list; `assertGitAvailable` fails closed (not silently permissive) when `git` is
missing, verified by temporarily shadowing `PATH` in the test, not by mocking `execa`.

**Depends on:** nothing new (first piece).

*(P1 is committed: `72180d7`. See `SPEC-QUESTIONS.md` Q63 and its critic-round/verify-round addenda —
the verify round's own second finding forced a full redesign of the "no commits yet" detection mechanism,
not just a patch; see `GAUNTLET-LOG.md`'s own calibration note for the fuller story.)*

---

## P2 — Lane worktree lifecycle

**Mandate:** `06` §6.4's own lane lifecycle steps 1 and 5 — create and remove a git worktree on its own
branch, named and namespaced exactly as specified, with a retain-on-failure policy and cleanup that
survives a crash (a worktree left behind by an unclean prior process must be discoverable and
reclaimable, not merely leaked).

**Spec:** `06` §6.4 (worktree path, branch naming `forge/<runId>/<stepId-slug>`, retain policy); `18`
§18.2 (`​.forge/state/worktrees/<laneId>/` on-disk location); `20` §20.2 point 4 (lane branches namespaced
so they can never collide with human branches); `20` §20.10 S12 (no orphaned worktrees blocking resume).

**Surface:** `@forge/vcs/lanes`
- `LaneId` — branded string.
- `slugifyStepId(stepId): string` — deterministic, filesystem- and branch-name-safe.
- `createLaneWorktree(cwd, { runId, stepId, integrationBase }): LaneHandle` — `git worktree add -b
  forge/<runId>/<stepId-slug> <path> <integrationBase>`; `LaneHandle` carries the resolved path, branch
  name, and lane id.
- `removeLaneWorktree(handle, { retain }): Promise<void>` — `git worktree remove --force` plus branch
  deletion, skipped entirely when `retain` is true.
- `listOrphanedWorktrees(cwd): readonly LaneHandle[]` — worktrees present on disk that the *current*
  process's own run state doesn't know about (a crash-recovery primitive S12 needs; the caller, not this
  function, decides whether to reclaim or report them).

**Checks:** worktree create/remove round-trips cleanly on a real fixture repo; branch names match the
exact `forge/<runId>/<stepId-slug>` pattern including for a `stepId` containing characters a branch name
can't (slugified, collision-checked); `retain: true` leaves the worktree and branch in place;
`listOrphanedWorktrees` finds a worktree created directly via `git worktree add` outside this package's
own bookkeeping, proving it doesn't rely on an in-memory registry that a crash would lose.

**Depends on:** P1.

*(P2 is committed: `7cc7194`. See `SPEC-QUESTIONS.md` Q64 and its critic-round/verify-round addenda —
3 blocking findings this round, plus a macOS symlink-resolution bug the builder found and fixed
independently between rounds; see `GAUNTLET-LOG.md`'s own entry for the fuller story.)*

---

## P3 — Lane commit conventions

**Mandate:** committing inside a lane worktree with the exact conventional-commit format and required
trailers `06` §6.4 step 3 specifies, so every lane commit is mechanically parseable by the merge queue,
the audit trail (`20` §20.9), and a human reading `git log`.

**Spec:** `06` §6.4 step 3 (verbatim: `forge(<story>): …`, trailers `Forge-Step`, `Forge-Run`,
`Co-Authored-By:` the agent role); `18` §18.3 (`vcs.commitConvention`, `vcs.signCommits`, `vcs.trailers`
config keys this piece must honour).

**Surface:** `@forge/vcs/commit`
- `formatCommitMessage({ scope, subject, stepId, runId, agentRole }): string` — pure formatting, no git
  call, independently testable against the exact trailer shape.
- `commitInLane(handle, { message, sign }): Promise<{ sha: string }>` — `git commit` inside the lane
  worktree with the formatted message; `sign` wires `-S` when `vcs.signCommits` is on.

**Checks:** formatted message matches the spec's own example byte-for-byte for a worked case; all three
trailers present, correctly ordered, correctly keyed; a real commit in a fixture lane produces a commit
whose `git log --format=%B` round-trips through the same trailer parser the merge queue (P5) will later
use.

**Depends on:** P2.

*(P3 is committed: `a3a7057`. See `SPEC-QUESTIONS.md` Q65 and its critic-round/verify-round addenda —
3 blocking findings this round, the sharpest a trailer-injection vulnerability via an unsanitized
newline; see `GAUNTLET-LOG.md`'s own entry for the fuller story.)*

---

## P4 — Write-policy enforcement: claims and shared mutable paths

**Mandate:** the two post-execution write policies `06` §6.7 describes for a lane whose session has just
ended: diffing actual changed files against the step's declared `produces` claim (`strict` reverts,
`warn` flags), and the three named strategies (`serialize`, `regenerate`, `append-only`) for files many
lanes unavoidably touch. Both operate on a *real, completed* lane worktree — this is `@forge/vcs`'s own
domain per `SPEC-QUESTIONS.md` Q62's sixth note; the *scheduling-time* interval map that decides which
claims may run concurrently is `@forge/engine`'s job (P11), not this piece's.

**Spec:** `06` §6.7 (verbatim); `18` §18.3 (`execution.sharedMutablePaths` config shape); `20` §20.2
point 3, `20` §20.10 S1.

**Surface:** `@forge/vcs/claims`
- `diffLaneChanges(handle, baseSha): readonly string[]` — every path that differs from `baseSha`,
  committed or not (working tree and untracked state included, not just history) — real git, not the
  step's own self-report.
- `enforceClaim(handle, baseSha, declaredGlobs, policy: 'strict' | 'warn'): ClaimEnforcementResult` —
  `strict` reverts (checks out the pre-lane version of, or removes outright if it did not exist at
  `baseSha`) every changed file outside `declaredGlobs`; `warn` keeps every file. Neither throws for the
  violation itself — both return a structured result naming what was out of claim and what was actually
  reverted, for a caller to act on (deciding "the step failed" is `@forge/engine`'s call, not this
  piece's — `SPEC-QUESTIONS.md` Q62). *(Corrected from the original draft here, which omitted `baseSha`
  — diffing a lane's changes structurally requires knowing what to diff against, and nothing in a bare
  `LaneHandle` carries that; caught before any code was written against the wrong shape.)*
- `applySharedPathStrategy(handle, options: { glob, strategy: 'serialize' } | { glob, strategy:
  'append-only' } | { glob, strategy: 'regenerate', command }): Promise<void>` — a discriminated union,
  not a flat optional `command?`, so a `regenerate` call missing its command is a compile error, not a
  runtime one. `serialize` is a caller-side concurrency concern (this function assumes exclusivity
  already held); `regenerate` runs the configured command, through a real shell, inside the lane;
  `append-only` installs (or verifies) git's own *built-in* `union` merge driver via a `.gitattributes`
  line for the glob, not a hand-written driver script.

**Checks:** an out-of-claim write is reverted in `strict` and left-but-flagged in `warn`, each proven
against a real lane with a real extra file; `regenerate` actually invokes the configured command and
fails loudly (not silently) if it errors; `append-only`'s installed merge driver is verified by a real
concurrent two-branch edit to the same file that merges without conflict.

**Depends on:** P2, P3.

*(P4 is committed: `b9fee96`. See `SPEC-QUESTIONS.md` Q66 and its critic-round/verify-round addenda —
5 blocking findings this round, the sharpest a factually wrong assumption about git's own rename-detection
default that this piece's own design writeup had made; a further finding in the verify round itself
(a fix's own new code breaking against unrelated existing behaviour in the same file) closed with a
design change, not a patch; see `GAUNTLET-LOG.md`'s own entry for the fuller story.)*

---

## P5 — Merge queue

**Mandate:** `06` §6.5's full six-step pipeline as one serial queue: rebase onto current integration
head, dispatch on conflict policy (`agent`/`human`/`abort`), run a caller-supplied pre-merge check set,
merge `--no-ff` tagged with the step id, run a caller-supplied post-merge check set, automatic revert on
post-merge failure. "Spawn a merge-resolver step" (the `agent` policy's own real behaviour) is `@forge/
agents`/`@forge/engine` content per Q62 part 2 — this piece accepts a caller-supplied async resolver
function instead, the same "capability this package cannot reach yet" shape Q62 uses throughout.

**Spec:** `06` §6.5 (verbatim, all six steps — the `MergeReverted`/diagnostician-scheduling mention is
step 5's own text, not a separate §6.8 citation as an earlier draft of this line said; the diagnostician
scheduling itself is `@forge/engine`'s job — this piece only needs to *report* a post-merge failure
precisely enough for a caller to act on it); `20` §20.2 point 4 (never force-push, never rewrite
published history).

**Surface:** `@forge/vcs/merge-queue`
- `MergeCandidate` — lane handle, `stepId`/`runId` (needed to tag the merge/revert commit; not
  recoverable from `handle.branch` alone since `slugifyStepId` is lossy), declared claim (forwarded into
  `MergeConflictDescription` as resolver context, not used by this piece's own control flow), conflict
  policy.
- `MergeConflictResolver = (conflict: MergeConflictDescription) => Promise<'resolved' | 'unresolved'>` —
  `agent` and `human` policy both just mean "call this"; only `abort` is structurally different.
- `MergeConflictDescription` — `conflictedFiles: readonly ConflictedFile[]` (path + porcelain XY status
  code, not a bare path list — `diff` alone has no useful content for a delete/modify or rename/rename
  conflict), `diff`, `worktreePath`, `declaredClaim`, `laneId`.
- `PreMergeCheck` / `PostMergeCheck = (worktreeOrIntegrationPath: string) => Promise<CheckResult>` —
  caller-supplied, run in order, stop at the first failure; this package has no opinion on what
  "typecheck" or "full test" means. A throwing check propagates uncaught, not collapsed into an ordinary
  failure.
- `processMergeCandidate(candidate, { integrationPath, conflictResolver, preChecks, postChecks }):
  Promise<MergeOutcome>` — serial by construction (one call at a time; the caller owns queueing order).
  `MergeOutcome` is a discriminated union of objects, each carrying real data (`mergeCommitSha`,
  `checkResult`, `revertCommitSha`), not bare string tags: `clean` | `conflict-resolved` |
  `conflict-unresolved` | `pre-check-failed` | `post-check-failed-reverted`. Every failure exit — a
  conflict resolved to abort, a missing resolver, a failed merge, a failed revert, a throwing resolver —
  cleans up (aborts the rebase or merge/revert in progress) before returning or throwing, so nothing ever
  wedges the queue for a later, unrelated candidate.

**Checks:** a clean merge (no conflict) succeeds and is tagged; a real conflicting pair of lanes routes
through the resolver and merges once resolved, including a *second*, independent conflict revealed only
by continuing after the first is resolved; an unresolved conflict under `abort` fails the candidate
without touching integration; a post-merge check failure triggers an automatic revert that leaves
integration at its exact pre-merge SHA, proven by comparing tree hashes, not just "no error thrown";
`git log` on integration after a revert shows both the merge and the revert commits, never a rewritten
history.

**Depends on:** P2, P3, P4.

*(P5 is committed: `85de709`. See `SPEC-QUESTIONS.md` Q67 and its critic-round/verify-round addenda — the
largest piece this milestone by finding count: 3 blocking + 4 major in the critic round, then a further
1 blocking + 2 major in the verify round, all in the same "a failure path needs cleanup, and a cleanup
call is itself fallible" family; see `GAUNTLET-LOG.md`'s own entry for the fuller story, including a
calibration note on why that family needed two full rounds to fully surface.)*

---

## P6 — Event log: types, append/read, fsync, redaction at write time

**Mandate:** `18` §18.4's `ForgeEvent` shape and catalogue, and the write-ahead-log discipline the whole
resumability guarantee rests on: an event is written and fsync'd *before* the side-effect it authorises
is attempted. Redaction is built into the same piece, not a later addition — an event log that can leak
a secret is not a spec-compliant event log (`18` §18.4's own "redaction happens at write time" is part
of what "the event log" *means*, not an optional enhancement).

**Spec:** `18` §18.4 (verbatim: `ForgeEvent` interface, the full event catalogue table, the immutability/
gapless-`seq` rules); `18` §18.10 (fsync policy, "do not optimise it away without replacing the
guarantee"); `20` §20.4 (redaction control row); `20` §20.10 S3.

**Surface:** `@forge/telemetry/events`
- `ForgeEvent`, `EventType` (the full catalogue, one string-literal union) — typed exactly per `18`
  §18.4's table, grouped as the spec groups them.
- `appendEvent(projectRoot, runId, event: NewForgeEvent, options?: AppendEventOptions): Promise<ForgeEvent>`
  — takes an explicit `projectRoot`, not just `runId` as an earlier draft of this line showed (the same
  "no implicit cwd" correction class as `@forge/vcs`'s own established convention); assigns the next
  gapless `seq`, redacts the payload (below), serialises, `fsync`s, then appends to
  `.forge/state/runs/<runId>/events.ndjson`. Never resolves before the fsync completes — this is the one
  guarantee every later resume piece trusts without re-checking. Returns the fully-assigned event
  (including its new `seq`), not `void` as an earlier draft of this line showed — a caller needs it to
  use as a later event's own `causedBy` without a redundant read. `AppendEventOptions` carries
  `redactPatterns`/`knownSecrets`, since this package has no config-loading machinery of its own to
  source them from otherwise.
- `readEvents(projectRoot, runId): AsyncGenerator<ForgeEvent>` — same explicit-`projectRoot` correction;
  streams the log back in order; a `seq` gap throws a typed, actionable `TelemetryError` (the same
  `core`-unreachable local-error shape `@forge/vcs` P1 uses — `telemetry ← schemas` only, no `core`
  edge) naming the gap (`18` §18.4: "seq gaps indicate corruption and trigger `forge doctor`" — this
  piece detects and reports the fact; `forge doctor` itself is a later milestone).
- `redactPayload(payload, patterns: readonly RegExp[], knownSecrets: readonly string[] = []): unknown` —
  a pure function: recursively walks the payload, replacing any string matching a pattern or exactly
  equal to a known secret value. `knownSecrets` defaults empty since full `${secret:name}` resolution
  (`20` §20.4) is not yet built anywhere in the dependency graph this piece can reach — the parameter
  exists so a future caller that *does* have resolved secret values can pass them in without this
  function's own shape changing.

**Checks:** appended events round-trip through `readEvents` byte-identically; `seq` is gapless and
monotonic across concurrent-looking appends (serialised internally, proven by a real concurrency test,
not an assumption); a payload containing a string matching a configured pattern is redacted before the
bytes ever hit disk (asserted by reading the raw file, not just the parsed return value); a payload
containing a known-secret string is redacted even when it matches no pattern; `fsync`-before-return is
proven by a kill-and-reread test (write, kill the process, reopen, confirm the event that returned
successfully is durably present) — this is the piece the crash-resume capstone (P20) will trust blindly,
so it earns its own direct proof here.

**Depends on:** nothing new.

*(P6 is committed: `abcb29c`. See `SPEC-QUESTIONS.md` Q68 and its critic-round/between-rounds/verify-round addenda —
sixteen findings across two rounds, more than any other single piece this milestone, concentrated in
crash-mid-write recovery and in the failure-handling code's own failure paths; see `GAUNTLET-LOG.md`'s own
entry for the fuller story, including a calibration note on a fix whose own doc comment had already named
the exact gap that shipped anyway.)*

---

## P7 — Cost ledger and budget projections

**Mandate:** `18` §18.4's `Cost` event group (`UsageRecorded`, `BudgetWarning`, `BudgetBreached`)
projected into the queryable ledger `20` §20.8 describes, plus the retry-attribution rule (a step retried
three times reports its total spend against the *originating* step, never split across attempts).

**Spec:** `18` §18.5's `ledger` table shape (abridged; the full SQLite projection with KB/artifact/
diagram tables is out of this milestone's scope — only the run-ledger columns are `telemetry`'s own
concern, the rest belongs to whichever package owns that projection); `06` §6.9 (three budget levels);
`20` §20.8 (ledger fields, enforcement points, retry accounting, runaway detection); `20` §20.10 S9.

**Surface:** `@forge/telemetry/ledger`
- `LedgerEntry` — the abridged row shape from `18` §18.5 (`runId, stepId, agent, model, platform,
  inputTokens, outputTokens, cacheReadTokens, costUsd, estimated, durationMs, ts`).
- `UsageRecordedPayload` — a `UsageRecorded` event's own payload shape (everything a `LedgerEntry` needs
  beyond what `ForgeEvent`'s own envelope already carries: `runId`/`stepId`/`agentId`/`ts`), not named in
  the plan's own original text — `18` §18.4 gives the event catalogue no payload shape at all.
- `projectLedger(events: AsyncIterable<ForgeEvent>): Promise<readonly LedgerEntry[]>` — a pure
  projection, per `18` §18.4's own "if a value cannot be derived from the log, it does not exist" —
  the ledger is *derived*, never independently written. Throws a `TelemetryError` for a `UsageRecorded`
  event missing/blank `stepId`/`agentId` or carrying a malformed payload (validated as a finite,
  non-negative number for each numeric field — not just `typeof x === 'number'`, which a critic round
  found accepts `NaN`/`Infinity`/negative values).
- `attributedSpend(entries, stepId): number` — sums every entry attributed to a step across all its
  retries, the `20` §20.8 "reports $6, not $2" rule made concrete.
- `checkBudget({ spent, cap, warningThreshold? }): 'ok' | 'warning' | 'breached'` — the pure decision
  function; the three enforcement *levels* (step/run/period) are each just this function called with a
  different `spent`/`cap` pair, wired in by `@forge/engine`'s own budget piece (P17), which owns the
  actual admission decision and pause/finish-lanes/abort response. `warningThreshold` (default `0.8`,
  not in the plan's own original signature) and the whole `'warning'` tier are this piece's own design —
  only the breach boundary is spec-given. Validates `spent`/`cap`/`warningThreshold` and throws rather
  than risk silently misclassifying a budget that is actually blown as `'ok'`.
- `RetryAttempt` (`{ totalTokens, progressed }`) — a bespoke type, not `LedgerEntry` reused; see
  `SPEC-QUESTIONS.md` Q69 design point 4 for why, including the acknowledged gap that nothing yet
  bridges `LedgerEntry[]` to `RetryAttempt[]`.
- `detectRunaway(attempts: readonly RetryAttempt[]): boolean` — not `detectRunaway(entries, stepId)` as
  the plan's own original signature showed: token consumption growing monotonically across retries with
  no accompanying file change or artifact (`20` §20.8's runaway-detection requirement) needs a per-attempt
  progress signal `LedgerEntry` (matching `18` §18.5's own fixed DB schema) has no column for.

**Checks:** a synthetic event stream with three retries of one step projects a ledger whose
`attributedSpend` sums all three, not the last one alone; `checkBudget` at exactly the cap boundary
reports `breached` (not `ok` — off-by-one is a real financial bug here); `detectRunaway` fires on a
constructed monotonic-growth-no-progress sequence and does not fire on a monotonic-growth-with-progress
one (the same shape, different outcome — the discriminator is the point of the test).

**Depends on:** P6.

*(P7 is committed: `039c997`. See `SPEC-QUESTIONS.md` Q69 and its critic-round/verify-round addenda — one root cause
(a bare `typeof x === 'number'` accepting `NaN`/`Infinity`/negative values) reached a budget-safety
decision from three independent angles at once, the sharpest single-root-cause finding this milestone; see
`GAUNTLET-LOG.md`'s own entry for the fuller story and its calibration note on searching for a validation
gap by *property* across every applicable field, not just by the one call site a bug report happened to
name.)*

---

## P8 — Workflow DSL: types, YAML parser, structural and referential validator

**Mandate:** `10` §10.1's workflow YAML shape as typed data, plus `forge workflow validate`'s own rule
set (unique step ids; no cycles among *static* `dependsOn`; `produces` globs well-formed; fanout `over`
resolves against a schema, not executed; every `gateEvidence` names a real gate) — against a
caller-supplied "what exists" oracle rather than a real registry, per `SPEC-QUESTIONS.md` Q62's
forward-dependency answer. Real workflow files (`build-stage.workflow.yaml` etc.) are `@forge/templates`
content (M6); this piece parses and validates *any* conforming YAML, proven against test-local fixtures.

**Spec:** `10` §10.1 (verbatim: the full worked example, the step-kind table, the Validation
subsection); `02` §2.1 (`yaml` with source-position retention — validation errors must cite a real
line/column, not just a field path).

**Surface:** `@forge/engine/workflow`
- `Workflow`, `WorkflowStep`, every `kind` variant (`agent | command | gate | elicit | session | fanout
  | merge | subworkflow | checkpoint | parallel | sequence`) as a discriminated union matching `10`
  §10.1's own fields per kind. Five kinds (`elicit`, `session`, `checkpoint`, `parallel`, `sequence`)
  have zero worked example anywhere in the spec pack — their own field shapes are this piece's own
  design; see `SPEC-QUESTIONS.md` Q70's own twelve design points, the largest single write-up this
  milestone.
- `parseWorkflow(yamlText): ParseResult` — a discriminated result carrying source positions on every
  error, via the `yaml` package's own CST (including schema-shape violations, not just top-level YAML
  syntax errors — a zod issue's own JSON path is resolved back to a real line/column), not a bare
  `JSON.parse`-shaped failure. Never throws, including on pathologically deep input (a `RangeError`-
  specific recovery path, `SPEC-QUESTIONS.md` Q70 design point 12) — confirmed the real entry point
  isn't reachable this way for any real YAML text, but hardened unconditionally regardless, since the
  underlying zod schema objects are also exported directly.
- `WorkflowExistenceOracle` — a caller-supplied `{ agentExists, briefExists, gateExists,
  artifactTypeExists, workflowExists }` interface (`briefExists` is a fifth method not in this plan's
  own original four-method text — `10` §10.1's own "Validation" subsection prose names five referenced
  things, not four); `validateWorkflow(workflow, oracle): readonly ValidationIssue[]` checks referential
  integrity against it (including `workflow.requires.gates_passed`/`.artifacts`, not just per-step
  fields) without needing a real registry to exist.
- `validateStructure(workflow): readonly ValidationIssue[]` — unique step ids (including a step with no
  `id` at all, a `missing-step-id` issue not in this plan's own original text), static-`dependsOn` cycle
  detection (fanout/templated deps are `@forge/engine`'s own plan-compiler's job, P10/P11 — this is the
  *declared*, unexpanded graph only), well-formed `produces` glob syntax. Both this and
  `validateWorkflow` guard against pathologically deep/wide input (`MAX_TRAVERSAL_DEPTH`), reporting a
  clean issue rather than crashing.

**Checks:** `10` §10.1's own worked example parses cleanly with zero validation issues given an oracle
that says everything it references exists (the example's own text needed one correction to actually be
valid YAML — `SPEC-QUESTIONS.md` Q70 design point 1); a duplicate step id, a static dependency cycle, a
malformed glob, and a `gateEvidence` naming a nonexistent gate each produce a distinct, correctly-located
issue; a parse error on genuinely malformed YAML cites the real source line.

**Depends on:** nothing new (first `engine` piece).

*(P8 is committed: `3365253`. See `SPEC-QUESTIONS.md` Q70 and its critic-round/between-rounds/verify-round addenda —
the largest piece this milestone by design surface, and the piece that found a genuine bug in the spec's
own worked-example text; see `GAUNTLET-LOG.md`'s own entry for the fuller story, including a calibration
note on a depth guard whose own first version, on firing, produced two thousand fabricated cycle reports
instead of the one honest "too deep to check" issue it existed to guarantee.)*

---

## P9 — Sandboxed expression evaluator

**Mandate:** `10` §10.1's own "tiny, sandboxed expression language (no `eval`)": dotted paths,
comparisons, `&&`/`||`/`!`, `in`, `length`, and the fixed helper set (`item`, `stage`, `run`, `config`,
`kb`, `failures`, `vars`). Hand-written parser per the spec's own stated preference ("~300 LOC... **Never**
use `new Function`"). This is the one mechanism every later piece that resolves a `{{...}}` template or a
`failOn:`/`when:` condition reuses — including `brief` resolution for M5's own stub agent steps
(`SPEC-QUESTIONS.md` Q62 part 2), so it is built early and deliberately kept dependency-free within
`engine`.

**Spec:** `10` §10.1 "Expressions" (verbatim); `10` §10.3's gate `failOn` examples (`"errors > 0"`,
`"undefined_refs > 0"`) and `onFailure.escalations[].when` (`"failures.test-failure > 2"`) as the two
concrete consumer shapes this piece must actually parse.

**Surface:** `@forge/engine/expr`
- `parseExpression(source): Expr` (a small AST — literal, path, comparison, logical, `in`, `length`
  call) or a typed parse error naming the offending token and position.
- `evaluate(expr: Expr, context: ExpressionContext): unknown` — `ExpressionContext` is the plain object
  carrying `item`/`stage`/`run`/`config`/`kb`/`failures`/`vars` as caller-supplied data; evaluation never
  touches the real filesystem, network, or global scope — proven by a test that poisons `globalThis`
  with a sentinel and asserts no expression can observe it.
- `resolveTemplate(template: string, context): string` — the `{{...}}` substitution `10` §10.1's own
  worked example uses (`vars.integration_branch`, `item.id`), built on `evaluate`, reused verbatim by
  fanout expansion (P10) and stub-agent brief resolution (Q62 part 2, wired in at P15).

**Checks:** every operator and helper in `10` §10.1's own list is exercised, including a nested-path
miss (`item.owner_role` when `item` has no such key) resolving to a typed "undefined path" outcome, not
a thrown JS error; the two real consumer expressions (`failOn`, `when`) evaluate correctly against a
constructed context; the sandbox-escape test (no access to `globalThis`, `process`, `require`, or
constructing a `Function`) is explicit, not incidental — this is a security-relevant piece even though
it lives in `engine`, not `adapter-kit`.

**Depends on:** nothing new.

*(P9 is committed: `cf30218`. See `SPEC-QUESTIONS.md` Q71 and its critic-round/verify-round addenda —
`10` §10.1's entire "Expressions" subsection is one paragraph with zero worked expression examples beyond
the two real consumer strings this piece had to parse, so the grammar, precedence, and literal-type rules
are this piece's own invention. Highest self-caught-bug density of the milestone so far (a precedence bug
and two prototype-pollution holes, all fixed before any critic was involved) alongside the critic round's
own most severe finding of the milestone — a documented "never throws" contract that was false via a flat,
non-nested-looking `&&`/`||` chain defeating the parser's own depth guard and crashing the evaluator
instead; see `GAUNTLET-LOG.md`'s own entry for the fuller story, including a verify-round finding on a
numeric-ordering helper whose own doc comment's "confirmed empirically" claim turned out to be wrong for
`null` and arrays.)*

---

## P10 — Plan compilation: DAG construction and fanout expansion

**Mandate:** `06` §6.2's `StepNode` as the compiled, runnable unit, and plan-compilation rule 1: expand
every `fanout` node over its collection, using the item's own id in the expanded step id so resume stays
stable across a re-compile (`06` §6.2: `${workflowId}:${stepId}[:${itemKey}]`).

**Spec:** `06` §6.2 (verbatim `StepNode` interface, rule 1); `10` §10.1's `generate-tests`/`implement`
fanout examples (`over: "stage.stories"`, `itemKey: "{{item.id}}"`, per-item `dependsOn`).

**Surface:** `@forge/engine/plan`
- `StepNode` — `06` §6.2's interface, transcribed exactly.
- `compileStepId(workflowId, stepId, itemKey?): string` — the stable id format, one function so every
  later piece that needs to reconstruct or parse a step id uses the same rule.
- `expandFanout(step: WorkflowStep, context): readonly StepNode[]` — resolves `over` via P9's evaluator
  against `context` (must resolve to an array — a non-array `over` is a typed compile error, per `10`
  §10.1's own Validation clause "fanout `over` resolves to an array"), instantiates one `StepNode` per
  item with `itemKey`/`dependsOn` templates resolved per-item via `resolveTemplate`.
- `compilePlan(workflow, context): readonly StepNode[]` — non-fanout steps pass through as a single
  node; fanout steps expand; this piece stops here — implicit dependencies and cycle detection are P11.

**Checks:** `10` §10.1's own `generate-tests`/`implement` example, given a constructed `stage.stories`
collection, expands into exactly one node per story with correctly resolved per-item `dependsOn`
(`"generate-tests:{{item.id}}"` → the *matching* item's own expanded id, not a different item's); a
non-array `over` fails compilation with a located, actionable error, not a runtime crash; expanded step
ids are stable — compiling the same workflow against the same context twice produces byte-identical ids.

**Depends on:** P8, P9.

*(P10 is committed: `5215030`. See `SPEC-QUESTIONS.md` Q72 and its critic-round/verify-round addenda —
`06` §6.2's own one illustrative `StepNode` interface turned out to be incomplete against the fuller spec
text it's compiled from in three separate ways (missing the `checkpoint` kind, missing every non-agent
kind's own way to carry its real runtime data, naming three field types this milestone has no real package
behind); the highest BLOCKING-finding density of the milestone so far — three in the critic round, a
fourth in the verify round when that very round's own fix regressed an already-documented design decision
made earlier in the same file. See `GAUNTLET-LOG.md`'s own entry for the fuller story, including a
calibration note on why "test the fix more" wasn't the right lesson this time — the fix needed the file's
own existing doc comments re-checked against, not just the bug report that motivated it.)*

---

## P11 — Plan compilation: implicit dependencies, cycle detection, critical path

**Mandate:** plan-compilation rules 2–6: insert implicit dependencies from contract freeze (`06` §6.6)
and from resource-claim overlap (`06` §6.7's *scheduling-time* interval map — see `SPEC-QUESTIONS.md`
Q62's sixth note for why this half of §6.7 lives here and the enforcement half lives in `@forge/vcs`
P4); insert gate nodes; topologically sort, rejecting cycles with a rendered Mermaid graph; compute
critical path and estimated cost.

**Spec:** `06` §6.2 rules 2–6 (verbatim); `06` §6.6 (contract freeze → implicit ancestor edges); `06`
§6.7 (interval map, ambiguous-exclusive-claim rejection); `10` §10.1 (gate node dependency: "a gate
depends on everything in its phase").

**Surface:** `@forge/engine/plan` (extending P10's module)
- `insertContractDependencies(nodes): readonly StepNode[]` — any node whose `outputs` includes an
  `InterfaceContract`-typed `OutputContract` becomes an ancestor of every node whose `inputs` reference
  that same contract by name.
- `buildClaimIntervalMap(nodes): ClaimIntervalMap` — `produces` glob overlap detection; two overlapping
  `shared` claims serialise (an implicit edge); two overlapping `exclusive` claims reject compilation as
  ambiguous, per `06` §6.2 rule 3's own wording.
- `detectCycles(nodes): { cycle: readonly string[] } | undefined` plus `renderCycleAsMermaid(cycle):
  string` — `06` §6.2 rule 5's own "reject cycles with a rendered Mermaid graph showing the cycle."
- `computeCriticalPath(nodes): { path: readonly string[]; estimatedCost: number }` — using each node's
  own `limits.maxCostUsd` as its cost estimate (no real cost history exists yet to do better).
- `compileRunPlan(workflow, context): CompileResult` — the full pipeline: P10's `compilePlan` → gate-node
  insertion → contract/claim implicit deps → topological sort/cycle check → critical path. The one
  public entry point everything downstream (scheduler, gate evaluation, resume) actually calls.

**Checks:** a contract-freeze producer/consumer pair gets the correct implicit edge without an explicit
`dependsOn`; two `shared`-claim steps on overlapping globs serialise; two `exclusive`-claim steps on the
same glob reject compilation with a specific, actionable error (not a generic "ambiguous" string); a
constructed 4-node cycle is detected and its rendered Mermaid output contains all four node ids in cycle
order; critical path on a diamond-shaped DAG picks the longer of two paths, proven by cost, not just
length.

**Depends on:** P10.

*(P11 is committed: `9ae8e78`. See `SPEC-QUESTIONS.md` Q73 and its critic-round/verify-round addenda —
rule 4's own "a gate depends on everything in its phase" turned out to be unbuildable as stated (`phase`
names one of `10` §10.2's own ten lifecycle phases, with no field anywhere on this milestone's own
`WorkflowStep`/`StepNode` to compute it from), documented as a deliberate gap rather than faked. The critic
round's own six findings all turned out to be P10-piece bugs, only surfaced by this piece's first attempt
to run that compiler's output through a full pipeline — fixed at the root there, recorded in `Q72`'s own
addenda, not in this piece's own code. This piece's own two new mechanisms (Mermaid cycle rendering, bounded
produces-glob overlap detection) needed a full verify round of their own; see `GAUNTLET-LOG.md`'s own entry
for the fuller story, including a calibration note on a fix that was checked against a real, independent
parser and still shipped wrong, because "does it parse" and "does it preserve what I meant" are different
questions.)*

---

## P12 — Scheduler core: ready set, ordering, concurrency limits

**Mandate:** `06` §6.3's ready-set computation and four-level ordering tiebreak, plus the three
concurrency-limit classes (global, per-agent/exclusive, per-resource-class) and adapter-reported
`maxConcurrentSessions`. **Must be deterministic given a seed** — this milestone's own second acceptance
criterion, and `21` §21.1's own explicit "a flaky scheduler test means the scheduler is non-deterministic,
which is a bug in the scheduler."

**Spec:** `06` §6.3 (verbatim: ready set, ordering rules 1–4, concurrency limits, admission-control
line — admission control itself is P17); `21` §21.1 (determinism mandate); `21` §21.3 "Scheduling:
ready-set ordering under a fixed seed."

**Surface:** `@forge/engine/scheduler`
- `computeReadySet(nodes, statuses, runningClaims): readonly StepNode[]` — deps `succeeded`, resource
  claims not conflicting with anything currently running.
- `orderReadyNodes(ready, nodes, seed): readonly StepNode[]` — the four-level tiebreak: unblocks-most-
  downstream-work, on-critical-path (from P11's own `computeCriticalPath`), lowest-estimated-cost,
  stable `seed`-plus-node-id tiebreak (a seeded, pure hash — no `Math.random`, per this whole build's own
  determinism rule).
- `ConcurrencyLimits` — `{ global, perAgent: Map<AgentId, number>, perResourceClass: Map<string,
  number>, adapterMax?: number }`; `admitsMoreConcurrency(limits, runningCounts): boolean` per class.
- `Scheduler` — the stateful coordinator wrapping the above into one `next(): readonly StepNode[]` call
  per scheduling tick, given the current run state.

**Checks:** given a fixed seed and a fixed plan, `orderReadyNodes` produces byte-identical output across
1000 repeated calls and across two separate process invocations (not just within one run — determinism
that only holds within a single process is not the guarantee this claims); an `exclusive` agent's second
ready step is never admitted while the first of that agent runs; the four-level tiebreak is proven with
a constructed case where each of the four rules is individually the deciding factor (four separate
tests, not one that happens to exercise all four incidentally).

**Depends on:** P11.

*(P12 is committed: `2e2a04c`. See `SPEC-QUESTIONS.md` Q74 and its critic-round/verify-round addenda —
before either round, three of this piece's own four rule-isolation tests were self-caught and fixed, all
traced to one wrong belief (held since P11, written into two files' worth of doc comments) about
`computeCriticalPath`'s own tie-break for a genuine cost tie: it is topological *depth* first, not plain
declaration order, corrected in both places. The critic round found one BLOCKING bug native to this piece
(duplicate `StepNode` ids silently defeating live concurrency/claim tracking, closed with a new `RUN-036`)
plus two bugs in P11's own `critical-path.ts`; the verify round found this piece's own cost-ordering rule
had no `NaN` guard of its own despite `critical-path.ts` just having learned that exact lesson one file
over — fixed by reusing that fix's own helper, except the reuse alone wasn't enough (a subtraction-based
comparator still produces `NaN` from `Infinity - Infinity`), caught and fixed one layer deeper while
writing that fix's own regression test, before any test run. See `GAUNTLET-LOG.md`'s own entry for the
fuller story and its calibration note on why a helper correct in the context it was built for does not
stay correct across every context that reuses it.)*

---

## P13 — Backpressure

**Mandate:** `06` §6.3's own backpressure rule: on an adapter rate-limit signal, halve effective
concurrency (floor 1), restore additively after a quiet period. Small and self-contained enough to be
its own piece — a pure state machine over a signal stream, independently valuable to fuzz with many
signal timings without the rest of the scheduler in the way.

**Spec:** `06` §6.3 (verbatim: "reduce effective concurrency multiplicatively (halve, floor 1) and
restores it additively after a quiet period. This is required for real-world usability at concurrency >
2."); `21` §21.3 "backpressure on simulated rate limits (concurrency halves, then recovers)."

**Surface:** `@forge/engine/backpressure`
- `BackpressureState` — current effective concurrency ceiling, quiet-period timer state.
- `onRateLimitSignal(state, now): BackpressureState` — halves (floor 1).
- `tick(state, now): BackpressureState` — additive restoration once the quiet period has elapsed with no
  further signal; `now` is injected (no `Date.now()`), matching this whole build's determinism rule.
- Wired into P12's `Scheduler` as one more input to `admitsMoreConcurrency`'s global limit.

**Checks:** a rate-limit signal at concurrency 8 drops the ceiling to 4, a second immediate signal to 2,
never below 1; with no further signal, the ceiling climbs back additively at the documented rate once
the quiet period elapses, verified with an injected clock, not real wall-clock sleeps.

**Depends on:** P12.

*(P13 is committed: `8c59010`. See `SPEC-QUESTIONS.md` Q75 and its critic-round/verify-round addenda — the
one change to the already-committed P12 `Scheduler` this piece required was making its `limits` field
mutable, with a new `setLimits` method, so a caller can feed a dynamically-changing ceiling in between
ticks. The critic round found and fixed 1 BLOCKING (a doc comment's own "nothing depends on `now` being
monotonic" claim was empirically false — a later call with a smaller `now` than an earlier one silently
regressed the ceiling), 2 MAJOR (a signal halving a cached ceiling value that goes stale without an
intervening tick; a non-finite clock reading able to permanently corrupt the state with no self-healing),
and 1 MINOR issue. The verify round then found a NEW BLOCKING bug inside round 1's own fix — a signal's own
recorded timestamp could itself drift backward across two signals, silently inflating a later tick's own
restoration math and, in the sharpest repro, fully erasing an active backpressure state back to unrestricted
concurrency after only two signals and one ordinary tick — fixed locally, no third round. See
`GAUNTLET-LOG.md`'s own entry for the fuller story and its calibration note on why "does this fix resolve
its own finding" and "did this fix move the same problem to an adjacent field" are different questions.)*

---

## P14 — Gate evaluation

**Mandate:** `10` §10.3's gate mechanism, generically: given *any* gate definition (deterministic checks
+ advisory checks), run the deterministic checks' declared commands, parse their output per the declared
parser/`failOn` expression (via P9's evaluator), never fail on an advisory result, handle waivers (reason
+ owner + expiry, required — never a bare override), and emit a `GateReport`. Real gate *content*
(`G-Design`'s own specific checks) is M6; this piece proves the mechanism against a trivial fixture gate.

**Spec:** `10` §10.3 (verbatim: the full gate YAML shape, the five normative gate rules, `openQuestions
Policy`); `18` §18.7 (`GateReport` artifact type registry entry — this piece emits the *data*, artifact
file writing is `@forge/core`'s already-built front-matter writer, not reinvented here).

**Surface:** `@forge/engine/gates`
- `GateDefinition`, `DeterministicCheck`, `AdvisoryCheck` — `10` §10.3's own shape.
- `CheckRunner = (check: DeterministicCheck, cwd: string) => Promise<{ stdout: string; exitCode:
  number }>` — caller-supplied (a real `execa` wrapper in production, a scripted stub in tests), so this
  piece has no opinion on what `forge spec validate --json` means, only on how to interpret its declared
  `parser`/`failOn`.
- `evaluateGate(gate, cwd, runner): Promise<GateEvaluationResult>` — runs every deterministic check,
  evaluates `failOn` against the parsed output, collects advisory results separately (never affecting
  pass/fail per rule 2), applies `openQuestionsPolicy`.
- `Waiver` — `{ reason: string; owner: string; expiresAt: string }`; `applyWaiver(result, waiver):
  GateEvaluationResult` — refuses (typed error, not a silent no-op) a waiver missing any of the three
  fields, or one already expired.
- `buildGateReport(gate, result): GateReport` — the artifact payload rule 4 requires ("the exact command
  output — this is the audit trail").

**Checks:** a gate with one passing and one failing deterministic check fails overall, and the report
names which check failed with its real command output; an advisory check's own failure never flips the
gate's pass/fail (rule 2, proven with a gate whose only "failing" check is advisory); a gate cannot be
approved with a failing deterministic check present, only waived (rule 1) — attempting to mark it
approved without a waiver is a typed refusal, not a state the API even allows constructing; a waiver
missing `expiresAt` is refused; a gate re-evaluated twice with identical inputs produces an identical
report (rule 3, idempotent).

**Depends on:** P8, P9.

*(P14 is committed: `ccf9c42`. See `SPEC-QUESTIONS.md` Q76 and its critic-round/verify-round addenda —
`GateDefinition` deliberately models only `id`/`checks`/`openQuestionsPolicy`, not the full worked-example
YAML, a scope choice explained there. Two full rounds were needed to actually close "a gate cannot be
approved without a real waiver" against plain, unbranded data: the critic round found and fixed a doc
comment's false claim that no bypass existed (a hand-built result could claim an unvalidated waiver), fixed
by a shape-validity re-check; the verify round then found that fix was still incomplete (shape alone cannot
tell a legitimately-applied-but-now-stale waiver apart from one fabricated with an already-past expiry from
the start), closed by sealing the real validation moment onto the result (`waiverAppliedAt`) so approval can
be re-derived by comparing two already-present fields rather than re-asking a live clock — required, not
just preferred, to keep this piece's own idempotence guarantee intact. Also fixed: a waiver-applying
function attaching the caller's own mutable object instead of a frozen copy, and a Unicode-whitespace gap in
blank-field detection. See `GAUNTLET-LOG.md`'s own entry for the fuller story and its calibration note on
why a stability-over-time check needs evidence sealed onto the data, not a fresh clock reading.)*

---

## P15 — Step execution dispatch (lane runner)

**Mandate:** the piece that actually *runs* a `StepNode` — dispatching on `kind` to the right handler
and wiring together every package this milestone builds: `agent`/`command` steps run in a lane
(`@forge/vcs` P2/P3) or inline; `agent` steps invoke a `PlatformAdapter` session (`@forge/adapter-kit`,
M4) with a minimally-resolved prompt (`SPEC-QUESTIONS.md` Q62 part 2's stub-agent shape, using P9's
`resolveTemplate` for `brief`); `gate` steps call P14; `merge` steps call `@forge/vcs` P5; on completion,
claim enforcement (`@forge/vcs` P4) runs before a lane is handed anywhere else. Every transition emits
the matching `18` §18.4 event via `@forge/telemetry` P6, *before* the side-effect it authorises, per the
write-ahead-log discipline this whole package's own resumability rests on.

**Spec:** `10` §10.1's step-kind table (verbatim); `06` §6.4 (lane lifecycle steps 2–4: run session,
agent commits, success→merge-queue/failure→keep-for-inspection); `18` §18.4 (`Lane`/`Adapter`/`Step`
event groups — which event, at which transition); `20` §20.10 S1 (claim enforcement wired in here, not
skippable).

**Surface:** `@forge/engine/dispatch`
- `AgentId` — branded string (Q62 part 2: opaque for M5, no registry).
- `executeStep(node, ctx: { adapter: PlatformAdapter; vcs: VcsFacade; telemetry: TelemetryFacade;
  gates: GateEvaluator; mergeQueue: MergeQueueFacade }): Promise<StepOutcome>` — the one function P12's
  scheduler calls for every admitted node; `ctx`'s facades are the seam that makes this testable against
  `@forge/testkit`'s `FakePlatformAdapter` and an in-memory/tmp-dir `vcs`, without a mock framework.
- Per-kind handlers (`runAgentStep`, `runCommandStep`, `runGateStep`, `runMergeStep`,
  `runCheckpointStep`) — each emits its own `StepStarted`/`...Succeeded`/`...Failed` pair and any
  kind-specific events (`SessionStarted`/`SessionEnded` for agent; `GateEvaluated` for gate;
  `MergeQueued`/`MergeCompleted` for merge).
- `StepOutcome` — the raw result P16 (failure classification) and P12 (re-scheduling) both consume.

**Checks:** an `agent` step runs a real `FakePlatformAdapter` session inside a real tmp-dir lane and its
`SessionResult` becomes the step's own outcome; a `command` step with `inline: true` never creates a
lane; claim enforcement runs on every `agent`/`command` step completion, proven by an out-of-claim write
being reverted through this entry point (not just through P4's own unit tests in isolation); the full
event sequence for one successful agent step matches `18` §18.4's own catalogue exactly, in order, with
`StepStarted` demonstrably written (fsync'd) before the adapter session is ever started — proven by
injecting a failure *between* the event write and the session start and confirming the event alone
survives.

**Depends on:** P2, P3, P4 (vcs); P5 (vcs); P6 (telemetry); P9, P11, P14 (engine); `@forge/adapter-kit`
and `@forge/testkit` (M4, already built).

*(P15 is committed: `1f21dea`. See `SPEC-QUESTIONS.md` Q77 and its critic-round/verify-round addenda —
the largest, most integration-heavy piece in M5 so far. A fresh critic round found one BLOCKING bug (a
real merge conflict under the spec's own default `'agent'` conflict policy — with no resolver mechanism
built yet, which describes every real configuration of that policy this milestone can produce — could
throw a raw `VcsError` straight out of `executeStep` instead of resolving to failed-outcome data, the
exact "never throw for a genuine runtime failure" contract this whole module otherwise holds) plus six
MAJOR findings (a crash mid-session discarding real file writes; an early lane failure misreporting its
own step kind; a claim-enforcement revert commit invisible to the event log; a dead error-provenance
construction; a multi-lane merge silently discarding every lane's outcome but the first; a real,
registered `LaneRemoved` event never emitted; gates evaluating against the wrong directory relative to
where a merge actually lands its result; and this module never emitting the `StepSucceeded`/`StepFailed`
events `18` §18.4 registers and nothing else in the milestone's own built pieces emits either). A
scoped verify round independently reconfirmed all ten fixes, found and closed one further, genuinely
untested gap, and fixed one stale test comment. Also resolved along the way: a genuine gap in the
package boundary graph (`engine → testkit`, needed for this piece's own tests against a real
`FakePlatformAdapter`, previously undeclared anywhere), and a real production bug caught while closing
this piece's own coverage (a `command` step's own change-detection unconditionally assumed `true`
regardless of whether the command actually touched any files). See `GAUNTLET-LOG.md`'s own entry for the
fuller story and its calibration note on why this piece's own integration scale is what let a genuinely
blocking bug survive local, mechanical verification entirely.)*

---

## P16 — Failure classification, retry, and anti-thrash

**Mandate:** `06` §6.8's classification table mapped to concrete handling, the `RetryPolicy` interface,
the never-retry rule (two identical error signatures force escalation, not a third identical attempt).

**Spec:** `06` §6.8 (verbatim: `RetryPolicy`, the full classification table, the never-retry rule); `21`
§21.3 "Failure classification: each class... routes to its documented handling" and "Anti-thrash: two
identical normalised fix diffs force escalation rather than a third attempt."

**Surface:** `@forge/engine/failures`
- `FailureClass` — the nine-member union from `06` §6.8's table.
- `classifyFailure(outcome: StepOutcome): FailureClass` — a step's raw `StepOutcome` (P15) mapped to its
  class per the table's own examples (adapter error codes, exit codes, timeout markers).
- `normaliseErrorSignature(outcome): string` — a stable hash of the *normalised* error (strips
  timestamps/paths/session ids so two runs of the identical underlying bug hash identically), the input
  the never-retry rule compares.
- `decideRetry(policy: RetryPolicy, attemptHistory): 'retry' | 'escalate'` — applies `maxAttempts`,
  `retryOn`, and the never-retry override (two matching signatures in `attemptHistory` forces
  `'escalate'` regardless of remaining attempts).
- `computeBackoff(policy, attemptNumber): number` — exponential with jitter within `[initial, max]`, a
  seeded jitter source (determinism rule), not `Math.random()`.

**Checks:** each of the nine classes in `06` §6.8's own table routes to its documented default handling,
one test per class; two attempts with the identical normalised signature escalate on the would-be third
try even though `maxAttempts` isn't yet exhausted; two attempts with *different* signatures (a genuinely
different failure each time) do not trigger the never-retry override; backoff values fall within
`[initial, max]` across many seeded draws and are reproducible for a fixed seed.

**Depends on:** P15.

*(P16 is committed: `100ff6b`. See `SPEC-QUESTIONS.md` Q78 and its critic-round/verify-round addenda — the
classification mapping (`classifyFailure`) is almost entirely invented: `06` §6.8's own table gives one
illustrative example per class, not a real mapping from P15's own `StepFailureInfo.source`/`.code`
vocabulary, the finest-grained "spec silence" this build has hit in one piece so far. Required one small,
well-justified change to the previous piece's own already-committed code: three new structured failure
codes added to P15's `runMergeStep` so this piece's classifier does not have to sniff free-text messages
to tell the three real merge failure modes apart (`Q77`'s own "the next piece reveals the previous piece's
own signature needs adjusting" pattern, again). A fresh critic round found a real bug in
`normaliseErrorSignature`: the original path-normalisation replaced an entire absolute path token with one
fixed placeholder, discarding the filename and `:line:col` that usually distinguish one real bug from a
different one — since the never-retry rule keys entirely off this signature, and almost every real
compiler/lint/test error message references an absolute path, this risked forcing escalation after two
genuinely *different* bugs, not two identical ones. Fixed by keeping a path token's own final segment; a
scoped verify round then found that fix still incomplete for two files sharing a basename and line:col in
different directories (plausible in this very monorepo, which has several `errors.ts`/`index.ts` files
across packages), closed by preserving two trailing segments instead of one and explicitly documenting the
result as a bounded heuristic, not a complete fix — no fixed segment count can fully resolve "how many
segments are the variable machine-specific prefix vs. the meaningful project-relative path" without
knowing the real project root. See `GAUNTLET-LOG.md`'s own entry for the fuller story and its calibration
note on why both rounds' fixes are honest about being approximations rather than claiming completeness.)*

---

## P17 — Budgets and admission control

**Mandate:** `06` §6.9's three budget levels made real: admission control refuses to launch a step whose
`maxCostUsd` the remaining run budget can't cover (not detected after the fact); period budgets block
new runs until reset; breach response is pause/finish-lanes/abort, never silent continuation. Built on
`@forge/telemetry` P7's own pure `checkBudget`/`attributedSpend`.

**Spec:** `06` §6.9 (verbatim); `20` §20.8 (enforcement-points table, "admission control before launch,
not detection after the fact"); `20` §20.10 S9.

**Surface:** `@forge/engine/budget`
- `BudgetState` — `{ perRunUsd, perStepUsdDefault, dailyUsd, onBreach }` plus live spend, sourced from
  `@forge/telemetry` P7's ledger projection.
- `canAdmit(node, budgetState): boolean` — the scheduler's own pre-launch gate (P12's `Scheduler` calls
  this as part of `admitsMoreConcurrency`); a step is inadmissible the instant its own `maxCostUsd` plus
  current spend would exceed `perRunUsd`.
- `onBudgetBreach(level: 'step' | 'run' | 'period', state, policy): BreachResponse` — `pause` halts new
  admissions but lets in-flight lanes continue; `finish-lanes` is the same, explicitly named so a caller
  can distinguish "no new work" from "abort in-flight work" (`abort`, which also terminates running
  lanes — this piece signals the decision, P15/P12 carry it out).

**Checks:** a step whose `maxCostUsd` would push run spend over `perRunUsd` is refused admission before
it ever starts, not detected mid-run; a period (`dailyUsd`) breach blocks a *new* run's very first
admission; `pause` and `finish-lanes` are distinguished in their returned response, not conflated;
retried attempts of one step are correctly attributed (reusing P7's own `attributedSpend`) so budget
tracking never double- or under-counts a multi-attempt step.

**Depends on:** P12 (engine), P7 (telemetry).

*(P17 is committed: `1cde256`. See `SPEC-QUESTIONS.md` Q79 and its critic-round/verify-round addenda — a
fresh critic round found a real bug: the period (daily) budget check did not project the candidate step's
own cost forward the way the run-level check right beside it already did, so a step whose own cost alone
would blow through the daily cap was admitted anyway, the breach only caught later — exactly the
"detection after the fact" this piece exists to prevent. Fixed by mirroring the run-level check's own
projection. The critic round also surfaced a genuine, spec-silent architectural question: should a period
breach also gate an already in-flight run's own future admissions, or only new run launches, since `06`
§6.9/`20` §20.8 only ever say "new runs refused"? Resolved with a documented, conservative default (keep
the check unconditional, favouring "cost is a safety property" over "an already-running run gets a pass")
rather than decided silently either way — a scoped verify round independently confirmed both the fix and
the reasoning, and closed one further MINOR gap (a caller cannot tell which of the two checks refused a
given call) via documentation rather than a signature change. Required one small, well-justified change to
the previous piece's own already-committed `Scheduler` (P12): a new, optional `canAdmit` constructor
parameter defaulting to always-admit, matching the identical "two mutually unaware modules" seam `setLimits`
already established for `@forge/engine/backpressure`. See `GAUNTLET-LOG.md`'s own entry for the fuller story
and its calibration note on why the bug was easy to miss precisely because the two checks looked so
parallel.)*

---

## P18 — Resumability: run-state reconstruction

**Mandate:** `06` §6.10 step 1 — reload the event log, rebuild run state — as one pure, deterministic
function. Separated from resume *orchestration* (P19) deliberately: this is pure data-in/data-out logic
with no side effects, valuable to exhaustively fuzz-test over many event-sequence permutations without
any of P19's real filesystem/git machinery in the way.

**Spec:** `06` §6.10 step 1 (verbatim); `18` §18.4 ("the TUI, the ledger, the index and all reports are
projections of this log — if a value cannot be derived from the log, it does not exist" — `RunState`
itself is exactly this kind of projection).

**Surface:** `@forge/engine/resume`
- `RunState` — per-step status (`scheduled | running | succeeded | failed | aborted | escalated`),
  per-lane status, the compiled plan reference, live budget spend, and — critically — which
  `StepStarted` events have no matching terminal event (`06` §6.10 step 2's own input).
- `reconstructRunState(events: AsyncIterable<ForgeEvent>): Promise<RunState>` — folds the full event
  catalogue (`18` §18.4) into `RunState`, one reducer case per event type, exhaustive (no `default`
  case, matching this whole codebase's own established `switch-exhaustiveness-check` discipline) so a
  future new event type is a compile error here, not a silent no-op.

**Checks:** replaying a hand-constructed event sequence covering every event group in `18` §18.4's own
catalogue produces the exact expected `RunState`; a sequence with a `StepStarted` and no terminal event
correctly surfaces that step as in-flight-and-unresolved; replaying the same sequence twice produces
byte-identical `RunState` (determinism); replaying an empty log produces a well-defined initial state,
not a thrown error.

**Depends on:** P6 (telemetry), P11 (compiled plan shape).

*(P18 is committed: `835421f`. See `SPEC-QUESTIONS.md` Q80 and its critic-round/verify-round addenda —
confirmed directly against `@forge/telemetry`'s own real source that `06` §6.10's own step-transition
diagram names a `StepAborted` event never actually registered in the real event catalogue, so a run-level
`RunAborted` cascades to every step not already terminal-or-skipped instead; added a `'skipped'` status the
plan's own literal 6-value enum bullet was missing, a real registered `StepSkipped` event with no home in
it otherwise. A fresh critic round found two real bugs: a `RunPlanned` reducer case that silently discarded
a previously-recovered plan reference the moment a later event had a malformed payload — the opposite of
its own documented leniency, in exactly the "partially-written trailing line after a crash" scenario this
piece exists to survive — and a test-support constant whose own doc comment claimed an exhaustiveness
guarantee that was never actually wired up anywhere in the test suite (confirmed empirically: removing a
real event type from it caused neither a compile error nor a test failure). Both fixed — the second via a
`Record<EventType, true>` object literal, giving a genuine, directly-verified bidirectional compile-time
guarantee (TypeScript itself now refuses to compile if the list and the real event catalogue ever
disagree, in either direction). A scoped verify round independently confirmed both fixes with no new
findings. See `GAUNTLET-LOG.md`'s own entry for the fuller story and its calibration note on the two
different shapes "the doc comment was wrong" took in this one piece.)*

---

## P19 — Resumability: resume orchestration

**Mandate:** `06` §6.10 steps 2–4: for each unresolved `StepStarted`, resume the adapter session if
supported and still valid, else roll the lane worktree back to its last FORGE commit (or lane base) and
re-run from the step's own `idempotencyKey`; re-validate every artifact produced so far (surfacing a
hand-edit mismatch as a reconciliation prompt — the prompt *content* is produced here, presentation is a
later milestone's TUI/CLI concern); re-enter the scheduler loop. This is M5's own defining criterion.

**Spec:** `06` §6.10 steps 2–4 (verbatim); `06` §6.2's own `idempotencyKey` field ("used for resume");
`20` §20.10 S12 (no orphaned processes/worktrees blocking resume — this piece is where that guarantee is
actually discharged, using `@forge/vcs` P2's `listOrphanedWorktrees`).

**Surface:** `@forge/engine/resume` (extending P18's module)
- `decideResumeStrategy(step, session, adapterCapabilities): 'resume-session' | 'reroll'` — pure
  decision function: session-resume capability present *and* the session id still resolvable.
- `rollbackLaneToBase(handle, lastKnownGoodCommit): Promise<void>` — wraps `@forge/vcs`'s own worktree
  primitives (P2); "roll back" is a real `git reset --hard` *scoped to the lane worktree only* (never
  the integration branch — `20` §20.2 point 4's own "never rewrites published history" applies here,
  the lane branch is disposable, integration is not).
- `revalidateArtifacts(runState, projectRoot): readonly ReconciliationIssue[]` — re-reads and re-
  validates every artifact the reconstructed `RunState` says a resumed run has produced, using
  `@forge/core`'s already-built artifact reader/validator (M1) — a genuine, already-satisfiable
  dependency, not a forward reference.
- `resumeRun(runId, ctx): Promise<RunState>` — the full orchestration: `reconstructRunState` (P18) →
  reclaim orphaned worktrees (`@forge/vcs` P2) → per-unresolved-step strategy decision and execution →
  artifact reconciliation → hand control back to P12's `Scheduler`.

**Checks:** a resumed step whose adapter reports session-resume support and a still-valid session id
resumes without re-running any prior work, proven via the fake adapter's own remembered-state; one whose
session is invalid rolls the lane back and re-runs from the idempotency key, proven by real file content
in the lane before/after; a hand-edited artifact between the kill and the resume surfaces as a
reconciliation issue naming the specific mismatch, not a silent overwrite in either direction; an
orphaned worktree left by a killed process is reclaimed on resume rather than left to accumulate.

**Depends on:** P18, P16, P17, P2 (vcs).

---

## P20 — Crash-resume and scheduler-determinism capstone

**Mandate:** the milestone's own literal exit tests, at the scope `SPEC-QUESTIONS.md` Q62 part 4
establishes: an engine-level E3 (no CLI, no real workflow content) proving "resume completes; final
state identical to an uninterrupted run; no duplicated commits, artifacts or ledger entries" for a
locally-defined fixture workflow exercising every step kind this milestone built, run against
`@forge/testkit`'s `FakePlatformAdapter`. This piece is almost entirely tests and fixtures — the
"production code" it adds is the small harness gluing every earlier piece into one runnable engine
entry point, which every later milestone's own CLI/TUI will eventually call too.

**Spec:** `06` §6.10 ("A crash-resume test... at 20 randomised points... is a required CI test", verbatim);
`21` §21.2 (fixture-project conventions — a new `fixtures/mid-run-equivalent/` or in-package fixture,
since the real `21.2` `mid-run/` fixture is described in terms of a real run this milestone can't yet
produce end-to-end via the CLI); `21` §21.3 E3's own row (verbatim: "SIGKILL at 20 randomised points...
final state identical... no duplicated commits, artifacts or ledger entries"); `21` §21.1 (determinism
mandate, for the scheduler-determinism half of this piece).

**Surface:** `@forge/engine/index` (the package's own public entry point, assembled here for the first
time) plus `packages/engine/test/e2e/`
- `runEngine(workflow, context, ctx): Promise<RunState>` — compiles (P8/P10/P11), then drives P12's
  scheduler + P15's dispatch to completion, emitting the full event stream through P6.
- A fixture workflow (test-local, per Q62 part 3) with at least one of every step kind this milestone
  handles: `agent` (fanned-out over a small collection), `command` (inline), `gate` (a trivial
  always-evaluable gate), `merge`.
- The crash-resume test: spawn `runEngine` as a real child process (so `SIGKILL` is a genuine process
  kill, not a simulated one — `21`'s own "SIGKILL" is literal), kill it at 20 randomised points across
  repeated runs with different seeds, then call `resumeRun` (P19) in a fresh process against the same
  `runId` and assert: identical final `RunState` to an uninterrupted control run of the same seed;
  identical final ledger entries (no duplicate `UsageRecorded`); identical final commit set on
  integration (no duplicate merges); zero orphaned worktrees or processes afterward (`20` §20.10 S12).
- The scheduler-determinism test: the same fixture workflow compiled and run to completion twice with
  the same seed produces byte-identical scheduling order and final state, and a *different* seed is
  proven capable of producing a *different* (but still valid) order — determinism is not the same claim
  as "the scheduler ignores the seed," and both halves are tested.

**Checks:** the two exit-test greps this milestone claims (`"E3 crash-resume"`, `"scheduler
determinism"`) both exist as real, passing, non-trivial tests under these exact names; the crash-resume
test genuinely kills a real process (verified by asserting the child's own PID stops existing, not by
trusting a promise resolved) at all 20 points across a full run, not just one; every M5 package's own
piece-level tests (P1–P19) remain green — this piece adds no new escape hatches, only glues existing,
already-proven pieces together.

**Depends on:** every prior piece (P1–P19).
