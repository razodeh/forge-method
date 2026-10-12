# 18 — Persistence, Configuration and Canonical Schemas

This file is the reference the other specs point at when they say "conforming to the schema". Where
another spec shows a fragment, this file is authoritative for the whole shape.

## 18.1 Storage tiers

| Tier | Location | Committed | Rebuildable | Purpose |
|---|---|---|---|---|
| **Artifacts** | `<project>/docs/forge/**` | ✅ yes | ❌ no — source of truth | KB, specs, plans, sessions, reports |
| **Customization** | `<project>/.forge/overrides/**`, `config.yaml` | ✅ yes | ❌ no — source of truth | Team-owned configuration |
| **Personal** | `.forge/overrides.local/**`, `config.local.yaml`, `secrets.local.yaml` | ❌ gitignored | ❌ no | Per-developer overrides |
| **Resolved set** | `.forge/{agents,workflows,frameworks,templates,checks,skills}/` | ❌ gitignored | ✅ yes (`forge compile`) | Compiled customization layers |
| **Run state** | `.forge/state/**` | ❌ gitignored | partially | Event log (truth for runs), index, caches (lane/integration worktrees live outside the project tree entirely, post-v1.0 `specs/22` M17 — see 18.3) |

**Invariant:** deleting `.forge/state/` and `.forge/<resolved dirs>` must leave a project fully
functional after `forge compile`. Only completed-run history is lost, and that history is
additionally summarised into committed artifacts (`reports/`), so nothing durable lives only in
gitignored space.

## 18.2 Full on-disk layout

```
<project>/
├─ .forge/
│  ├─ config.yaml                    committed team config
│  ├─ config.local.yaml              gitignored personal overrides
│  ├─ secrets.local.yaml             gitignored, mode 0600
│  ├─ manifest.yaml                  installed version, modules, overlay bundles, file checksums
│  ├─ overrides/                     committed customization (see 15)
│  ├─ overrides.local/               gitignored personal customization
│  ├─ parity/                        committed: parity declarations, probes, captures (13 F-TEST-9)
│  ├─ test-adopt/                    committed: staged (not-yet-live) testCommands proposals, one per layer (13 F-TEST-11)
│  ├─ agents/ workflows/ frameworks/ templates/ checks/ skills/    resolved set (gitignored)
│  ├─ backups/                       upgrade backups, last 5
│  └─ state/                         gitignored
│     ├─ forge.lock                  supervisor lock: pid, host, startedAt, runId
│     ├─ ids.json                    ID allocation cache (rebuildable by scan)
│     ├─ index.db                    SQLite projection (KB index, spec graph, ledger)
│     ├─ runs/<runId>/
│     │  ├─ events.ndjson            append-only write-ahead log — TRUTH for the run
│     │  ├─ plan.json                compiled run plan (DAG)
│     │  ├─ trace.ndjson             OTel-shaped spans
│     │  ├─ ledger.ndjson            cost/token records
│     │  └─ steps/<stepId>/
│     │     ├─ prompt.md             compiled prompt (audit)
│     │     ├─ context.json          context pack manifest (ids + token counts, not content)
│     │     ├─ transcript.ndjson     normalised adapter events
│     │     └─ result.json           SessionResult
│     └─ cache/                      adapter probes, catalog index, render cache
├─ docs/forge/
│  ├─ kb/                            see 08
│  ├─ specs/                         see 09
│  │  ├─ vision.md  prd.md  nfr/  capabilities/  epics/  stories/  tasks/
│  │  ├─ interfaces/  data/  test-plan.md  traceability.md  traceability.json
│  ├─ plans/                         stages.md, stage-<id>.md, run plans, views/
│  ├─ sessions/                      brainstorms, reviews, retros, rca/
│  └─ reports/                       gates/, coverage/, flaky.json, drift/, cost/, diagrams/
└─ FORGE.md
```

**Lane and integration worktrees no longer live under `.forge/state/`** (post-v1.0, `specs/22` M17):
they sit outside the project tree entirely, under the user's cache directory. `18.3`'s "Worktree
location" paragraph below gives the exact path and its platform equivalents.

## 18.3 Configuration schema

`# canonical` — `.forge/config.yaml`, validated by `config.schema.json` (generated from zod).

```yaml
version: 1                            # config schema version, drives migrations

project:
  name: acme-billing
  slug: acme-billing
  description: "Invoicing for small agencies"
  level: L3                           # L0..L4
  mode: guided                        # guided | express
  repoUrl: "https://github.com/acme/billing"

paths:
  kb: docs/forge/kb
  specs: docs/forge/specs
  plans: docs/forge/plans
  sessions: docs/forge/sessions
  reports: docs/forge/reports
  code: .                             # root of the actual source tree

platform:
  primary: claude-code
  fallback: null
  perAgent: {}                        # agentId -> platformId
  routing: { onRateLimit: fallback, onOutage: fallback }
  claudeCode:
    transport: sdk                    # sdk | cli
    bare: true
    minimumVersion: "2.0.0"

models:
  tiers:
    frugal:   { claude-code: haiku }
    balanced: { claude-code: sonnet }
    max:      { claude-code: opus }
  overrides: { architect: max, diagnostician: max }

execution:
  concurrency: auto                   # auto | <int>
  autonomy: guided                    # supervised | guided | autonomous
  autonomyByGate: { G-Deliver: supervised }
  retainLaneWorktrees: on-failure     # never | on-failure | always
  integrationBranch: "forge/integration/{stage}"
  conflictPolicy: agent               # agent | human | abort
  sharedMutablePaths:
    - { glob: "pnpm-lock.yaml", strategy: regenerate, command: "pnpm install --lockfile-only" }
    - { glob: "CHANGELOG.md", strategy: append-only }
  testCommands: { unit: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" }   # one command per test layer (13 F-TEST-1)
  mergeChecks: { pre: fast, post: full }   # optional: check sets around a lane the engine integrates itself (06 §6.5)

budget:
  perRunUsd: 25
  perStepUsdDefault: 2
  dailyUsd: 100
  onBreach: pause                     # pause | finish-lanes | abort

roster: { preset: startup-lean, enable: [], disable: [], alias: {}, add: [], split: {} }

kb:
  packBudgetTokens: 20000
  retrieval: { embeddings: false, graphHops: 1 }
  staleness: { architecture: 90, data: 90, delivery: 60, product: 120, ops: 60 }

skills:
  packBudgetTokens: 8000
  hardBodyCapTokens: 6000

mcp: { servers: [], grants: {}, defaults: { grantMode: explicit, injectionPosture: untrusted-content }, adoptHostServers: false }

diagrams:
  defaultNotation: mermaid
  allowedNotations: [ mermaid ]
  render: on-demand                   # never | on-demand | on-gate
  remoteRenderer: null
  complexity: { maxNodes: 20, maxEdges: 30, hardMaxNodes: 40 }
  driftPolicy: fail                   # fail | autofix | warn
  requireCaptions: true

quality:
  coverage: { lines: 85, branches: 80, ratchet: true, source: istanbul-json }   # source/format: 18.3's own coverage paragraph below
  flake: { maxRatePct: 2, window: 20, quarantineCap: 5 }
  pyramid: { maxE2ESharePct: 15 }
  dodProfileDefault: backend-default

security:
  secretSource: env                   # env | keychain | file | command
  secretCommand: null
  toolCeilingEscalations: []
  destructiveOps: confirm             # confirm | deny | allow-in-lane
  redactPatterns: [ "(?i)api[_-]?key", "(?i)authorization" ]

vcs:
  trunk: main                          # post-v1.0, specs/22 M17: proposed at `forge init` (18.3's own trunk paragraph below)
  allowCommits: true
  commitConvention: conventional
  signCommits: false
  trailers: true

telemetry: { network: false, otlpEndpoint: null }

output: { color: auto, ascii: false, style: acme-house }
```

**`execution.testCommands.<layer>` — structured form (post-v1.0, `specs/22` M17).** The bare string
shown above (`"pnpm test"`) keeps its EXACT current meaning: a single shell command, its output read
as Vitest JSON for a `package.json`-having project or pytest JUnit XML for a Python-marker project, by
the pre-existing `detectEcosystem` rule — the LEGACY path, not the only path, and never changed by a
project that does not opt into the alternative below; `detectEcosystem` leaves the test-time path
entirely once a layer uses it (`13` F-TEST-1). A layer MAY instead be a structured object:

```yaml
execution:
  testCommands:
    unit:
      run: "command, with {files} and {name}/{name:regex} placeholders where the project supports them"
      output: { source: stdout }           # or: { source: file, path: "relative/path" }
      format: junit-xml   # | tap | forge-json | vitest-json | jest-json | go-test-json
      translate: "optional command; must print forge-json (09 §9.5) on stdout; placeholders: {output}"
      scope: "optional command template enabling a file-scoped run"
      filter: "optional command template enabling a single-test retry"
      timeoutMs: 600000   # optional
```

`output.source: file` names `{output}`, a path FORGE itself allocates and deletes before every run of
that layer: a stale report left over from an earlier run, a crash or an unrelated process is never
read, which is a real, load-bearing guarantee, not a convenience — a command whose `run` does not
itself write that exact path fails typed rather than silently reading an old result. `format` picks a
built-in parser into `09` §9.5's `forge-test-report`; `translate`, when given, is an additional command
run under the identical confined-command sandbox and timeout `run` itself runs under, with `{output}`
available to it, and it MUST print a schema-valid `forge-test-report` on stdout — a `translate` that
exits non-zero, or whose stdout does not parse as that shape, is a typed tool-error, never silently
read as zero tests. `scope` and `filter` are optional command templates: their absence, like every
other undeclared capability here, degrades to a stated, typed, visible outcome, never a silent pass —

- No `filter` → the flaky-retry-in-isolation mechanism (`13` F-TEST-6) is skipped for that layer and
  the test is recorded `unclassified`, never silently read as "not flaky".
- No `scope` → a consumer that would otherwise scope to one file or story (binding, hunk mutation) runs
  the whole suite instead, bounded by a stated budget, with a typed refusal past it, never an
  unbounded fallback.
- No per-test file attribution in the chosen `format` → a consumer attributes by test name alone and
  says so in its output, never guessing a file.
- No `kind` signal in the chosen `format` (TAP, for one) → every failure reads `kind: 'assertion'`,
  `09` §9.5's own conservative default for hunk-mutation credit.

**`quality.coverage.source`/`.format` (post-v1.0, `specs/22` M17).** `source` (`istanbul-json` default
| `lcov` | `cobertura` | `jacoco`) and an optional `format` override replace the previously hard-coded
assumption that coverage always arrives as Istanbul's own `coverage/coverage-summary.json` (confirmed
pre-M17: `packages/cli/src/commands/loop/test/coverage.ts`'s own `COVERAGE_SUMMARY_RELATIVE_PATH`
constant named exactly that path, unconditionally) — a project whose own tooling emits `lcov.info`,
Cobertura XML or a JaCoCo report declares which, and coverage reads that format at that layer's own
conventional path instead.

**`vcs.trunk` (post-v1.0, `specs/22` M17).** A string, default `"main"`. `forge init` proposes it from
`origin/HEAD` when the project has a remote, or from `init.defaultBranch` when configured, falling back
to the default only when neither is detectable. `06` §6.4/§6.5 and `10` §10.3 rule 8 read it wherever
they would otherwise assume the literal string `main`.

**Worktree location (post-v1.0, `specs/22` M17).** Lane and integration worktrees, and parity's own
reference scratch tree, move out of the project's own working tree entirely: `18.1`'s "Run state" tier
and `18.2`'s layout below are amended accordingly. They live under a per-project directory keyed by a
stable project hash, inside the user's cache directory: `$XDG_CACHE_HOME/forge/<project-hash>/worktrees`
when `XDG_CACHE_HOME` is set, and otherwise the platform's own real cache-directory default per the XDG
Base Directory spec's own fallback rule — `~/Library/Caches/forge/<project-hash>/worktrees` on macOS,
`%LOCALAPPDATA%\forge\<project-hash>\worktrees` on Windows, `~/.cache/forge/<project-hash>/worktrees`
on Linux — never inside `<project>/.forge/state/` as before. This was the one `.gitignore`-reliant
location (`06` §6.4's own old rule, "worktrees live there, so they never self-reference"); outside the
project tree, no `.gitignore` entry is needed for them at all, and no glob rooted at the project rejects
or discovers them by accident, which is the point: a test runner that globs the whole project tree for
test files can no longer find a lane's own worktree copy of them. `forge doctor` reports any worktree
it still finds under the old, in-tree location and offers to remove it (`06` §6.4).

**Resolution order** is defined in `02` §2.8. `forge config explain <key>` prints value + source
layer. Every key in this schema has a documented default; there are no undocumented keys.

## 18.4 The event log

`.forge/state/runs/<runId>/events.ndjson` is append-only and is the **write-ahead log**: an event is
written and fsync'd *before* the side-effect it authorises is attempted.

```ts
interface ForgeEvent {
  v: 1;
  seq: number;              // monotonic within the run, gapless
  ts: string;               // ISO-8601 with ms
  runId: string;
  type: EventType;
  stepId?: string;
  laneId?: string;
  agentId?: string;
  idempotencyKey?: string;
  payload: unknown;         // typed per EventType
  causedBy?: number;        // seq of the causing event
}
```

### Event catalogue

| Group | Types |
|---|---|
| Run | `RunPlanned` `RunStarted` `RunPaused` `RunResumed` `RunCompleted` `RunAborted` `RunFailed` |
| Step | `StepScheduled` `StepStarted` `StepProgress` `StepSucceeded` `StepFailed` `StepRetried` `StepSkipped` `StepEscalated` |
| Lane | `LaneCreated` `LaneCommitted` `LaneReady` `LaneAbandoned` `LaneRemoved` |
| Adapter | `SessionStarted` `SessionEvent` `SessionEnded` `AdapterError` `AdapterRetry` |
| Artifact | `ArtifactCreated` `ArtifactUpdated` `ArtifactValidated` `ArtifactRejected` |
| KB | `KbWritten` `KbProposed` `KbProposalResolved` `KbContradictionDetected` |
| Gate | `GateEvaluated` `GateApproved` `GateRejected` `GateWaived` |
| Merge | `MergeQueued` `MergeStarted` `MergeConflict` `MergeCompleted` `MergeReverted` |
| Human | `ElicitationRequested` `ElicitationAnswered` `AssumptionRecorded` `InterjectionSent` |
| Cost | `UsageRecorded` `BudgetWarning` `BudgetBreached` |
| Security | `PolicyViolation` `SecretRedacted` `InjectionAttemptBlocked` `EscalationActive` |
| Custom | `CheckRun` `DiagramGenerated` `DriftDetected` |

**Rules:** events are immutable and never rewritten; corrections are new events. `seq` gaps indicate
corruption and trigger `forge doctor`. The TUI, the ledger, the index and all reports are
**projections** of this log — if a value cannot be derived from the log, it does not exist.

Redaction happens at write time: payloads pass through the secret redactor before serialisation, so
secrets are never on disk even transiently.

**Payload versioning (post-v1.0, `specs/22` M16).** `v` versions the envelope and nothing else: it is
the field of `ForgeEvent` above, and a log whose events carry any other `v` is refused by the reader,
not guessed at. No payload carries a version of its own. A payload's shape is selected by its event
`type` and, for `CheckRun`, by its `kind` (`'binding'` and `'exemption-declared'` from M15, `'parity'`
from M16), checked first and explicitly, never inferred from which other fields happen to be present.
Adding a `kind`, or adding an optional field to an existing `kind`, is additive and leaves `v` at 1: a
reader skips a `kind` it does not recognise, reads an optional field only when it is present and
well-typed, and ignores a field it does not know. A change that is not additive (a field changing its
meaning or its type, a required field appearing) takes a new `kind` and never reinterprets an existing
one. A `'parity'` payload carries the count per verdict, the total, the evidence id (null for a check
run with `--no-record`) and the declaration names, never an observation, and, like the other kinds, it
is written only where the run's id reaches the command in `FORGE_RUN_ID` and the command can name
the run's own project root; a hunk run's counts and `granularity` are optional fields on the
existing `'binding'` payload.

## 18.5 The SQLite index (projection)

Rebuildable via `forge doctor --rebuild-index`. Schema (abridged; migrations in
`@forge/schemas/db/`):

```sql
CREATE TABLE entries (id TEXT PRIMARY KEY, type TEXT, section TEXT, title TEXT, path TEXT,
  status TEXT, confidence TEXT, owner TEXT, updated TEXT, verified TEXT, review_by TEXT, hash TEXT);
CREATE TABLE links (from_id TEXT, to_id TEXT, kind TEXT, PRIMARY KEY (from_id, to_id, kind));
CREATE VIRTUAL TABLE terms USING fts5(id UNINDEXED, title, body, tokenize='porter');
CREATE TABLE artifacts (id TEXT PRIMARY KEY, type TEXT, path TEXT, status TEXT, parent TEXT,
  revision INTEGER, hash TEXT);
CREATE TABLE ac_tests (ac_id TEXT, test_id TEXT, outcome TEXT, last_run TEXT,
  PRIMARY KEY (ac_id, test_id));
CREATE TABLE ledger (run_id TEXT, step_id TEXT, agent TEXT, model TEXT, platform TEXT,
  input_tokens INT, output_tokens INT, cache_read_tokens INT, cost_usd REAL, estimated INT,
  duration_ms INT, ts TEXT);
CREATE TABLE usage (entry_id TEXT, run_id TEXT, step_id TEXT, mode TEXT, ts TEXT);
CREATE TABLE symbols (symbol TEXT, path TEXT, entry_id TEXT, kind TEXT);
CREATE TABLE diagrams (id TEXT PRIMARY KEY, kind TEXT, notation TEXT, source TEXT,
  generated INT, generator TEXT, hash TEXT, verified TEXT);
```

If `better-sqlite3` is unavailable, fall back to `node:sqlite` where present, else a JSON index with
degraded search (substring instead of BM25) and a warning at startup.

## 18.6 Canonical artifact front matter

Every artifact file carries this base, extended per type:

```yaml
id: STORY-014                 # required, matches ^[A-Z]+-\d{3,4}(-\d+)?$
type: Story                   # required, matches a registered artifact type
schemaVersion: 3              # required, drives migrations
title: "…"                    # required
status: ready                 # required, per-type enum
created: 2026-03-04           # required
updated: 2026-03-11           # required, maintained by the writer
revision: 2                   # incremented on substantive change
author: po                    # agent id or 'human'
run: run_01H…                 # run that last wrote it (audit)
changelog:                    # append-only
  - { revision: 2, date: 2026-03-11, by: po, summary: "Split AC-014-3 out to STORY-019" }
```

**Validation** is two-phase: front matter against the type's JSON Schema, then body structure against
required sections declared by the type (`requiredSections: [Statement, Rationale, …]`). Both run in
`forge spec validate` and `forge kb lint`.

## 18.7 Artifact type registry

```yaml
# canonical: schemas/registry.yaml
types:
  - { id: Vision,   idPrefix: VIS,   path: "specs/vision.md",                       cardinality: one }
  - { id: Capability, idPrefix: CAP, path: "specs/capabilities/{id}.md",            parent: Vision }
  - { id: NFR,      idPrefix: NFR,   path: "specs/nfr/{id}.md" }
  - { id: Epic,     idPrefix: EPIC,  path: "specs/epics/{id}.md",                   parent: Capability }
  - { id: Story,    idPrefix: STORY, path: "specs/stories/{id}-{slug}.md",          parent: Epic }
  - { id: Task,     idPrefix: TASK,  path: "specs/tasks/{id}.md",                   parent: Story }
  - { id: ADR,      idPrefix: ADR,   path: "kb/decisions/{id}-{slug}.md",           idWidth: 4 }
  - { id: InterfaceContract, idPrefix: INT, path: "specs/interfaces/{name}.yaml" }
  - { id: DataModel, idPrefix: DM,   path: "specs/data/{id}-{slug}.md" }
  - { id: Diagram,  idPrefix: DIAG,  path: "{section}/views/{slug}.mmd" }
  - { id: Risk,     idPrefix: RISK,  path: "kb/risks.md",                           collection: true }
  - { id: Assumption, idPrefix: ASM, path: "kb/assumptions.md",                     collection: true }
  - { id: OpenQuestion, idPrefix: OQ, path: "kb/open-questions.md",                 collection: true }
  - { id: Waiver,   idPrefix: WAIVER, path: "reports/waivers.md",                   collection: true }
  - { id: SessionRecord, idPrefix: SESSION, path: "sessions/{id}-{slug}.md" }
  - { id: RCA,      idPrefix: RCA,   path: "sessions/rca/{id}-{slug}.md" }
  - { id: Defect,   idPrefix: DEF,   path: "reports/defects/{id}.md" }
  - { id: Environment, idPrefix: ENV, path: "kb/delivery/environments.md",          collection: true }
  - { id: Runbook,  idPrefix: RUN,   path: "kb/ops/runbooks/{id}-{slug}.md" }
  - { id: GateReport, idPrefix: GATE, path: "reports/gates/{gate}-{ts}.md" }
  - { id: HandoffRecord, idPrefix: HO, path: "reports/handoffs.md",                 collection: true }
  - { id: ReviewReport, idPrefix: REVIEW, path: "sessions/reviews/{id}.md" }
  - { id: MutationEvidence, idPrefix: MUT, path: "reports/mutation/{story}-{ts}.md", parent: Story }
  - { id: EvidenceBundle, idPrefix: EVID, path: "reports/evidence/{id}-{story}.md", parent: Story }
  - { id: Disclosure, idPrefix: DISC, path: "kb/disclosures.md", collection: true }
  - { id: ParityEvidence, idPrefix: PAR, path: "reports/parity/{id}-{slug}.md" }
```

Adding a type requires: registry entry, JSON Schema, template, graph edge declarations, and a
migration if it changes an existing type. Modules may add types (`18` §19 covers packaging).

`MutationEvidence` and `EvidenceBundle` were added post-v1.0 (`specs/22` M15), the same way
`ReviewReport` was: a real capability (`13` F-TEST-5's behavioural binding, `10` §10.3's evidence
resolution) that needed a committed, typed artifact and did not have one yet.

Both are genuinely **append-only — never edited, only superseded** (`PLAN-M15.md` P2's own binding
Mandate, mirroring the deprecate-not-delete discipline this registry already uses: an id, once
allocated, is never reused or silently overwritten — `18` §18.8). Concretely, each is a NEW,
distinctly-id'd file every time one is produced, never a rewrite of a prior one: `MutationEvidence`'s
path (`reports/mutation/{story}-{ts}.md`, mirroring `GateReport`'s own `{gate}-{ts}` naming) makes
every `forge test binding` run its own file; `EvidenceBundle`'s path
(`reports/evidence/{id}-{story}.md`) carries its own real `EVID-####` id, so two assemblies for the
same story — or two concurrent stories, `PLAN-M15.md` P7's own "Tests first" requirement — are two
distinct files, never one file edited twice. "Superseded" means exactly what it means for an ADR
(`08` §8.3/§8.4's `status: superseded` convention): an older instance stays on disk, readable, until
`forge evidence prune` removes it (§18.7, Retention), and a newer one exists; nothing here claims a
bundle is a single revised document the way a Story is (an earlier draft of this entry wrongly claimed
that — see `SPEC-QUESTIONS.md` Q280's round-2 record — and separately miscited `18` §18.8 as defining
"superseded," which it does not; the real definition is `08`'s). The writer refuses an attempt to write
to an already-existing path of either type (`PLAN-M15.md` P2's own "a bundle that edits an existing
evidence record is refused" test) rather than relying on the naming scheme alone to make collision
merely unlikely.

`MutationEvidence`'s own fields are decided here, not deferred, because `PLAN-M15.md`'s P2 Mandate
already decides them in full: the story/piece id, the mutation kind (`revert-implementation` in v1),
the exact commit range or hunk set reverted, the named tests, which failed under mutation, the restore
verification, tool versions, and a timestamp. `EvidenceBundle`'s own fields are genuinely deferred to
`PLAN-M15.md` P7, which is where its real, detailed shape is decided (binding evidence, test results,
coverage delta, every `ReviewReport` verdict, gate outcomes, exemptions in force, and real cost —
Helix's "committed checkpoint with supporting evidence," `shopify.engineering/helix`, in FORGE's own
vocabulary) — P2's own Mandate for `EvidenceBundle` is genuinely a placeholder ("references a set of
evidence artifacts plus the gate they support"), unlike its complete `MutationEvidence` field list, so
there is nothing to defer FROM for the one and nothing decided yet TO defer for the other; this
asymmetry is in the Plan's own text, not invented here.

`Disclosure` (`PLAN-M15.md` P10) is the user-project analogue of this very repository's own
`SPEC-QUESTIONS.md`: every disclosed trade-off, known gap, exemption in force (`13` F-TEST-8), and
unresolved finding from a bounded review loop that exhausted its rounds (`specs/22` M15 `PLAN-M15.md`
P9 — that loop's own round-bounding is P9's to specify normatively when it is built, not asserted in
advance here), with provenance and an owner, so a disclosure cannot quietly evaporate the way an
undisclosed one already can today. Collection-shaped (`kb/disclosures.md`, `collection: true`) like `Risk`/`Assumption`/
`OpenQuestion` before it — the identical "one growing file, entries appended, an id never reused"
shape, not the per-instance file `MutationEvidence`/`EvidenceBundle` use above, because a disclosure is
a running list a human reads start to finish (`forge kb`), not a thing a later step resolves by its own
id alone. A disclosure is never deleted, only resolved with a reason (`PLAN-M15.md` P10's own Mandate)
— the same deprecate-not-delete discipline `18` §18.8 already states for every id in this registry,
applied here to resolution rather than deletion specifically because nothing in this registry's prior
21 types needed a REASON recorded at the moment an entry stops being open, which `Disclosure` does.

`ReviewReport` was added post-v1.0 (a real, previously-shipped gap, not part of the original 21):
`10` §10.6's own canonical `implement-story` inner loop and `05` §5.2's `reviewer` agent persona both
already named it as the real output of the `review` step's `swarm-review` mode, but it was never
actually added to this table — `forge workflow validate --all` reported it as an unknown artifact
type on every fresh `forge init` until this fix. No field-level shape is specified for it here (the
identical situation `GateReport` is already in — see `SPEC-QUESTIONS.md` Q23), so its own schema
carries no type-specific fields beyond the base front matter every artifact type shares — except one:
an optional `verdict: blocked|incomplete|concerns|clear` (`SPEC-QUESTIONS.md` Q232 decision 7), the
engine's own merged verdict from `05` §5.7, written by the engine before the file is committed. A
`blocked` verdict fails the swarm-review step that wrote it; a report with no `verdict` key (every one
written before this field existed) still validates unchanged.

`ParityEvidence` was added post-v1.0 (`specs/22` M16), the same way and by the same checklist: a real
capability (`13` F-TEST-9's parity oracles) that needed a committed, typed artifact. It has the
registry entry above, a JSON Schema, a template, and no graph edge declaration beyond an optional
`story` id: like `MutationEvidence` and `EvidenceBundle` it is outside the traceability chain of `09`
§9.4, and unlike them it has no `parent`. (What `{slug}` names is settled when the type is built,
`specs/22` M16 P5.) It is **append-only** exactly as they are: one `forge parity check` invocation
writes one `PAR-<n>` record, however many declarations it checks (none, when it is given
`--no-record`, as the `G-Parity` gate's check is: `13` F-TEST-9), and a write to an existing path is
refused, never an edit. The record's body carries a `declarations` list, in order of `name`, each
entry holding the declaration's name and digest, the reference's ref and sha, the platform, the
digest of the capture it selected, its verdict and, where that is not `match`, its `reason`, the
verdict and content hashes of each case, and its exempt count. Beside that list the record holds the
candidate's `headSha`, `dirty` flag and delta digest, `trusted` (the trust anchor's sha, or null:
`13` F-TEST-9), the overall verdict, the check's own `reason` where the check itself stopped
(`no-declarations`, `oracle-changed`), and tool versions. Its `story`, when `forge parity check` is
given `--story <id>`, is its retention subject (Retention, below). It holds names, digests, verdicts
and hashes, never an observed value (`13` F-TEST-9). The `platform` of a `declarations` entry is the
operating system and architecture its capture was taken on, `<os>-<arch>`; it is not the agent
platform of §18.3's `platform` block or the ledger's `platform` column. A parity capture is not a
registry artifact: it is a content-addressed JSON file with no front matter under
`.forge/parity/captures/` (§18.2), which the id scan never lists, because it reads `.md` files only
and skips `.forge` (`packages/core/src/ids/scan.ts`). `specs/22` M16 P5 must show, by a test over a
project holding both, that no validation or health check flags a `PAR` record or a capture, unless
its text holds a `${secret:NAME}` reference: `forge doctor`'s `secret-references` check scans every
`.yaml`, `.yml`, `.md` and `.json` file under `.forge/` (outside `.forge/state`) and `docs/forge/`
for those, so a declaration, a capture or a record that holds one draws its warning.

`EvidenceBundle` gains an optional `parityEvidence` list, the ids of the `ParityEvidence` records a
bundle rests on, beside its `bindingEvidence`; a bundle without it stays valid, and M16 changes no
bundle assembler, so nothing populates it yet. `MutationEvidence` gains
a second shape for hunk-level mutation (`13` F-TEST-10), which its field list above already anticipated
("the exact commit range or hunk set reverted"): its `mutationKind` has a second member,
`revert-hunks`, beside `revert-implementation`, and a record of that kind carries, beyond what schema
version 1 records, the base sha the hunks were taken against, the diff algorithm, the `granularity` used
(`hunk`, `file` or `change`) and the hunk list: each hunk's id, path, ranges, content hash, verdict and
`killedBy`. A hunk run is its own new record; an existing change-level record is never rewritten to add
one.

A record that uses a field schema version 1 lacks carries `schemaVersion: 2` (§18.6), and two migrations
(§18.9) are added with those fields, both `1→2`: `MutationEvidence` and `EvidenceBundle`. Each sets
`schemaVersion: 2` going up and changes nothing else (a version-1 record is otherwise already a
valid version-2 record), is pure, and is covered by a golden-file test with a real "before" fixture,
as §18.9 requires: the fixture's "after" differs from its "before" by `schemaVersion` at least.
Whether either declares `reversible: true` is settled when it is written (`specs/22` M16 P5); one
that does removes the version-2 fields and sets `schemaVersion: 1` going down, and a hunk-level
`MutationEvidence` record has no version-1 form (`revert-hunks` is not a version-1 `mutationKind`),
so that migration, if reversible, refuses such a record going down rather than stripping it. As
built, the artifact-migration step of `forge upgrade` (`03` §3.4, step 4) lists only the documents
under the specs root (`packages/cli/src/commands/upgrade/migrate-artifacts.ts`), so a record under
`reports/` is not reached by it: version-1 evidence stays version 1 on disk. Until a migration has
run, every reader of these two types must accept `schemaVersion` 1 and 2 (`specs/22` M16 P5).

**Retention (post-v1.0, `specs/22` M16).** Evidence files accumulate: every run writes a new one and
none is edited. `forge evidence prune` (`03` §3.2.5) is the retention policy `specs/22` M15 P7 deferred.

- It manages three types, `MutationEvidence`, `EvidenceBundle` and `ParityEvidence`, and nothing else.
  It never prunes a parity capture (the oracle's baseline, not its evidence), a collection-shaped
  artifact, the event log, or the tombstones below.
- It is a dry run by default: a dry run writes nothing and names what it would remove, and only
  `--apply` removes anything.
- `--apply` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present, whichever run it
  names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a security boundary),
  because a prune is a human act, as `forge parity capture` is: a run must not be able to discard the
  evidence about its own work. A dry run is always allowed.
- `--keep <n>` keeps the newest `n` records per type and subject: the story id when the record was
  written for a story, else the single shared subject `project`. Newest means highest id, compared as a
  number (§18.8), never a file's modification time. `n` is an integer of at least 1 (0, a negative
  number and a non-integer are refused) and defaults to 5, the precedent being `03` §3.4's retention of
  the last 5 backups.
- The highest id of each type is never pruned. `n` of at least 1 already implies it; it is stated on its
  own because the allocator's no-reuse guarantee rests on it (§18.8: allocation is a scan of what
  exists).
- A record that anything still references is protected and reported with the reason. What survives is
  computed to a fixed point: it starts from the records `--keep` and the highest-id rule keep, and
  adds every record that a surviving record, or a store outside the evidence records, references,
  until nothing more is added. A record referenced only by a record this prune removes is therefore
  not protected, and the outcome does not depend on the order in which records are visited. The stores
  that can hold an evidence id (a surviving `EvidenceBundle`, a gate approval or waiver under `10`
  §10.3's evidence resolution, and whatever else the command's own enumeration finds) are enumerated
  and tested when it is built (`specs/22` M16 P14).
- A prune that cannot enumerate every store that can hold an evidence id, because one is unreadable or
  does not parse, refuses and removes nothing: a reference it could not see is one it could break.
- Pruning a record is two steps in a fixed order. A tombstone for its id
  (`docs/forge/reports/pruned/<id>.json`: the id, the type, the subject, the record's sha256 and the
  time) is created first, atomically (written whole to a temporary file beside it and renamed into
  place, so one that exists is never partial); the record is removed second. A crash between the two
  leaves a pending removal, a tombstone with its record still present. While both exist the record
  wins: a reference to the id resolves to the record, never to "pruned". A later prune completes a
  pending removal only if that record is still selected for removal by that prune; otherwise the
  record stays. The stores are enumerated once more after the tombstones are written and before any
  record is removed, and a record that has been referenced since the first enumeration is not
  removed (its tombstone stays, a pending removal as above); a reference written after that second
  enumeration is not seen, so `--apply` is not safe to run while a run or an approval that could
  cite a record it removes is in progress. A repeated or concurrent prune is idempotent. A reference
  to an id that has been pruned (its record removed) resolves to a distinct "pruned" answer that
  names the tombstone, never to "dangling".
- Whether the id allocator also reads the tombstones is decided when the command is built
  (`specs/22` M16 P14); either way an id is never issued twice.

## 18.8 ID allocation

- Per-type monotonic counters, zero-padded to `idWidth` (default 3, ADR 4).
- **Never reused.** Deleted artifacts become `status: deprecated` and their files are retained.
  (Post-v1.0, `specs/22` M16.) For the three retention-managed evidence types (§18.7, Retention),
  "files are retained" holds until `forge evidence prune` removes a file, which it does only after
  writing a tombstone for the id: the file may go, but the id stays spent, and the highest id of each
  type is never pruned. A parity capture (`13` F-TEST-9) is not an artifact with an id; it is a
  content-addressed file that `forge evidence prune` never touches and FORGE never deletes.
- Truth is a **scan of existing artifacts** at startup; `ids.json` is a cache with a validity hash.
  This avoids the merge conflicts a committed counter file guarantees.
- Concurrent allocation within a run is serialised through the supervisor. Lanes never allocate IDs
  directly — they request them, which also prevents two lanes claiming `STORY-020`.

## 18.9 Schema migrations

```
packages/schemas/migrations/
  003-story-add-dod-profile.ts
  004-adr-add-reversibility.ts
```

```ts
export const migration: Migration = {
  from: 3, to: 4, types: ['ADR'],
  description: 'Add reversibility and revisit_trigger to ADR front matter',
  reversible: true,
  up(doc)   { doc.frontmatter.reversibility ??= 'medium';
              doc.frontmatter.revisit_trigger ??= 'TODO: state the trigger'; return doc; },
  down(doc) { delete doc.frontmatter.reversibility; return doc; },
};
```

Rules: pure (document in, document out); no network or FS access; a golden-file test with a real
"before" fixture and an expected "after"; irreversible migrations declared as such and prompted for
before running. `forge upgrade` backs up before migrating (`03` §3.4).

## 18.10 Atomicity, locking and crash safety

- **Atomic writes:** temp file in the same directory → `fsync` → `rename`. Never partial artifacts.
- **Project lock:** `.forge/state/forge.lock` with pid/host/startedAt. A live PID on the same host
  blocks; a dead PID prompts to reclaim; a different host warns (shared filesystems).
- **KB writes** are serialised through a single `KbWriter` queue (`08` §8.6).
- **Crash safety** is tested, not assumed: the CI suite kills the supervisor at 20 randomised points
  during a fixture run and asserts that resume produces identical final state and no duplicated
  side-effects (`21`).
- **fsync policy:** every event append is fsync'd. This costs a few ms per step and buys the
  resumability guarantee the whole system rests on — do not optimise it away without replacing the
  guarantee.
