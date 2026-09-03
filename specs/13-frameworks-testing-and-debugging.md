# 13 — Decision Frameworks III: Testing, Quality Gates and Debugging

The organising constraint for everything in this file: **agents must be able to execute, interpret
and act on these processes without a human in the loop.** A test strategy a human can run but an
agent cannot interpret is worthless to FORGE. Every decision here is therefore evaluated twice —
once for engineering merit, once for machine-executability.

---

## 13.1 Testing frameworks

Owner: `test-architect` (strategy) and `sdet` (implementation). Outputs land in
`kb/engineering/testing.md`, `docs/forge/specs/test-plan.md`, and real test code.

### F-TEST-1 · Test strategy and pyramid shape

Decides the shape of the suite and, critically, the **budget** for each layer. An unbudgeted pyramid
inverts within weeks because agents write whatever is easiest to make pass.

| Layer | What it proves | Default target | Speed budget | Isolation |
|---|---|---|---|---|
| **Unit** | A pure function or class behaves per spec | 60–70% of tests | < 5 ms each; whole layer < 60 s | No I/O, no clock, no network |
| **Integration** | A component works against a real dependency (DB, queue, cache) | 20–30% | < 500 ms each; layer < 5 min | Real dependency via testcontainers or an ephemeral instance |
| **Contract** | Two sides of an interface agree | one per `INT-###` consumer/provider pair | < 100 ms each | No live counterparty |
| **E2E** | A user-visible capability works through the whole system | 5–10%, one per `CAP-###` happy path + top failure path | < 30 s each; layer < 10 min | Full stack, seeded data |
| **NFR** (benchmark/load/chaos) | An `NFR-###` numeric target holds | one per `must` NFR in the stage | out-of-band, nightly | Dedicated environment |

**Normative rules:**

1. **Integration tests use real dependencies, not mocks of them.** Mocking the database means testing
   your mental model of the database. Use testcontainers (or the ecosystem equivalent); if the
   environment cannot run containers, that constraint is recorded in the KB and the strategy changes
   deliberately rather than silently.
2. **Mocks are permitted only at process boundaries you do not own** (third-party HTTP APIs, payment
   providers, email). Those get contract tests against a recorded/verified schema in addition.
3. **No test may depend on another test's side effects or on execution order.** Enforced by running
   the suite in randomised order in CI (`--shuffle` / `-p no:randomly` inverted / `-shuffle on`).
4. **Every layer has a single command** recorded in the KB: `test:unit`, `test:integration`,
   `test:contract`, `test:e2e`, `test:nfr`. Gates invoke these, never ad-hoc invocations.
5. The pyramid targets are *budgets, not floors*: exceeding the E2E share triggers a warning at
   `G-Verify` because it signals unit-level gaps being papered over.

### F-TEST-2 · Test oracle design

**This is the framework that most determines whether agent-written tests are worth anything.** An
oracle is the answer to "how do we know the output is right?" Agents default to the weakest oracle
available — asserting that the code did what the code does — and this framework forbids that.

Oracle strength, strongest first. The framework requires the strongest oracle *available* for each
AC and records why weaker ones were rejected:

| # | Oracle | Example | Use when |
|---|---|---|---|
| 1 | **Specified value** | `total === 110.00` computed by hand from the AC | The AC states a concrete expected result — always prefer this |
| 2 | **Inverse / round-trip** | `parse(serialize(x)) === x` | Encoders, serialisers, migrations |
| 3 | **Metamorphic relation** | Adding a line item never decreases the total; sorting is idempotent | Numeric/aggregate logic where exact values are tedious |
| 4 | **Property / invariant** | Generated inputs never produce a negative balance | Domain invariants; use property-based testing |
| 5 | **Differential** | New implementation matches the old one on the same inputs | Refactors and migrations |
| 6 | **Reference implementation** | Compare against a trusted library | Crypto, date maths, currency |
| 7 | **Golden file** | Rendered output matches a reviewed snapshot | Documents, HTML, generated code |
| 8 | **Smoke** | It returns 200 and doesn't throw | Last resort only; never sufficient for an AC |

**Banned oracle patterns** — these fail `test:oracle-lint`:

- Asserting on a value read from the same code path that produced it.
- `expect(result).toBeDefined()` / `toBeTruthy()` as the only assertion for an AC.
- Snapshot tests created by recording current behaviour without human or spec review
  (a snapshot is a golden file only if someone *decided* it was correct).
- Tests whose assertions are derived from the implementation's constants rather than the AC's.
- `try { … } catch { /* pass */ }` and unconditional `expect(true)`.

Golden files carry a header recording who approved them and against which AC; regenerating a golden
file is a reviewable diff, never a silent `-u` run in CI.

### F-TEST-3 · Test data strategy

Decides: fixture style (factories over fixtures — factories with sensible defaults and explicit
overrides make the *relevant* field obvious in each test), seeding, isolation between tests
(transaction rollback vs truncate vs fresh schema per worker), production-like volume for performance
tests, and PII handling (never real production data; a synthesis or masking approach is recorded).

Normative: **each test creates the data it needs and names the fields that matter.** Shared mutable
fixtures are the leading cause of order-dependent flakes and of tests that pass for the wrong reason.

### F-TEST-4 · Environment and dependency strategy for tests

Decides how each layer gets its dependencies: in-process fake, testcontainer, shared dev instance,
ephemeral cloud environment. Records the trade-off per dependency and — importantly for FORGE — which
of these an **agent lane can start offline**, since a lane that cannot run its own integration tests
must defer them to the merge queue, which slows the whole loop.

Output includes a `test:preflight` command that verifies the environment can run each layer and
prints exactly what is missing.

### F-TEST-5 · Coverage and adequacy

Coverage is a *floor detector*, not a quality measure, and the framework says so explicitly to stop
agents optimising for it.

- Line/branch thresholds per package, set at the current level and ratcheted upward only
  (`coverage:ratchet` fails if coverage drops, which is far more useful than an absolute target).
- **Mutation testing** on core domain packages (Stryker/mutmut/PIT) as the real adequacy signal, run
  nightly rather than per-commit. A surviving mutant in domain logic is a missing test, and it is a
  finding an agent can act on directly.
- **AC coverage is the binding metric**, not line coverage: every AC of every `done` story has ≥1
  passing bound test (`09` §9.5). A story at 95% line coverage with an unbound AC still fails.

### F-TEST-6 · Flake control

Flaky tests destroy autonomous loops — an agent cannot distinguish a flake from a regression, so it
either ignores real failures or thrashes on noise. The framework mandates:

- Every test failure is retried **once, in isolation**, purely to classify it: consistent failure =
  real; passes on retry = flake candidate.
- Flake candidates are recorded in `docs/forge/reports/flaky.json` with a rolling failure rate.
- Above the configured rate (default 2% over 20 runs) a test is **quarantined**: excluded from the
  gate, and a `STORY` is auto-created to fix it with a deadline. Quarantine is visible in every gate
  report and capped (default 5) — beyond the cap, `G-Verify` fails, because a suite with 20
  quarantined tests is not a suite.
- Retries are **never** used to make a gate pass. Retry-to-classify and retry-to-green are different
  things, and conflating them is how test suites die.

### F-TEST-7 · Making tests agent-executable

The specific design requirements that let agents own testing:

1. **One command per layer**, exit code meaningful, no interactive prompts, no TTY requirement.
2. **Machine-readable output**: JUnit XML or the framework's JSON reporter, written to a known path.
   FORGE normalises it into `docs/forge/reports/test-results.json` mapping AC id → outcome.
3. **Failure output must be diagnosable from text alone**: assertion diffs, not screenshots; stack
   traces with source; the failing input printed for property-based tests (seed included so it
   reproduces).
4. **Deterministic**: seeded randomness, injected clock, no reliance on wall time, timezone pinned in
   the test env, network denied by default in unit tests.
5. **Selectable**: run by file, by name pattern, and by AC id, so an agent can iterate on one failure
   without a 10-minute cycle.
6. **Fast feedback tier**: a `test:affected` command using the build system's dependency graph, so
   the inner loop stays under ~60 s.

---

## 13.2 The autonomous debugging framework (`forge debug`)

Owner: `diagnostician`. This is the loop that turns a symptom into a root cause, a fix, and a
regression test — without human diagnosis. It is a strict state machine, because the failure mode of
agent debugging is thrashing: changing things until the symptom disappears.

### F-DEBUG-1 · The RCA loop

```
INTAKE → REPRODUCE → ISOLATE → HYPOTHESISE → FALSIFY → DIAGNOSE → FIX → PROVE → PREVENT → RECORD
             ▲            │                       │
             └────────────┴───────────────────────┘   (bounded iterations)
```

**1. INTAKE.** Normalise the symptom into a `DefectRecord`: observed vs expected behaviour, first
seen, frequency, environment, severity (Sev1–4), affected `CAP`/`STORY`, and evidence (failing test,
stack trace, log excerpt, trace id, screenshot). Refuse to proceed on a symptom that cannot be stated
as "expected X, observed Y" — vagueness here guarantees thrashing later.

**2. REPRODUCE.** Produce a **deterministic, minimal reproduction** as an executable artifact — a
failing test, a script, or a command. This is a hard gate: **no fix may be attempted before a
reproduction exists.** If reproduction fails after the configured attempts, the loop exits to
`NEEDS-MORE-EVIDENCE` with a precise list of what instrumentation would make it reproducible
(this is a legitimate, useful outcome, not a failure).

Reproduction techniques, in order of preference: existing failing test → new test from the AC →
replay from logs/trace → property-based search for the failing input → bisect over inputs.

**3. ISOLATE.** Narrow the fault domain before theorising. Permitted techniques:
- `git bisect` (automated, with the reproduction as the test) when a working commit is known.
- Binary search over the call path with targeted instrumentation.
- Delta debugging over the input to find the minimal failing case.
- Layer isolation: does it fail at the unit, integration, or e2e layer? The lowest layer that
  reproduces it is where the bug lives.
Output: the narrowest scope in which the symptom still reproduces.

**4. HYPOTHESISE.** State **at least three** candidate causes, each phrased as a falsifiable claim
with the observation that would refute it. Requiring three is deliberate: a single hypothesis becomes
a conclusion, and the agent starts fitting evidence to it.

**5. FALSIFY.** For each hypothesis, run the cheapest experiment that could *disprove* it. Record the
result. Hypotheses are eliminated by evidence, not by preference. If all three survive or all three
die, gather more evidence and return to ISOLATE — do not proceed on a hunch.

**6. DIAGNOSE.** State the root cause as a causal chain: *this condition* → *this code path* →
*this incorrect state* → *the observed symptom*. Then apply the **five-whys stop rule**: continue
asking why until the answer is a decision, a missing check, or a wrong assumption — not "the code was
wrong". A diagnosis that bottoms out at "a typo" for a Sev1/Sev2 defect is incomplete: the real
question is why nothing caught it.

**7. FIX.** Fix the root cause, not the symptom. The diff must be minimal and must not touch
unrelated code. Explicitly forbidden: broadening a `catch`, adding a retry to mask a race, loosening
an assertion, adding a sleep, adding a null-check that hides an invalid state upstream. Each of these
is checked for in the fix diff and blocks the loop with an explanation.

**8. PROVE.** The reproduction from step 2 now passes; it is promoted to a permanent **regression
test** named with the defect id. The full affected test layer passes. If the defect was a race, the
proof must include a test that fails reliably against the *old* code (verified by reverting the fix
in a scratch worktree and confirming red) — otherwise the "proof" proves nothing.

**9. PREVENT.** Answer: *what class of defect is this, and what would catch the next one?* Outputs
one or more of: a new lint rule, a type-level constraint that makes the state unrepresentable, a new
contract test, a monitor/alert, a KB entry, or a standards update. Sev1/Sev2 defects **require** a
prevention action; closing one without a prevention action is refused.

**10. RECORD.** Write an `RCA-###` artifact to `docs/forge/sessions/rca/`:

```yaml
id: RCA-007
defect: DEF-014
severity: Sev2
symptom: "Invoice totals off by one cent on 3-item invoices with 10% tax"
reproduction: tests/billing/regression/RCA-007.test.ts
timeline: [ { first_seen: 2026-03-09 }, { detected_by: "e2e AC-014-1" } ]
hypotheses:
  - claim: "Rounding applied per line rather than on the subtotal"
    refuted_by: null
    status: confirmed
  - claim: "Tax rate stored as float"
    refuted_by: "DB column is numeric(5,4); verified by migration 0007"
    status: refuted
  - claim: "Currency conversion drift"
    refuted_by: "single-currency at MVP; no conversion code path executed"
    status: refuted
root_cause: >
  Line-level rounding accumulates error. Introduced in STORY-011 where `round()` was applied inside
  the map rather than to the reduced subtotal, because the AC did not specify the rounding point.
causal_chain: [ "AC-011-2 omitted rounding semantics", "implementer chose per-line rounding",
                "3+ items compound the error above 0.005", "displayed total mismatches sum" ]
fix: src/billing/preview/total.ts
prevention:
  - "Property test: total always equals round(sum(raw_lines)) for any line set"
  - "KB: DM-002 now states rounding is applied once, at the subtotal, banker's rounding"
  - "Standards: monetary arithmetic uses the Money type; float arithmetic on money is a lint error"
blast_radius: [ STORY-011, STORY-014, DM-002 ]
kb_writes: [ KB-DATA-0011 ]
time_to_diagnose_min: 14
```

### F-DEBUG-2 · Loop bounds and escalation

| Bound | Default | On breach |
|---|---|---|
| Reproduction attempts | 5 | Exit to `NEEDS-MORE-EVIDENCE` with an instrumentation plan |
| Hypothesis rounds | 3 | Escalate to a stronger model, then to a human with the evidence file |
| Fix attempts | 3 | Revert all fix attempts, restore the lane, escalate — never leave partial fixes |
| Wall clock | 45 min | Checkpoint and escalate |
| Cost | step budget | Pause and ask |

**Anti-thrash rule:** the loop hashes each attempted fix diff. A repeated or near-identical diff
(normalised) is refused, and the loop is forced to ISOLATE with the note that its hypothesis space is
exhausted. Repetition without variation is the signature of a stuck agent.

### F-DEBUG-3 · Observability as a debugging precondition

`forge debug` is only as good as the evidence available, so the delivery framework (`14`) mandates
the following *before* a stage can pass `G-Operate` — and `forge debug` reports which of them were
missing when a diagnosis fails:

- Structured logs with a correlation/trace id spanning every request and background job.
- An error taxonomy: every thrown error carries a code, and codes are enumerated in the KB.
- Trace propagation across every async boundary (queue messages carry trace context).
- The ability to retrieve the exact input that caused a failure (request logging with PII redaction).
- A `debug:context <trace-id>` command that assembles logs, traces, and relevant state for an agent.

A defect that cannot be diagnosed because of missing observability produces a *prevention action to
add that observability* — the loop feeds its own improvement.

---

## 13.3 Review as a quality mechanism

Owner: `reviewer`, invoked as `swarm-review` (`05` §5.7) for risky changes.

### F-REVIEW-1 · Review perspectives

Each perspective is a separate pass with its own checklist, and each produces findings at
`blocking` / `major` / `minor`:

| Perspective | Asks |
|---|---|
| **Spec conformance** | Does this implement the story's ACs, and only them? Is anything out of claim? |
| **Design** | Does it fit the architecture and the chosen patterns? Does it add a boundary violation? Is there a simpler shape? |
| **Correctness** | Edge cases, off-by-one, null/empty/unicode, concurrency, error paths, resource cleanup |
| **Security** | Input validation, authz on every path, injection, secrets, dependency risk, output encoding |
| **Performance** | N+1 queries, unbounded results, missing index, sync work on a hot path, allocation in loops |
| **Testing** | Oracle strength, AC binding, failure-path coverage, flake risk, test readability |
| **Operability** | Logs/metrics for the new path, failure modes, config, migration safety, rollback |
| **Documentation** | Public API documented, KB updated, diagram updated if structure changed |

Findings are deduplicated across perspectives and returned as one report. **Blocking findings must be
resolved or explicitly waived; `major` findings must be resolved or converted into tracked stories
before `G-Verify`.** Minor findings are advisory.

### F-REVIEW-2 · What review is not allowed to be

- Review is **advisory to gates, never a gate pass by itself** (`README` principle 5).
- A reviewer may not approve a change it authored (`CFG-501`).
- "Looks good" with no findings and no evidence of having examined the failure paths is itself a
  finding: the review report must state what it checked, so an empty review is visibly empty.

---

## 13.4 Gate integration summary

| Gate | Testing/debugging checks |
|---|---|
| `G-Ready` | Every AC has an allocated test id; test plan exists for the stage; `test:preflight` passes |
| `G-Verify` | All layers pass; AC coverage 100% for done stories; coverage ratchet not violated; oracle lint clean; quarantine count under cap; E2E share within budget |
| `G-Stable` | No open Sev1/Sev2; every closed Sev1/Sev2 has an `RCA-###` with a prevention action; flake rate under threshold; every regression test bound to its defect id |
| `G-Operate` | Debugging preconditions (§13.2 F-DEBUG-3) satisfied for the new paths |
