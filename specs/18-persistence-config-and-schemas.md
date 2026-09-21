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
| **Run state** | `.forge/state/**` | ❌ gitignored | partially | Event log (truth for runs), index, worktrees, caches |

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
│     ├─ worktrees/<laneId>/         git worktrees
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
  coverage: { lines: 85, branches: 80, ratchet: true }
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
  allowCommits: true
  commitConvention: conventional
  signCommits: false
  trailers: true

telemetry: { network: false, otlpEndpoint: null }

output: { color: auto, ascii: false, style: acme-house }
```

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
```

Adding a type requires: registry entry, JSON Schema, template, graph edge declarations, and a
migration if it changes an existing type. Modules may add types (`18` §19 covers packaging).

`ReviewReport` was added post-v1.0 (a real, previously-shipped gap, not part of the original 21):
`10` §10.6's own canonical `implement-story` inner loop and `05` §5.2's `reviewer` agent persona both
already named it as the real output of the `review` step's `swarm-review` mode, but it was never
actually added to this table — `forge workflow validate --all` reported it as an unknown artifact
type on every fresh `forge init` until this fix. No field-level shape is specified for it here (the
identical situation `GateReport` is already in — see `SPEC-QUESTIONS.md` Q23), so its own schema
carries no type-specific fields beyond the base front matter every artifact type shares.

## 18.8 ID allocation

- Per-type monotonic counters, zero-padded to `idWidth` (default 3, ADR 4).
- **Never reused.** Deleted artifacts become `status: deprecated` and their files are retained.
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
