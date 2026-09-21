# 09 — Spec-Driven Development

## 9.1 The core contract

> No production code exists without a Task; no Task without a Story; no Story without a Capability;
> no Capability without a Vision statement. And no Story is complete without a Test that binds to its
> acceptance criteria.

This is enforced mechanically, not aspirationally. `forge spec validate` and the `G-Ready`/`G-Verify`
gates fail on any break in the chain.

## 9.2 Artifact hierarchy and IDs

```
VISION                      (exactly one, VIS-001)
  └─ CAP-###                Capability — a user-meaningful ability of the product
       ├─ NFR-###           Non-functional requirement (may also attach to the system)
       ├─ EPIC-###          A coherent slab of work delivering part of a capability
       │    └─ STORY-###    A vertically-sliced, independently verifiable increment
       │         ├─ TASK-###   An agent-executable unit of work
       │         └─ AC-###     Acceptance criterion (machine-parseable)
       │              └─ TEST-###  A test that proves exactly one AC
       └─ RISK-### / ASM-### / OQ-###
Cross-cutting: ADR-#### · INT-### (interface contract) · DM-### (data model element) ·
               ENV-### (environment) · RUN-### (runbook) · WAIVER-### · SESSION-### ·
               DIAG-### (validated diagram artifact, see `08` §8.11)
```

**ID rules:**
- Monotonic per type, zero-padded to 3 (4 for ADR), never reused, allocated by `@forge/core/ids`
  through a single counter file `.forge/state/ids.json` (committed? **no** — derived from a scan of
  existing artifacts at startup, with the file as a cache; this avoids merge conflicts).
- IDs appear in front matter, in file names, in commit trailers, in test names, and in code comments
  at the top of files primarily implementing a story.

## 9.3 Artifact schemas (essentials)

### Vision (`VIS-001`)
```yaml
id: VIS-001
product: acme-billing
one_liner: "Invoicing that a 3-person agency can run without a bookkeeper."
problem: KB-PROD-0001
target_users: [ persona:agency-owner, persona:freelancer ]
value_hypothesis: "…"
success_metrics:
  - id: MET-001
    statement: "Median time from signup to first sent invoice"
    baseline: unknown
    target: "< 10 minutes"
    instrumentation: "event:invoice_sent minus event:signup"
non_goals: [ "payroll", "multi-currency at MVP" ]
horizon: "MVP in 6 weeks"
```

### Capability (`CAP-###`)
```yaml
id: CAP-004
title: Send an invoice to a client
statement: "As an agency owner, I can create and send a branded invoice so that I get paid."
priority: must            # must | should | could | wont (MoSCoW) + RICE score optional
stage: mvp
depends_on: [ CAP-002 ]
nfrs: [ NFR-0002, NFR-0007 ]
metrics: [ MET-001 ]
acceptance_summary: "An invoice can be created, previewed, sent by email, and viewed by the client."
epics: [ EPIC-003, EPIC-005 ]
```

### NFR (`NFR-###`) — **must be numeric and verifiable**
```yaml
id: NFR-0002
category: performance     # performance | availability | scalability | security | privacy |
                          # maintainability | operability | cost | accessibility | compliance
statement: "Invoice list page returns in under 300 ms at p95 for accounts with ≤ 5000 invoices."
metric: "http_server_duration_p95{route=/invoices}"
target: "< 300ms"
conditions: "warm cache, 5k invoices, 50 rps"
verification:
  kind: test              # test | benchmark | monitor | review | audit
  ref: TEST-231
  command: "pnpm bench:invoices --p95 300"
applies_to: [ component:api, component:web ]
```
A non-numeric NFR ("should be fast") is a validation **error**. This is the single most common
requirements defect and FORGE refuses it.

### Epic (`EPIC-###`)
```yaml
id: EPIC-003
title: Invoice creation and rendering
capability: CAP-004
stage: mvp
goal: "A user can build an invoice and see an accurate preview."
scope_in: [ "line items", "tax rates", "branding logo" ]
scope_out: [ "recurring invoices" ]
stories: [ STORY-011, STORY-012, STORY-014 ]
interfaces: [ INT-004, INT-007 ]
data: [ DM-002, DM-003 ]
exit_criteria:
  - "All stories done; e2e 'create and preview invoice' passes in staging."
```

### Story (`STORY-###`) — the central execution unit
```yaml
id: STORY-014
title: Render invoice preview from line items
epic: EPIC-003
capability: CAP-004
type: feature             # feature | tech | spike | bug | chore | migration
size: M                   # S | M | L  (L must be split before G-Ready)
status: ready             # draft | ready | in-progress | in-review | verified | done | blocked
owner_role: backend
depends_on: [ STORY-011 ]
blocked_by: []
interfaces: [ INT-004 ]
data: [ DM-002 ]
files_expected:           # the ownership claim used by the scheduler
  - "src/billing/preview/**"
  - "tests/billing/preview/**"
context_refs: [ KB-ARCH-0007, ADR-0011, NFR-0002 ]
acceptance:
  - id: AC-014-1
    given: "an invoice with 3 line items and a 10% tax rate"
    when: "the preview is requested"
    then: "the subtotal, tax and total are computed to 2 decimal places and match the expected values"
    kind: functional
  - id: AC-014-2
    given: "an invoice with 0 line items"
    when: "the preview is requested"
    then: "a 422 is returned with error code INVOICE_EMPTY"
    kind: error-handling
  - id: AC-014-3
    given: "5000 concurrent preview requests"
    when: "measured at p95"
    then: "latency stays under 300ms"
    kind: nfr
    nfr: NFR-0002
tests: [ TEST-231, TEST-232, TEST-233 ]
dod_profile: backend-default
```

**Story quality rules (checked at `G-Ready`, the Definition of Ready):**
1. Vertically sliced — delivers observable value or an explicitly-labelled technical enabler.
2. Every AC is Given/When/Then and independently testable.
3. Every AC has at least one bound test ID before implementation starts (tests may not exist yet, but
   IDs are allocated and the test plan names them).
4. `files_expected` is non-empty and doesn't overlap another `ready` story's claim.
5. All `context_refs` resolve; no open `OQ-###` blocks it.
6. Size ≤ M, or it is split.
7. It names its NFR obligations explicitly (or declares `nfr: none` deliberately).
8. `owner_role` names an implementation role: an agent of the project's roster that produces code (declares a
   `Code` output). The `implement-story` steps run as the owner with that agent's write grant, so a
   document-authoring or judging role (`analyst`, `pm`, `security`, `reviewer`, `sdet`) may not own a story;
   `forge spec validate` reports it for a story at any status and `G-Ready` for a ready one.

### Task (`TASK-###`)
Optional decomposition inside a story when a story needs multiple agent steps
(e.g. `TASK-041 write failing tests`, `TASK-042 implement`, `TASK-043 wire route`).
Tasks are generated by the workflow, not usually hand-authored.

## 9.4 Traceability

`@forge/core/graph` maintains a typed graph. Required edges:

| From | Edge | To | Required |
|---|---|---|---|
| CAP | `realises` | VIS | yes |
| EPIC | `delivers` | CAP | yes |
| STORY | `partOf` | EPIC | yes |
| AC | `belongsTo` | STORY | yes |
| TEST | `proves` | AC | yes (1 test proves exactly 1 AC; an AC may have many tests) |
| TASK | `implements` | STORY | yes |
| COMMIT | `implements` | STORY | yes (via trailer) |
| FILE | `primaryFor` | STORY | advisory (from claims + commit history) |
| ADR | `constrains` | EPIC/STORY/component | as applicable |
| INT | `consumedBy` | STORY | yes when the story calls it |
| NFR | `verifiedBy` | TEST/benchmark/monitor | yes |

`forge spec matrix` produces `docs/forge/specs/traceability.md` (and `.json`):

```
CAP-004  Send an invoice
  ├ EPIC-003 Invoice creation           [3/3 stories done]
  │   ├ STORY-011 ✓  AC 2/2  tests 4/4 ✓
  │   ├ STORY-012 ✓  AC 3/3  tests 5/5 ✓
  │   └ STORY-014 ●  AC 3/3  tests 2/3 ✗ (AC-014-3 unproven)
  └ EPIC-005 Invoice delivery           [0/2 stories]
NFR coverage: 7/9 verified · 2 unproven (NFR-0005, NFR-0009)
Orphans: 0 stories · 1 test (TEST-198 proves no AC)
```

Gate checks derived from the matrix:
- `spec:orphans` — 0 orphan stories/tests. (Error)
- `spec:ac-coverage` — every AC of every `done` story has ≥1 passing test. (Error at `G-Verify`)
- `spec:nfr-coverage` — every `must` NFR in the current stage has a verification artifact. (Error at
  `G-Deliver`)
- `spec:capability-coverage` — every `must` capability in the stage has a `done` epic. (Error at
  stage exit)

## 9.5 From AC to test: the binding rule

Acceptance criteria are written in a **structured Given/When/Then** with an explicit `kind`. The
`sdet` agent generates tests that:

1. Are named with the AC id: `AC-014-2 returns 422 for an empty invoice`.
2. Carry a machine-readable annotation so the harness can map results back:
   - JS/TS: `test('AC-014-2 …', { annotations: [{ type: 'forge-ac', description: 'AC-014-2' }] })`
     or a naming convention parsed from the reporter output — whichever the framework supports.
   - Python: `@pytest.mark.forge_ac("AC-014-2")`
   - Java: `@Tag("forge-ac:AC-014-2")`
   - Go: test name prefix `TestAC_014_2_…`
   - Generic fallback: the ID appears in the test name and is regex-extracted from the report.
3. Emit results into a normalised report (`docs/forge/reports/test-results.json`) mapping
   `AC id → pass/fail/skipped/missing`.

This mapping is what makes "done" mean something. A story cannot reach `verified` while any of its
ACs is `missing` or `failing`.

## 9.6 Specs for the system itself (technical specs)

Not everything is a user story. FORGE has three technical spec artifacts:

| Artifact | Purpose | Produced by |
|---|---|---|
| **Tech Spec (`TS-###`)** | Design of a non-user-facing subsystem (auth, queue, migration) with the same AC discipline | `architect` + owner role |
| **Interface Contract (`INT-###`)** | The frozen, machine-readable contract (OpenAPI / SDL / proto / TS types / JSON Schema / event schema) | `architect` / `integration-architect` |
| **Data Model element (`DM-###`)** | Entity, table, index, or migration with its invariants | `data-architect` |
| **Diagram (`DIAG-###`)** | A validated, text-based view that clarifies a structure, sequence or state; generated from the artifacts above wherever derivable | owning role per section |

Interface contracts live in `docs/forge/specs/interfaces/` and MUST be *the* source used for
codegen where the stack supports it (openapi-typescript, protoc, graphql-codegen, sqlc, prisma…).
Hand-written duplicates of a contract are a lint error.

## 9.7 Change management of specs

Specs change. FORGE makes change explicit:

1. A change originates from: a gate failure, a discovered constraint, a human request, or a
   contract-change request from a lane.
2. `forge plan replan --from <event>` produces a **Change Proposal** artifact: what changes, which
   artifacts are affected (computed from the graph), what work is invalidated, cost/time delta.
3. Human approves (always, at every autonomy level, when the change touches an accepted ADR of
   reversibility ≥ `medium`, or invalidates completed work).
4. Applied as a versioned edit: artifacts get `revision` bumps and a `changelog` entry in front
   matter; superseded ACs are marked, not deleted; affected tests are re-derived.
5. Lanes working on invalidated stories are stopped and their work is either salvaged (rebased onto
   the new spec) or abandoned with the diff retained.

Nothing is silently rewritten. `forge spec diff --since <ref>` shows spec evolution over time.

## 9.8 Definition of Ready / Definition of Done

Stored in `docs/forge/kb/engineering/definition-of-done.md`, profile-based, machine-checked.

```yaml
# canonical: dod-profiles.yaml
profiles:
  backend-default:
    ready:
      - story.acceptance.length > 0
      - story.files_expected.length > 0
      - check: spec:story-refs-resolve
      - check: spec:no-blocking-open-questions
    done:
      - check: build:typecheck
      - check: build:lint
      - check: test:unit --scope story
      - check: test:integration --scope story
      - check: spec:ac-coverage --story
      - check: review:blocking-findings == 0
      - check: security:secrets-scan
      - check: docs:public-api-documented
      - check: kb:no-new-contradictions
  frontend-default: { … }
  data-default:     { … includes data contract tests and migration dry-run … }
```

Profiles are selected per story via `dod_profile`. A story cannot be marked `done` unless every
`done` check passes — and the checks are commands, not opinions.
