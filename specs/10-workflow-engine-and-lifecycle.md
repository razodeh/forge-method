# 10 — Workflow Engine and the FORGE Lifecycle

## 10.1 Workflow DSL

`# canonical` — `modules/<m>/workflows/<id>.workflow.yaml`

_Corrected post-v1.0: this worked example originally used `StagePlan`/`TestPlan` as artifact-type
references that `18` §18.7's own registry table never actually registered — a real, previously-shipped
inconsistency (`forge workflow validate --all` reported 3 real `unknown-artifact-type` findings on
every fresh `forge init` as a direct result). `TestPlan` and `StagePlan` were never produced by any
real agent/workflow anywhere in this codebase; `plan-stage.workflow.yaml`'s own real output
(`Epic`+`Story`+`HandoffRecord(subtype: test-plan)`) and `G-Ready.gate.yaml`'s own real `evidence:`
block (`Epic(*)`/`Story(*)`) already establish what a ready stage's own planning artifacts actually
are, so this worked example now matches that already-real, already-shipped shape instead of a phantom
type nothing ever produced. `ReviewReport` (used further below, in the `review` step) was the opposite
situation -- genuinely load-bearing, real content `10` §10.6 and `05` §5.2 both already depended on
that `18` §18.7 simply never registered -- and is now a real, registered type instead (see `18` §18.7's
own trailing entry). See `SPEC-QUESTIONS.md` for the full record of this decision._

```yaml
id: build-stage
name: Implement a stage
version: 1.0.0
description: Takes a planned stage to a verified, deployable state.
levels: [ L1, L2, L3, L4 ]           # which scale levels this applies to
requires:
  gates_passed: [ G-Ready ]
  artifacts: [ Epic, Story ]
inputs:
  - name: stageId
    type: string
    required: true

vars:
  integration_branch: "forge/integration/{{stageId}}"

steps:
  - id: prepare
    kind: command
    run: "git switch -c {{vars.integration_branch}} || git switch {{vars.integration_branch}}"
    inline: true

  - id: freeze-contracts
    kind: agent
    agent: architect
    brief: briefs/freeze-contracts.md
    inputs: [ artifact:Epic(*), artifact:Story(*), kb:architecture/**, kb:data/** ]
    outputs:
      - type: InterfaceContract
        cardinality: many
    gateEvidence: [ G-Design ]

  - id: contracts-gate
    kind: gate
    gate: G-Design
    dependsOn: [ freeze-contracts ]

  - id: generate-tests
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ contracts-gate ]
    step:
      kind: agent
      agent: sdet
      brief: briefs/write-failing-tests.md
      inputs: [ artifact:Story({{item.id}}), artifact:HandoffRecord ]
      produces: [ "{{item.test_paths}}" ]
      limits: { maxTurns: 25, maxCostUsd: 1.5 }

  - id: implement
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ "generate-tests:{{item.id}}" ]     # per-item dependency
    step:
      kind: agent
      agent: "{{item.owner_role}}"
      brief: briefs/implement-story.md
      inputs: [ artifact:Story({{item.id}}), artifact:InterfaceContract(*), kb:engineering/standards ]
      produces: "{{item.files_expected}}"
      retry: { maxAttempts: 3, retryOn: [ transient, test-failure, validation ] }
      onFailure: escalate

  - id: review
    kind: fanout
    over: "stage.stories"
    dependsOn: [ "implement:{{item.id}}" ]
    step:
      kind: agent
      agent: reviewer
      mode: swarm-review
      perspectives: [ design, security, testing, performance ]
      inputs: [ diff:lane, artifact:Story({{item.id}}) ]
      outputs: [ { type: ReviewReport } ]

  - id: merge
    kind: merge
    over: "stage.stories"
    dependsOn: [ "review:{{item.id}}" ]
    policy: { conflict: agent, preChecks: fast, postChecks: full }

  - id: verify
    kind: gate
    gate: G-Verify
    dependsOn: [ merge ]

  - id: deliver
    kind: subworkflow
    workflow: deliver-stage
    dependsOn: [ verify ]

onFailure:
  default: block
  escalations:
    - when: "failures.test-failure > 2"
      do: { kind: agent, agent: diagnostician, brief: briefs/rca.md }

onComplete:
  - kind: agent
    agent: em
    brief: briefs/stage-retro.md
    outputs: [ { type: SessionRecord, subtype: retrospective } ]
  - kind: command
    run: "forge kb sync && forge spec matrix"
    inline: true
```

### Step kinds

| kind | Semantics |
|---|---|
| `agent` | Instantiate an agent session in a lane (or inline for read-only steps) |
| `command` | Run a shell command; `inline: true` runs in the supervisor (in the integration worktree), else in a lane |
| `gate` | Evaluate a gate; may block for human approval |
| `elicit` | Ask the human structured questions; blocks |
| `session` | Run a facilitated session (see `16`) |
| `fanout` | Expand over a collection; each item becomes a node |
| `merge` | Merge-queue processing for a set of lanes; `policy.preChecks`/`postChecks` name check sets (`fast`, `full`, or one test layer, run as `execution.testCommands`; see `06` §6.5) or give a shell command |
| `subworkflow` | Invoke another workflow, sharing the run |
| `checkpoint` | Force a commit + event-log flush; a safe resume point |
| `parallel` / `sequence` | Explicit grouping when dependencies alone are insufficient |

### Expressions

A tiny, sandboxed expression language (no `eval`): dotted paths, comparisons, `&&/||/!`, `in`,
`length`, and a fixed helper set (`item`, `stage`, `run`, `config`, `kb`, `failures`, `vars`).
Implement with a hand-written parser (~300 LOC) or `jsonata`-style library that cannot execute
arbitrary code. **Never** use `new Function`.

### Customization

Workflows, gates, checks and frameworks are all overridable per project (`15` §15.7). Overlays may
insert, replace, reorder and re-scope steps, add gate checks, and tune thresholds and framework
weights. Three things overlays cannot do, enforced at compile time: delete a gate step (`GATE-501`),
define a gate with zero deterministic checks (`GATE-502`), or remove the `red` (test-first) or
`review` steps from the inner loop (`CFG-502`) — those are the separation-of-duties spine that makes
the rest of the process mean anything.

### Validation

`forge workflow validate` checks: unique step ids; no dependency cycles; referenced agents,
briefs, gates, artifacts and workflows exist; `produces` globs are well-formed; fanout `over`
resolves to an array; every `gateEvidence` names a real gate; limits within module ceilings.

## 10.2 The FORGE lifecycle

Ten phases. Each has an owner, entry conditions, outputs, and an exit gate.

| # | Phase | Owner | Key outputs | Exit gate |
|---|---|---|---|---|
| P0 | **Intake** | analyst | Idea record, level selection, constraints, glossary seed | — |
| P1 | **Discovery** | analyst, pm | Problem, users, competitive scan, success metrics, risks | `G-Problem` |
| P2 | **Product Definition** | pm, po, ux | Vision, PRD, capabilities, NFRs, UX spec, scope/non-goals | `G-Product` |
| P3 | **Solution Shaping** | architect, data-architect, security | Architecture spec, ADRs, domain & data model, threat model, tech selection | `G-Design` |
| P4 | **Project Initialization** | platform, sre | Repo strategy, build system, scaffold, VCS conventions, CI skeleton, local dev env | `G-Foundation` |
| P5 | **Planning & Decomposition** | pm, em, po, architect | Stage plan (MVP/milestones), epics, stories, test plan, run plan DAG | `G-Ready` |
| P6 | **Implementation** | engineers, sdet | Contracts frozen, tests, code, reviews, merges | — (continuous) |
| P7 | **Verification** | test-architect, sdet | Test execution, coverage, NFR verification, traceability matrix | `G-Verify` |
| P8 | **Stabilization** | diagnostician, sre | RCA records, fixes, regression tests, flake control | `G-Stable` |
| P9 | **Delivery** | sre, release | Pipeline, environments, deploy, smoke, rollback rehearsal, runbooks | `G-Deliver` |
| P10 | **Operate & Learn** | sre, em | Observability live, SLOs, retro, KB write-back, next-stage inputs | `G-Operate` |

P6→P8 loop per stage. P9→P10 per stage. The whole P2→P10 loop repeats per stage (MVP → M2 → GA).

Level mapping (from `01` §1.9): L0 runs {P6,P7} only; L1 adds {P5 light, P8}; L2 adds {P2 delta, P3
delta, P9}; L3/L4 run everything, L4 adds `G-Integration` and a domain decomposition step in P3.

## 10.3 Gates

```yaml
# canonical: gates/<id>.gate.yaml
id: G-Design
name: Design gate
phase: P3
autonomyOverride: null          # or 'alwaysHuman'
checks:
  deterministic:
    - id: spec:validate
      run: "forge spec validate --json"
      parser: forge-json
      failOn: "errors > 0"
    - id: kb:lint
      run: "forge kb lint --json"
      failOn: "errors > 0"
    - id: adr:coverage
      run: "forge kb lint --rule adr-coverage --json"
      failOn: "errors > 0"
    - id: interfaces:frozen
      run: "forge spec interfaces --check-frozen --json"
      failOn: "undefined_refs > 0"
    - id: nfr:numeric
      run: "forge spec validate --rule nfr-numeric --json"
      failOn: "errors > 0"
    - id: diagram:validate
      run: "forge diagram validate --gate G-Design --json"
      failOn: "errors > 0"     # syntax, required coverage, ADR diagram coverage, node refs, captions
    - id: diagram:drift
      run: "forge diagram generate --all --check --json"
      failOn: "drifted > 0"
  advisory:
    - id: architect-review
      agent: critic
      brief: briefs/critique-architecture.md
      # advisory results NEVER fail the gate; they populate open questions
openQuestionsPolicy: block      # block | warn — blocking OQs must be resolved
approval:
  required: true                # at 'guided' and 'supervised'
  roles: [ human ]              # who may approve
  quorum: 1
evidence:
  - artifact: ArchitectureSpec
  - artifact: ADR(*)
  - artifact: DataModel
  - artifact: ThreatModel
onReject:
  action: replan
  target: P3
```

**Gate rules (normative):**
1. A gate with any failing deterministic check cannot be approved — only waived, and waivers require
   a reason, an owner, and an expiry, and appear in every report until resolved.
2. Advisory (LLM) checks never fail a gate. They create `OQ-###` entries.
3. Gates are re-runnable and idempotent; `forge gate check <id>` re-evaluates without approving.
4. Every gate evaluation writes a `GateReport` artifact to `docs/forge/reports/gates/` with the exact
   command output — this is the audit trail.
5. `G-Deliver` for a production environment is `alwaysHuman` by default and cannot be set otherwise
   without an explicit config flag plus a typed acknowledgement.
6. `forge gate approve <id>` evaluates the gate exactly as `forge gate check` does and refuses (exit 3) unless every
   deterministic check passed or a valid, unexpired waiver recorded for the gate covers it; it also refuses an
   approver the gate's `approval` block does not name (`roles`, and a `quorum` above 1 it cannot verify). The
   `GateApproved` event carries the evaluation (per-check verdicts and sha256 digests of each check's recorded
   stdout and stderr, the waiver if one was used, the advisory checks as not run). A waiver excuses the checks that
   were failing when it was granted: it does not cover a check that fails later, and a gate that passes cannot be
   waived, and `forge gate waive` is held to the same `approval` block. The command is a person's: it cannot tell an
   agent that runs it from one (and `--owner` is the person's own word), so `may_approve` and `alwaysHuman` bind an
   approver a caller can identify (the engine), not a shell. `forge gate check` shows the newest waiver on record. A gate document with an unknown key, or with no deterministic
   check, is a load error, never an empty gate that passes.

**Check contract (normative; what a deterministic check must do to pass).** A check passes only if it shows
success; anything the evaluator cannot read as success is a failure with a stated `reason`, and a failing check
can only be waived (rule 1):
- It exits `0` or `1` (`0` success, `1` failure; any other code means it did not reach a verdict, whatever it
  printed) and prints one JSON object on stdout. A `forge` command exiting `1` is trusted for its verdict only
  when that object is a versioned envelope (`{"v":1,...}`); any other program that exits `1` beside a clean body
  is a contradiction and fails.
- The object carries no failure marker: no `ok` other than `true`, no `success: false`, no top-level `error` other
  than `null`, `false` or `""` (the `{"v":1,"ok":false,"error":{...}}` a refused command prints).
- `failOn` reads at least one field, and every field it reads is present, non-null and of the type the comparison
  needs (numbers or strings for `<` `>`, one primitive type for `==`/`in`, booleans for `!`/`&&`/`||`). A missing
  field is not "no findings". A command whose input is missing (no `dist/`, no contracts, a failing `git diff`)
  reports that as a failing count and a `reason`; it does not pass on "nothing found".
- A check that is not applicable to a project is declared not applicable by the gate or the check
  (`appliesTo`, the module that ships it), never by a command that prints a passing result for nothing.
Every check's result records its stdout, its exit code and its stderr (stderr sanitised of secrets and control bytes,
and capped) as the audit trail (rule 4); an approval or waiver event carries their digests.

### Gate catalogue

| Gate | Fails on (deterministic examples) |
|---|---|
| `G-Problem` | No measurable success metric; no identified user; scope contradicts constraints |
| `G-Product` | Capability without acceptance summary; non-numeric NFR; unresolved blocking OQ |
| `G-Design` | Missing ADR coverage; undefined interface refs; KB contradiction; unmodelled NFR; missing or drifted required diagrams (C4 context/container, ER, sequence per cross-boundary flow) |
| `G-Foundation` | Clean clone doesn't build; no reproducible install; CI skeleton absent; no test command; walking skeleton not deployed to a development environment |
| `G-Ready` | DoR violations; story overlap in file claims; unbound ACs; oversized stories |
| `G-Verify` | Failing tests; AC coverage < 100% for done stories; coverage below threshold; lint/typecheck |
| `G-Stable` | Open Sev1/Sev2 defects; flaky tests above threshold; unresolved RCA |
| `G-Integration` (L4) | Cross-service contract tests failing; version skew; migration order violations |
| `G-Deliver` | Deploy dry-run fails; rollback untested; secrets unresolved; smoke tests fail in target env; deployment topology and pipeline diagrams missing or stale |
| `G-Operate` | No dashboards/alerts for stage SLOs; runbook missing for each Sev1 failure mode; KB not synced |

## 10.4 Stages and milestones

`forge plan stages` produces `docs/forge/plans/stages.md`:

```yaml
stages:
  - id: mvp
    name: "MVP — first invoice sent"
    goal: "A single agency owner can sign up, create an invoice and email it."
    capabilities: [ CAP-001, CAP-002, CAP-004 ]
    excluded: [ CAP-007, CAP-011 ]
    exit_criteria:
      - "All must-capabilities done and verified"
      - "Deployed to staging; smoke suite green"
      - "MET-001 instrumented (target not yet required)"
    nfr_subset: [ NFR-0002 ]           # NFRs enforced at this stage
    risks: [ RISK-003 ]
    estimated: { stories: 18, cost_usd: 140, wall_clock: "3-5 days" }
  - id: m2
    name: "Milestone 2 — get paid"
    depends_on: [ mvp ]
    ...
```

**Stage design rules:**
- Every stage must be independently *deployable and demonstrable* — no "integration stage at the end."
- The first stage MUST include a thin end-to-end slice through every architectural layer
  (a "walking skeleton"): it proves the architecture, the build, the pipeline and the test harness
  before volume work begins. This is enforced: `G-Ready` for stage 1 fails if the stage plan contains
  no story tagged `walking-skeleton`.
- NFRs are staged too: an NFR may be *deferred* to a later stage explicitly, never implicitly.
- Each stage has its own budget and its own retro.

## 10.5 Built-in workflows

| id | Purpose | Levels |
|---|---|---|
| `intake` | Idea → level, constraints, glossary seed | all |
| `discover` | Problem/users/market/metrics | L2+ |
| `define-product` | Vision, PRD, capabilities, NFRs, UX spec | L2+ |
| `shape-solution` | Architecture, ADRs, domain/data model, tech selection, threat model | L2+ |
| `initialize-project` | Repo, build, scaffolding, CI skeleton, dev env | L2+ (greenfield) |
| `plan-stages` | Stage/milestone decomposition | L2+ |
| `plan-stage` | Epics, stories, test plan, run plan for one stage | L1+ |
| `build-stage` | The main implementation loop (above) | L1+ |
| `implement-story` | Single story loop | all |
| `quick-fix` | L0 fast path: reproduce → test → fix → verify → commit | L0 |
| `verify-stage` | Full verification incl. NFR benchmarks | L1+ |
| `debug` | Autonomous RCA loop | all |
| `harden` | Security/perf/reliability pass against NFRs | L2+ |
| `refactor` | Test-guarded refactor with an explicit goal and invariant set | all |
| `deliver-stage` | Pipeline, environments, deploy, smoke, rollback rehearsal | L2+ |
| `operate` | Observability, SLOs, runbooks, alerting | L2+ |
| `adopt` | Brownfield ingestion (see `17`) | all |
| `migrate` | Schema/platform/framework migration with expand-contract | L3+ |
| `retro` | Structured retrospective + KB write-back | all |
| `replan` | Change proposal + impact analysis + re-derivation | all |

## 10.6 The story implementation loop (canonical inner loop)

This is the loop that most determines output quality. Normative sequence per story:

```
1. context      Pack: story, ACs, interfaces, data model, standards, relevant KB, prior art in repo
2. plan         Agent writes an implementation plan (files, approach, risks) → validated against
                the story's file claim; plan is an artifact, reviewed at 'supervised'
3. red          sdet (separate session) writes failing tests bound to each AC; run → must fail
                for the right reason (assert the failure message, not just non-zero exit)
4. green        owner role implements until tests pass; may not edit test files (enforced by claim)
5. refactor     same agent, tests must stay green; no behaviour change allowed
6. self-verify  run the story's DoD check set; attach outputs
7. review       reviewer (separate session) + swarm perspectives; blocking findings loop back to 4
8. document     update public API docs, regenerate any affected generated diagrams, KB proposals for
                any decision made
9. commit       conventional commit with trailers; lane ready for merge
10. merge       merge queue (pre-checks → merge → post-checks); revert on post-check failure
```

**Enforced separations:** the agent that writes tests is never the agent that makes them pass
(step 3 vs 4), and the reviewer is never the implementer. Test files are outside the implementer's
file claim; an attempt to modify them is a policy violation, surfaced immediately. This kills the
single most common failure mode — an agent "fixing" a test to make it pass.

Exception path: if the implementer believes a test is wrong, it emits `FORGE_REQUEST_CHANGE` against
the test with a justification; the sdet adjudicates. This is recorded and counted — a high rate of
test-change requests is a signal that ACs are poorly specified and surfaces in the retro.
