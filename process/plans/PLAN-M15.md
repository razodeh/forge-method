# PLAN-M15 — Evidence over ceremony: gates that prove, not gates that check

**Status: plan. Nothing here is built.** Post-v1.0; the `specs/22` M15 entry is written with this plan
(spec first), so no P0 piece exists. Pieces take the next free `SPEC-QUESTIONS.md` number at commit
time; the log entry is `## M15 P<n>` in `process/GAUNTLET-LOG.md`. M14 pieces are cited as `M14 P<n>`.

**Line references are deliberately omitted.** Every `Surface` below names real files and real symbols,
verified to exist; none carries a `:line` citation, because this plan was written without a
file-by-file line audit. A line-reference pass over each piece is part of that piece's own BUILD step,
not a claim this plan already makes. Disclosed here rather than faked.

## Why this milestone exists

FORGE was built by a stricter discipline than the one it ships.

Its own construction had an oracle: a spec pack written before the code by a different party than the
implementer, tests derived from that spec before implementation, a fresh context-free critic who could
not inherit the author's rationalisations, a bounded round loop that stopped and disclosed rather than
looping forever, and — the part that actually bites — **mutation evidence**: revert the fix, confirm
the exact expected failure reproduces, restore, confirm green. `GAUNTLET-LOG.md` carries hundreds of
these.

What a user's project gets is different in kind. `G-Verify` (`checks/G-Verify.gate.yaml`) asks whether
tests ran, whether coverage cleared a threshold, whether the ratchet regressed, whether lint and
typecheck are clean. `G-Design` asks whether documents exist and validate. These are **structural**
facts. Not one of them can distinguish a test suite that binds to real behaviour from one that passes
no matter what the implementation does. A green gate currently certifies diligence and reads as
correctness — which is worse than certifying nothing, because it is trusted.

Shopify's Helix (`shopify.engineering/helix`, reviewed 2026-09-28) demonstrates the alternative at
production scale: checkpoints that cannot ship until behaviour-equivalence and visual-equivalence
gates pass against a reference implementation. Its oracle is a real one — and it does not generalise,
because greenfield work has no reference app. But FORGE's own history contains an oracle that **does**
generalise and needs no reference implementation: a test that does not fail when you break the thing it
claims to test is not a test. That is mutation binding, and it is the spine of this milestone.

Two supporting gaps close with it. The build process's bounded critic loop (review → fix → re-review,
capped, then *stop and disclose*) ships as a real workflow loop. And the build process's honesty
ledger (`SPEC-QUESTIONS.md` — every divergence, trade-off and known gap recorded rather than absorbed)
gets a user-project equivalent, so a disclosed gap cannot quietly evaporate.

Finally: FORGE currently cannot be wrong. There is no measurement, no baseline, no falsifiable claim.
This milestone emits the metrics from its first piece so that M16 and M17 have a genuine before-picture
rather than a retrospective assertion.

## Decisions this plan commits to

These are proposed for owner sign-off and become a binding `SPEC-QUESTIONS.md` entry at P1 commit time.

1. **A test that does not bind is not a test.** `test:binding` becomes a deterministic gate check on
   `G-Verify`, failing the gate, not warning.
2. **Coarse binding first, honestly.** v1 mutation is *revert the story's implementation hunks* — it
   proves the named tests bind to that change as a whole. Per-hunk and operator mutation are named as
   future work, not implied.
3. **Evidence is an artifact, not a log line.** `MutationEvidence` and `EvidenceBundle` are registered
   artifact types with ids, provenance and schemas, committed beside the work.
4. **A verdict without evidence is not a verdict.** A gate whose `evidence:` references resolve to
   nothing is a validate error, not a pass.
5. **Exemptions are declared, reasoned, owned and expiring** — and a stale exemption fails the check,
   exactly as `test/brief-write-paths-in-claim.test.ts`'s own `seenExempt` staleness rule already does
   for its `EXEMPT` list. A permanent silent exemption is the failure mode this forecloses.
6. **The critic loop stops and discloses.** Bounded rounds (default 3); on exhaustion the unresolved
   findings are written to the project's disclosure ledger and the step reports honestly. It never
   loops unbounded and never silently passes.
7. **Measurement from the first piece**, so improvement is provable rather than asserted.
8. **Every new capability is a stateless `forge <noun> <verb> --json` command.** This is not a style
   preference: the gate format already invokes checks exactly this way, and it is what keeps this
   milestone neutral with respect to the open orchestration question (see Prerequisite below).

**Error codes.** Current highest: `RUN-109`, `GATE-514`, `CFG-509`, `KB-031`, `VCS-010` (verified in
`packages/core/src/errors/codes.ts`). This milestone takes `RUN-110`..`RUN-114` and `GATE-515`;
holes are not reused. Exact assignment happens per piece at commit time.

## Prerequisite this plan is deliberately neutral about

An open strategic question — whether FORGE keeps its own orchestration runtime or becomes a method
that rides a host platform's agent loop — is **not** settled by this plan and must not be settled
inside it. Every piece here is built as a stateless CLI verb over files plus a gate-check wiring. That
shape survives either answer: it runs from the engine today, and from a hook or a host-dispatched
session tomorrow. No piece in M15 adds engine orchestration surface.

---

## P1 — Spec first: what a check must produce, and what binding means

**Mandate.** Amend the testing/quality spec (`10`) and the gate spec sections that
`checks/*.gate.yaml` realise, to state: (a) a deterministic check returns a verdict **and** evidence
with provenance; (b) a test that passes while the behaviour it names is reverted does not satisfy the
verification duty; (c) the exemption mechanism — reason, owner, expiry, and staleness as a failure;
(d) the disclosure ledger as a first-class project artifact. Define `MutationEvidence` and
`EvidenceBundle` normatively (fields, provenance, immutability) so P2 implements written text rather
than inventing it. Add the `SPEC-QUESTIONS.md` entry recording the decisions above as binding. No code.

**Surface.** `specs/10-*.md`, the gate spec, `specs/22-build-plan-and-milestones.md` (M15 entry),
`process/SPEC-QUESTIONS.md`.

**Tests first.** Spec-only piece: the test is `pnpm run schema-drift` and the existing spec-reference
suites staying green, plus `test/output-contract-known-gaps.test.ts` updated to name the two new
artifact types as not-yet-implemented rather than unknown.

**Mutation evidence.** Remove the binding definition: P5's own tests lose their normative anchor and
the spec-reference assertions fail.

**Discloses.** Spec text alone changes no behaviour; P2–P5 carry it.

---

## P2 — `MutationEvidence` and `EvidenceBundle` as registered artifact types

**Mandate.** Add both as real artifact types: Zod schemas in `packages/schemas`, registry entries in
the `18` registry so they get reserved id prefixes and registry globs, emitted JSON Schema via
`pnpm emit-schemas`, and front-matter/provenance consistent with every other KB artifact.
`MutationEvidence` records: the story/piece id, the mutation kind (`revert-implementation` in v1), the
exact commit range or hunk set reverted, the named tests, which tests failed under mutation, the
restore verification, tool versions, and a timestamp. `EvidenceBundle` references a set of evidence
artifacts plus the gate they support. Both are append-only: a bundle is never edited, only superseded,
mirroring the deprecate-not-delete rule M14 already enforces on KB outputs.

**Surface.** `packages/schemas/src/artifacts/*`, the `18` registry table, `packages/schemas/json/*`
(regenerated, never hand-edited — see M15's own opening lesson), `packages/kb` writers.

**Tests first.** Schema round-trip; registry id allocation gives distinct ids under concurrency
(reuse the `session.test.ts` concurrent-allocation pattern); `assert-schema-drift.mjs` clean; a bundle
that edits an existing evidence record is refused; provenance required.

**Mutation evidence.** Drop the registry entry: id allocation fails and the output-contract test names
the type as unregistered. Make the bundle mutable: the immutability test fails.

**Discloses.** No gate reads these yet (P5, P8).

---

## P3 — The binding engine: revert-the-implementation mutation, in an isolated worktree

**Mandate.** New module producing, for a story: the implementation change set (the story's claim less
its declared test paths — the `10` §10.6 separation the claim machinery already encodes, and which
`resolveStepClaim` already computes) and its named tests. In a **scratch worktree** created through
the existing lane machinery (`packages/vcs`), revert exactly those implementation hunks, run exactly
those named tests through `scripts/run-tests.mjs`'s own environment contract, and require **at least
one named test to fail**. Restore, re-run, require all pass. Emit `MutationEvidence`. A test that
passes under mutation is reported as **non-binding**, named individually. Never mutates the user's
working tree; never leaves a worktree behind on any exit path (the lane-cleanup discipline M14 P35
already established). Honest about what it proves: binding to the change as a whole, not per-hunk.

**Surface.** `packages/cli/src/commands/loop/test/*` (where the real test runner lives),
`packages/vcs` lane creation/cleanup, `packages/engine/src/dispatch/outputs.ts` (`resolveStepClaim`
reuse — read, not modified), `scripts/run-tests.mjs` environment contract.

**Tests first.** A real fixture repo with: a genuinely binding test (fails on revert → reported
binding); a tautological test (`expect(true).toBe(true)` — passes on revert → reported non-binding by
name); a test asserting only on a constant; a story whose tests are unchanged by the revert because
the implementation is in a different package (correctly non-binding, not a crash); a failing restore
(reported as an engine failure, never as "binding"); SIGKILL mid-mutation leaves no worktree and no
half-reverted tree. Concurrency: two binding runs at once do not collide (the lane-isolation lesson
from M14's DECIDE write-back fix).

**Mutation evidence.** Invert the failure requirement (accept zero failures as binding): the
tautological-test case passes when it must fail. Skip the restore step: the restore-verification test
fails. Run against the working tree instead of a worktree: the no-side-effects test fails.

**Discloses.** v1 cannot distinguish "these tests bind weakly" from "these tests bind precisely" —
coarse reverts over-credit a suite where one strong test carries several weak ones. Per-test
attribution requires per-hunk mutation, deferred and named here. Tests that are legitimately
unmutatable are P6's problem, not silently tolerated here.

---

## P4 — `forge test binding` — the stateless verb

**Mandate.** Expose P3 as `forge test binding [--story <id>] [--json]`, matching the existing
`forge test run|coverage|flaky` family's exit-code and envelope conventions exactly, so a gate, a
hook, an agent, or a human invokes it identically. `--json` emits
`{v:1, ok, bound, nonBinding, exempt, evidenceId, tests:[...]}`. Non-zero exit when `nonBinding > 0`.
Refusals (no story, no tests, dirty tree) are typed errors with remedies, per the CLI's own USR-/RUN-
conventions, never a stack trace.

**Surface.** `packages/cli/src/bin.ts` dispatch, `packages/cli/src/commands/loop/test/*`,
`packages/core/src/errors/codes.ts` (`RUN-110`, `RUN-111`).

**Tests first.** Real subprocess tests in the `bin.test.ts` style: binding suite exits 0 with a v1
envelope; non-binding exits non-zero naming each test; `--json` stdout is exactly one line; a dirty
tree is refused before any git work; unknown story is a usage error (exit 2), not a crash.

**Mutation evidence.** Return exit 0 on `nonBinding > 0`: the gate-relevant test fails. Emit prose on
stdout under `--json`: the one-line-envelope test fails.

**Discloses.** Nothing consumes it yet (P5).

---

## P5 — `test:binding` becomes a deterministic check on `G-Verify`

**Mandate.** Add to `packages/templates/templates/checks/G-Verify.gate.yaml`:

```yaml
    - id: test:binding
      run: 'forge test binding --json'
      parser: forge-json
      failOn: 'nonBinding > 0'
```

placed after `test:run` (binding is meaningless if the suite does not pass) and before the coverage
checks (a bound suite at 70% is worth more than an unbound suite at 95% — the ordering states the
priority). Regenerate the shipped fixture project. `forge story verify` runs it on the same path.
This is the piece that makes the milestone real: from here, a story whose tests do not bind cannot
pass `G-Verify`.

**Surface.** `packages/templates/templates/checks/G-Verify.gate.yaml`,
`fixtures/greenfield-service/.forge/checks/*` (regenerated), `packages/cli/src/commands/story/*`.

**Tests first.** The gate-check suites that already exercise `G-Verify`'s real check list: a project
with a tautological test fails `G-Verify` at `test:binding` with the failing test named; the same
project with a real test passes; `failOn` parses; check ordering is asserted explicitly (binding after
`test:run`); an existing all-green project stays green (no false positives on the shipped fixture).

**Mutation evidence.** Move `test:binding` to `advisory`: the gate-fails test fails. Change `failOn`
to `nonBinding > 5`: the single-tautology test passes when it must fail.

**Discloses.** This will fail existing user projects that have non-binding tests — intentionally. The
upgrade path is P6's exemption mechanism plus a disclosed grace note in `forge upgrade` output.

---

## P6 — Exemptions: declared, reasoned, owned, expiring, and stale-fatal

**Mandate.** A test that genuinely cannot be mutation-bound (a pure type-level assertion, an
external-snapshot fixture, a timing or resource-exhaustion guard) declares an exemption carrying:
the test id, a reason in prose, an owner identifier, and an expiry (default cap mirroring M14's
90-day waiver rule, reusing that machinery rather than inventing a second one). Two rules make this
honest rather than an escape hatch: an exemption that matches **no** currently non-binding test fails
the check as **stale** — the exact discipline `test/brief-write-paths-in-claim.test.ts` already
applies to its own `EXEMPT` list — and an expired exemption fails the check. Exemptions are recorded
in the disclosure ledger (P10) automatically, so "we exempted it" is never invisible.

**Surface.** `packages/schemas` (exemption schema), the waiver machinery M14 P16 built,
`packages/cli/src/commands/loop/test/*`, `packages/core/src/errors/codes.ts` (`GATE-515`).

**Tests first.** A valid exemption suppresses exactly one non-binding test and no other; a stale
exemption fails naming itself; an expired one fails naming its expiry and owner; an exemption without
a reason is a schema error; an exemption is mirrored into the ledger; exemption of a *binding* test is
refused (you may not pre-emptively exempt something that works).

**Mutation evidence.** Drop the staleness rule: the stale-exemption test passes when it must fail.
Drop expiry enforcement: the expired test passes. Allow reason-less exemptions: the schema test fails.

**Discloses.** An owner can still exempt everything and re-issue on expiry. That is a social failure
mode, not a technical one, and it is visible in the ledger and in P11's metrics by construction.

---

## P7 — `EvidenceBundle` assembly per story

**Mandate.** On story completion, assemble and commit an `EvidenceBundle`: binding evidence, test
results, coverage delta, every `ReviewReport` verdict (M14 P14/P18 made verdicts binding — this
collects them), gate outcomes, exemptions in force, and real cost. Committed beside the story with
`Forge-Step`/`Forge-Run` trailers, in the same lane, under the story's own claim. This is Helix's
"committed checkpoints with supporting evidence instead of one huge diff", expressed in FORGE's
artifact vocabulary.

**Surface.** `packages/engine/src/dispatch/outputs.ts` (output contract), `packages/kb` writers,
`packages/templates/templates/workflows/implement-story.workflow.yaml` (`produces`).

**Tests first.** A completed story yields a bundle referencing every required evidence kind; a missing
kind is a typed failure naming which; the bundle lands on the lane and survives the merge; it is
inside the story's claim (so claim enforcement does not revert it — the failure mode M14's DECIDE
write-back fix existed to prevent); two concurrent stories get distinct bundle ids.

**Mutation evidence.** Write the bundle outside the claim: the claim-enforcement test reports it
reverted. Omit the review verdict: the required-kind test fails.

**Discloses.** Bundles grow the repository. Retention/pruning is not solved here; named for M16.

---

## P8 — A verdict without evidence is not a verdict

**Mandate.** `GateReport` (M14) and the gate loader gain a real integrity rule: a gate declaring
`evidence: - artifact: X` must resolve those references to committed artifacts at approval time. An
approval recorded against missing or superseded evidence is refused (`RUN-112`). `forge gate approve`
states which evidence it is approving against, so a human approves a claim with proof attached rather
than a name.

**Surface.** `packages/engine/src/gates/approve.ts`, gate loader/validator,
`packages/cli/src/commands/gate.ts`, `packages/core/src/errors/codes.ts` (`RUN-112`).

**Tests first.** Approval with complete evidence succeeds and records the evidence ids; approval with
a missing reference is refused with a remedy naming what is absent; approval against superseded
evidence is refused; `forge gate approve --json` carries the evidence ids; the existing M14
separation-of-duties and session-marker refusals still fire first (order asserted).

**Mutation evidence.** Skip the resolution check: the missing-evidence test passes. Resolve against
any artifact rather than the declared type: the wrong-type test passes.

**Discloses.** Advisory checks stay evidence-free by design; only deterministic checks and approvals
are bound.

---

## P9 — The bounded critic loop, shipped

**Mandate.** `implement-story` gains the build process's own loop: `review` → (findings) → `fix` →
`review`, bounded by a configured maximum (default 3, `execution.criticRounds`). On exhaustion the
step does **not** loop and does **not** silently pass: it writes the unresolved findings to the
disclosure ledger (P10) and reports a typed outcome (`RUN-113`) that the gate can read. Each round's
reviewer receives the findings and the fix, never the previous reviewer's reasoning, preserving the
fresh-context property that makes the build process's critic useful. Round count and outcome are
emitted as events for P11.

**Surface.** `packages/templates/templates/workflows/implement-story.workflow.yaml`,
`packages/engine/src/dispatch/steps.ts` (loop wiring — the only engine change in this milestone, and
it is a workflow-level loop, not new orchestration surface), `packages/schemas/src/config`
(`execution.criticRounds`), `packages/core/src/errors/codes.ts` (`RUN-113`).

**Tests first.** A finding fixed in round 1 ends the loop at 1; a finding surviving 3 rounds stops,
discloses, and reports `RUN-113` rather than passing; the round-2 reviewer prompt contains the
findings and the fix but not round 1's reasoning (assert on the real assembled prompt); rounds are
capped by config and the cap is honoured at 1 and at 3; every round emits an event; budget caps still
bound the loop (a loop cannot outspend `maxCostUsd`).

**Mutation evidence.** Remove the cap: the 3-round test loops. Pass silently on exhaustion: the
stop-and-disclose test fails. Leak prior reasoning into the round-2 prompt: the fresh-context
assertion fails.

**Discloses.** Three rounds is a default, not a finding about the right number; P11's metrics are what
will eventually justify or move it.

---

## P10 — The project disclosure ledger

**Mandate.** User projects get FORGE's own honesty discipline: a KB-located disclosure ledger where
every disclosed trade-off, known gap, exemption in force, and stopped-at-max-rounds finding is
recorded with provenance and an owner — the user-project analogue of `SPEC-QUESTIONS.md`. Written
through the existing KB writer (ids, provenance, append-only), readable via `forge kb`, and surfaced
by `forge doctor` as a count so it cannot rot unseen. A disclosure is never deleted, only resolved
with a reason.

**Surface.** `packages/kb` (new section), `packages/templates` (KB tree), `packages/cli/src/commands/kb.ts`,
`forge doctor` rule.

**Tests first.** An exemption (P6) appears automatically; a stopped critic loop (P9) appears
automatically; deletion is refused, resolution is recorded with reason and owner; `forge doctor`
reports the open count; entries carry real provenance; ids are distinct under concurrency.

**Mutation evidence.** Allow deletion: the append-only test fails. Drop the automatic write from P6:
the exemption-appears test fails.

**Discloses.** A ledger nobody reads is theatre; `doctor` surfacing is the minimum, and M17's
longitudinal check is what tests whether it is actually used.

---

## P11 — Measurement, from day one

**Mandate.** Emit, as real telemetry events with a stable shape: binding pass rate and non-binding
test count per story; critic rounds consumed and stop-and-disclose occurrences; gate failures before
first pass, per gate and check; exemptions opened/expired; real cost per delivered story; and — the
one that tests the Knowledge Body's central claim — KB reads preceding each decision artifact. These
are the numbers M17 will use to try to falsify FORGE's value claim, so they are specified before the
thing they measure improves.

**Surface.** `packages/telemetry/src/events.ts` (new payload kinds on existing event types where
possible, per M14 P44's own precedent of not inventing `EventType`s), the dispatch and gate paths that
already emit.

**Tests first.** Each metric is emitted exactly once per occurrence; a run with no stories emits none;
payload shape is pinned; events survive crash-resume (the existing durability contract); no metric
requires a network call.

**Mutation evidence.** Drop the KB-read metric: the central-claim test fails. Emit per-attempt instead
of per-occurrence: the exactly-once test fails.

**Discloses.** Emission only; projection is P12. Nothing here judges the numbers.

---

## P12 — `forge report` and a captured baseline

**Mandate.** `forge report [--since <when>] [--json]` projects P11's events into the milestone's
scorecard, and `forge report --baseline` writes a committed snapshot so "did M16 help?" is answerable
against a real prior number rather than memory. Pure projection over the event log; no new state.

**Surface.** `packages/cli/src/commands/report.ts` (new), `packages/telemetry/src/events.ts` readers,
`packages/cli/src/bin.ts`.

**Tests first.** Projection over a fixture event log yields exact numbers; `--json` is one line;
`--since` filters; an empty log reports zeroes rather than failing; a baseline snapshot round-trips
and is committed with trailers.

**Mutation evidence.** Compute the rate over attempts rather than stories: the exact-numbers test
fails. Silently drop unknown event kinds: the forward-compatibility test fails.

**Discloses.** A scorecard invites gaming; that is the point of M17 measuring on a project FORGE did
not build.

---

## P13 — Documentation: what evidence means and why a gate refused you

**Mandate.** `docs/method-guide.md` gains the evidence model (binding, bundles, exemptions,
disclosure); `docs/getting-started.md` gains a real, run-for-real walkthrough of a non-binding test
being caught and fixed; `CONTRIBUTING.md` points at the symmetry — this is the discipline that built
FORGE, now in the box. Every command shown is executed while writing, per this repo's existing
documentation rule.

**Surface.** `docs/method-guide.md`, `docs/getting-started.md`, `CONTRIBUTING.md`, `README.md`
(status line only).

**Tests first.** The docs-example suites that already assert shipped commands exist and parse; no
fabricated output.

**Mutation evidence.** N/A (documentation); the guard is the existing command-existence suite.

**Discloses.** None.

---

## P14 — Live run: a non-binding test is caught end to end on real Claude

**Mandate.** The milestone's exit proof, in the M13/M14 live-run tradition: a real `implement-story`
run at L1 on a throwaway project with a real adapter credential, where the implementer's first attempt
produces a test that does not bind. Required evidence: `G-Verify` fails at `test:binding` naming the
test; the critic loop runs and terminates within its cap; the fixed story passes with a committed
`EvidenceBundle`; `forge report` shows the round count and the binding recovery; the disclosure ledger
is consistent. Recorded in `GAUNTLET-LOG.md` and `SPEC-QUESTIONS.md` with real costs and every gap the
run discloses.

**Surface.** No source changes; a live run and its record.

**Tests first.** Pass criteria enumerated above, asserted against the real run's artifacts and event
log rather than narrated.

**Mutation evidence.** N/A (live run); the mutation is the deliberately non-binding test itself, which
is the whole point.

**Discloses.** Whatever the run finds. A live run that discloses nothing has not been looked at hard
enough.

---

## Exit tests

```
pnpm test
pnpm test -- --grep "M15"
forge test binding --json                    # in the shipped fixture project: bound, zero non-binding
FORGE_LIVE=1 pnpm test -- --grep "live"      # requires a real adapter credential; run by the project owner
```

## What this milestone deliberately does not do

- **No per-hunk or operator mutation.** v1 is coarse and says so (P3). Precision is M16's to earn.
- **No visual or behavioural parity oracle.** That needs a reference implementation and belongs to the
  workflows that have one (`refactor`, `migrate`, `adopt`) — M16.
- **No external validation.** Measuring FORGE on FORGE is still a closed loop; M17 owns breaking it.
- **No orchestration changes.** The one engine touch (P9) is a workflow loop, not new runtime surface.
- **No evidence retention/pruning policy.** Named in P7, deferred.
