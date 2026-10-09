# The FORGE method

This document explains _how FORGE thinks about building software_ — the stage/gate/workflow model,
the Knowledge Body, and the traceability contract — at a conceptual level, for someone using FORGE
to build a real project. For hands-on commands, see [`getting-started.md`](getting-started.md). For
the normative, implementation-level detail this guide summarizes, see `specs/01`, `specs/09` and
`specs/10`.

## The core idea

> **FORGE turns a software product idea into a system that a top-tier engineering organisation would
> recognise as properly built** — by running an explicit, opinionated, spec-driven software
> engineering process across a team of specialised AI agents, with a durable project knowledge body
> and machine-executable quality gates.

The bar for "done" is not "the code runs." It's that there is a written, versioned reason for every
significant technical decision; the system has a designed data model and a migration story; it
builds reproducibly from a clean checkout; it has a test pyramid the agents can execute and
interpret without a human; it deploys via a pipeline, not a laptop; it emits the observability an
agent needs to debug it; and every feature traces back to a capability in the PRD. See `specs/01`
§1.2.

Three things make this real rather than aspirational:

1. **A method** — the lifecycle, gates and decision frameworks described below, expressed as
   machine-executable workflows and artifact schemas, not just prose guidance.
2. **A runtime** — the `forge` CLI: a scheduler, run state, resumability, budgets and an audit
   trail.
3. **A memory** — the Knowledge Body: durable, structured, queryable project truth every agent reads
   before acting and writes back to after deciding.

## Scale-adaptive levels

A bug fix must not require a PRD. FORGE right-sizes itself with a level, chosen at intake
(auto-proposed from your idea text, human-confirmable) and stored in the Knowledge Body — it selects
which workflows, artifacts and gates apply for the rest of the project.

| Level  | Name       | Typical                                          | Gates                                                       |
| ------ | ---------- | ------------------------------------------------ | ----------------------------------------------------------- |
| **L0** | Patch      | Bug fix, copy change, dependency bump            | `G-Verify` only                                             |
| **L1** | Feature    | 1–3 stories inside an existing system            | `G-Design`(light), `G-Verify`, `G-Deliver`                  |
| **L2** | Capability | New subsystem/service in an existing product     | `G-Product`, `G-Design`, `G-Ready`, `G-Verify`, `G-Deliver` |
| **L3** | Product    | New product, greenfield                          | All gates                                                   |
| **L4** | Platform   | Multi-service/multi-team, migrations, compliance | All gates + `G-Integration`                                 |

(`specs/01` §1.9.)

## The ten-phase lifecycle

FORGE structures work as ten phases, each with an owner, entry conditions, defined outputs and (for
most) an exit gate that must pass before the next phase's work is trusted:

| #   | Phase                    | Key outputs                                               | Exit gate      |
| --- | ------------------------ | --------------------------------------------------------- | -------------- |
| P0  | Intake                   | Idea record, level selection, constraints                 | —              |
| P1  | Discovery                | Problem, users, competitive scan, success metrics, risks  | `G-Problem`    |
| P2  | Product Definition       | Vision, PRD, capabilities, NFRs, UX spec                  | `G-Product`    |
| P3  | Solution Shaping         | Architecture spec, ADRs, domain/data model, threat model  | `G-Design`     |
| P4  | Project Initialization   | Repo strategy, build system, scaffold, CI skeleton        | `G-Foundation` |
| P5  | Planning & Decomposition | Stage plan, epics, stories, test plan, run plan           | `G-Ready`      |
| P6  | Implementation           | Contracts frozen, tests, code, reviews, merges            | — (continuous) |
| P7  | Verification             | Test execution, coverage, NFR verification, traceability  | `G-Verify`     |
| P8  | Stabilization            | RCA records, fixes, regression tests, flake control       | `G-Stable`     |
| P9  | Delivery                 | Pipeline, environments, deploy, smoke, rollback rehearsal | `G-Deliver`    |
| P10 | Operate & Learn          | Observability, SLOs, retro, KB write-back                 | `G-Operate`    |

P6→P8 loop per stage; P9→P10 per stage; the whole P2→P10 loop repeats per stage (MVP → M2 → GA). A
project's level determines which of these phases actually run: L0 runs only implementation and
verification; L1 adds a light design pass and stabilization; L2 adds product/design deltas and
delivery; L3/L4 run the full lifecycle (`specs/10` §10.2).

Each phase maps to one or more **workflows** — `.forge/workflows/*.workflow.yaml` files that
describe a DAG of steps, each step a real agent session (or a deterministic command/gate check),
wired with expressions, fanout and gate placement. `intake`, `discover`, `define-product`,
`shape-solution`, `initialize-project`, `plan-stages`, `plan-stage`, `build-stage`,
`implement-story`, `quick-fix`, `verify-stage`, `debug`, `harden`, `refactor`, `deliver-stage`,
`operate`, `adopt`, `migrate`, `retro` and `replan` are the workflows FORGE ships out of the box
(`specs/10` §10.5) — `forge run <id> --dry-run` shows you the compiled step plan for any of them
without starting a real session (the ones that declare inputs, such as `build-stage` or `quick-fix`,
take `--stage`, `--story` or `--input name=value`; see the getting-started guide, section 5).

## Gates: how "done" is enforced, not just asserted

A **gate** is a machine-checkable go/no-go decision at a phase boundary. Every gate carries
deterministic checks (real commands with a real `failOn` expression — `forge spec validate --json`,
`forge kb lint --json`, and so on) and, optionally, advisory (LLM) checks that surface open
questions but never block on their own.

The rules that make this real rather than theatre (`specs/10` §10.3):

1. A gate with any failing deterministic check cannot be approved — only **waived**, and a waiver
   requires a reason, an owner and an expiry, and stays visible in every report until it's resolved.
2. Advisory checks never fail a gate; they create tracked open questions instead.
3. Gates are re-runnable and idempotent — `forge gate check <id>` re-evaluates without approving
   anything.
4. Every gate evaluation writes a `GateReport` artifact under `docs/forge/reports/gates/` with the
   exact check output — that report is the audit trail.
5. `G-Deliver` for a production environment is `alwaysHuman` by default; it can't be set otherwise
   without an explicit config flag and a typed acknowledgement.

FORGE has no deploy executor of its own: the real pipeline runs the dry run, the rollback rehearsal
and the deployment itself, then writes each as a record with
`forge deploy record <dry-run|rollback|deployment>` — a validating writer that refuses (writing
nothing) rather than commit a malformed one — and commits it.
`forge deploy --dry-run`/`--rollback-check` then read those records back for `G-Deliver`.

The ten gates FORGE ships (`fm-core`) are `G-Problem`, `G-Product`, `G-Design`, `G-Foundation`,
`G-Ready`, `G-Verify`, `G-Stable`, `G-Integration` (L4 only), `G-Deliver`, `G-Operate` — run
`forge gate list` in any initialized project to see them, and `specs/10` §10.3's own gate catalogue
for exactly what each one fails on.

## The spec graph and traceability

Every requirement in FORGE is a typed, id'd artifact — `Vision` → `Capability` → `Epic` → `Story` →
`Task`, plus cross-cutting `NFR`, `InterfaceContract` and `DataModel` types — living under
`docs/forge/specs/`. Parent/child edges are enforced: a `Story` with no parent `Epic`, or a
`Capability` no `Story` ever implements, is an **orphan**, and `forge spec orphans` finds it.
`forge spec validate` checks both document-level schema validity and graph-level integrity (required
edges present, no cycles); `forge spec trace <id>` walks the parents and children of one artifact;
`forge spec matrix` produces the full traceability matrix.

This is what makes "every feature traces back to a capability in the PRD" a checked fact instead of
a hope (`specs/09` §9.2, §9.4).

## The Knowledge Body

The Knowledge Body (`docs/forge/kb/`) is FORGE's durable project memory — product, architecture,
data, delivery, ops and domain knowledge, decisions (ADRs), and a glossary, plus validated diagrams
generated from structured artifacts where derivable. Every agent reads the relevant slice of it
before acting and writes back to it after deciding, so the same architectural question is never
asked twice across sessions. `forge kb list`/`show`/`search`/`lint`/`sync`/`graph`/`verify` are how
you inspect and maintain it directly; `forge kb lint` catches staleness and structural problems, and
`forge kb verify` re-runs any stored verification commands a KB entry claims are still true.

## Decision frameworks and ADRs

Where BMAD-style method frameworks leave engineering depth thin, FORGE ships eight first-class
decision frameworks — init, design, data, tech, test, debug, delivery, ops — each of which produces
a real Architecture Decision Record: alternatives considered, a scoring rubric, and why the losing
options lost. `forge adr new/list/show/supersede/accept/reject` manage the ADR lifecycle directly.

## Parallelism and lanes

Within a stage, independent stories run in parallel **lanes** — isolated git worktrees with explicit
file-ownership claims, scheduled as a DAG rather than a sequential human-driven queue. `forge lanes`
shows lane status for the active run; `forge merge --lane <id>` (or `--all`) merges a lane's
completed work back once its own checks pass.

## Cost, budgets and audit

Every agent session's token usage and (adapter-reported) cost is recorded to a per-run ledger.
`forge cost` reports total spend, broken down by run, agent and model, against your configured
budget; `forge audit` reports gate decisions, tool-ceiling escalations and policy violations across
the project's whole history. Budgets can abort a run rather than silently overspend.

## Evidence: how FORGE proves a story is actually done

A gate that only checks "does a test exist" can be satisfied by a test that asserts nothing real.
FORGE closes that gap with a chain of real, checked evidence, each link built to be honestly
incomplete about what the one before it couldn't guarantee:

- **Binding.** A test is **binding** when it genuinely fails if its own implementation is reverted —
  the behavioral-binding line (`F-TEST-7`/`F-TEST-8`/`F-TEST-5`) is no longer just a described
  convention, it's mechanically checked. `forge test binding --story <id>` reverts a story's
  implementation files (never its test files) inside an isolated scratch worktree, re-runs the named
  tests, and reports which ones kept passing anyway — those are non-binding, named individually,
  never silently dropped. `test:binding` is wired onto `G-Verify` as a real deterministic check, and
  `forge story verify` runs the identical check natively as part of its own `verify` phase. See
  [`getting-started.md`'s walkthrough](getting-started.md#8-catch-a-non-binding-test) for a real,
  run-for-real example of a non-binding test being caught and fixed.
- **Exemptions.** Some tests genuinely can't bind (a thin wrapper around a third-party API, say).
  `forge test exempt --reason <text> --owner <role> --expires <date>` declares one, for one named
  test, with a real reason, a real owner, and a real expiry — never a silent pass. A stale (expired,
  or naming a test that no longer exists) exemption fails the check it was meant to quiet, loudly.
- **EvidenceBundle.** `forge story evidence` assembles a story's own real evidence — binding
  results, coverage, review verdicts — into one committed artifact a gate can require. A gate's
  `evidence:` declaration doesn't just check the artifact exists: it must resolve to a real,
  committed, schema-valid, non-superseded artifact, or `forge gate approve`/`waive` refuses
  (`RUN-112`).
- **The bounded critic loop.** A `swarm-review` workflow step whose verdict comes back `blocked`
  doesn't fail immediately, and doesn't loop forever — it runs an automatic `review → fix → review`
  cycle, a real round cap (3 by default, `execution.criticRounds`), stopping and disclosing
  (`RUN-113`) rather than either extreme if the cap is reached without a clean verdict.
- **Disclosure.** `forge kb disclose`/`forge kb disclosures` is the project's own honesty ledger —
  real, authored trade-offs and known gaps, merged automatically with two kinds no one has to
  remember to record by hand: an in-force exemption, and a critic loop that hit its own round cap.
  `forge doctor` surfaces the open count.
- **Measurement.** `forge report [--since <when>] [--json]` projects all of the above into one real
  scorecard: binding pass rate per story, critic rounds consumed, gate failures before first pass,
  exemptions opened and expired, real cost per delivered story, and how often a decision artifact
  was preceded by a real Knowledge Body read. `forge report --baseline` captures a single, committed
  reference snapshot (with the real git commit it was taken at) so a later milestone can ask "did
  this actually help" against a real number instead of memory — the scorecard doesn't judge whether
  a number is good; that's deliberately left to whoever reads it.

## Parity: checking a refactor against a reference

Binding tells you a test genuinely exercises the code it claims to. It has nothing to say about
whether a `refactor` changed what that code actually _does_ — answering that needs something binding
alone can't supply: a reference to compare against. A **parity oracle** is a second, different kind
of evidence FORGE checks a story against, not a replacement for the binding chain above: a reviewed
declaration plus an immutable capture of a reference's own observed behaviour, compared against a
candidate with `forge parity capture`/`forge parity check`. A `refactor` always has a reference (the
code before the change); greenfield work does not, and keeps relying on binding alone.

A green `forge parity check` means exactly one thing: the **declared** surfaces matched a reviewed
reference on the **declared** cases, after the **declared** normalisation — never that "behaviour is
preserved" in any broader sense. Everything a declaration doesn't name is simply unobserved, and the
evidence says so plainly rather than implying a wider guarantee.

- **Authoring a declaration.** `.forge/parity/<name>.parity.yaml` names the reference
  (`reference.ref` — a full commit sha or a tag, resolved once; never a branch name or `HEAD`, since
  either can move out from under the comparison) and the surfaces to compare (`process`, `file`,
  `library`, `http`), each with one or more `cases`. It counts as reviewed only with a `review`
  block — `by`, `basis` (what the review actually rested on; a real project's own basis names the
  commits or diff a human actually read, not a one-line gesture at having looked) and `at` — plus an
  `expires` date a person has to renew by hand: either missing, or a lapsed `expires`, fails the
  check outright. `unobservable` lets a human excuse exactly one named surface, with its own reason,
  owner and expiry — it is an **owned exemption**: a person asserting "I cannot observe this," never
  the tool deciding so on its own, and it excuses one surface, never a whole declaration (a
  declaration whose every surface is excused compares nothing and is itself invalid). Normalisation
  rules (`strip-ansi`, `line-endings`, `sort-lines`, `replace`, and the rest) exist so a capture can
  tolerate noise that genuinely isn't a behaviour difference — a timestamp, a host path — but they
  are not risk-free: a rule written too broadly can hide real content, not just noise it was meant
  to tidy away. A normalisation rule is something a reviewer has to read and judge, the same as the
  surfaces and cases themselves, never a safe default to wave through.
- **The vet's closed lists.** A surface's `run`, and a declaration's `setup` (used only when
  capturing the reference), are vetted exactly as a stored test command is: one plain invocation,
  `network: none` with no relaxation a declaration can grant, and a closed set of refusals — a
  network program or URL (`curl`, `wget`, `ssh`), a package manager's install verb, a program that
  runs another program for you (`env`, `xargs`, `npx`, …), one that mutates files or the environment
  (`rm`, `mv`, `chmod`, …), a git subcommand that isn't read-only, and a path naming a secret file
  or `.forge/state`. That refuses a bare `cargo build` or `pip install` outright; a reviewed
  **wrapper script** — a checked-in shell script the vet itself can't see past — is the way around
  that, never a relaxation of the vet itself. That distinction matters more than the mechanics:
  these lists are a filter on what the **declaration** may literally say, never a sandbox on what a
  named script then actually _does_ once it runs — a program the lists don't recognise is
  unrecognised, not thereby safe, and review of the declaration, not the vet, is what has to cover
  that.
- **Capture, then check.** `forge parity capture [--name <name>]` is the one human act that writes
  the oracle: it observes the declared reference, at its declared ref, in a scratch worktree, and
  writes a content-addressed capture under `.forge/parity/captures/`. No workflow runs it, and it
  refuses outright under any FORGE session marker at all, so a refactor can never mint its own
  oracle. `forge parity check [--name <name>] [--trusted <ref>] [--story <id>] [--no-record]` then
  observes the candidate _in place_ and compares it against the capture a matching declaration
  selects, writing one `ParityEvidence` record per invocation unless given `--no-record`.
- **Why `refactor` is strict now.** M16 gives `refactor` a fail-fast `preflight-parity` step before
  any agent session even starts, and a second, `verify-parity`, once the refactor lands: a project
  with no parity declaration that compares at least one real, non-exempt surface cannot pass
  `refactor` at all. That is a deliberate behaviour change, not an incidental detail — before M16 a
  `refactor` workflow was no stricter than any other; a `refactor` with nothing declared to compare
  now refuses before spending a session's budget, rather than completing having checked nothing.
- **The trust anchor, and its real boundary.** `forge parity check --trusted <ref>` compares
  everything under `.forge/parity/` against the tree at `<ref>` by reading git objects directly —
  never `git status` or `git diff`, both of which an agent with a shell can blind. `G-Parity`'s own
  check always passes `--trusted refs/heads/main`, so inside a run the anchor is trunk. This is the
  real boundary: **a rewritten oracle is detected, not prevented, and a reviewed change has to reach
  trunk before a `forge refactor` run can rely on it.** That trunk is itself a hardcoded literal —
  FORGE's engine always treats `main` as trunk, never a value read from project configuration — so a
  project whose own default branch is genuinely named anything else cannot pass a real `refactor`'s
  `G-Parity` gate at all, for a reason that has nothing to do with parity itself, until either its
  branch is renamed to match or FORGE itself grows configuration for this. The declaration is not
  unwritable by an agent: `.forge/**` sits in the engine's never-writable floor, but that floor is
  enforced only after the fact, when the adapter reports changed files — a session that commits its
  own work bypasses it entirely. So the anchor, not the floor, is what actually protects the oracle,
  and it protects it by failing the run that sees the rewrite, never by stopping the rewrite from
  happening or landing.
- **Per-hunk results: what they do and don't tell you.**
  `forge test binding --story <id> --hunks --base <ref> [--max-hunks <n>]` is the finer-grained
  sibling of the ordinary behavioural binding described above: instead of reverting a story's whole
  implementation change at once, it reverts one _hunk_ of text change at a time and asks whether a
  baseline-passing test now fails. It is opt-in, bounded (N hunks cost N+3 test runs) and strictly
  report-only — a hunk's own verdict never changes the command's exit code. A project that wants to
  gate on it writes its own check over the `--json` envelope's `uncoveredHunks` field, and takes on
  three real costs by doing so: a comment-only or purely cosmetic hunk still reads `uncovered`,
  there is no hunk exemption, and attribution is bounded by the story's own declared tests — a hunk
  covered only by a different story's test still reads `uncovered`. None of that makes hunk coverage
  unreliable; it means an `uncovered` hunk is a prompt to go look, never, on its own, proof that a
  test is missing.

See [`getting-started.md`'s walkthrough](getting-started.md) for a real, run-for-real example of all
of the above on a tiny, shipped fixture — a declaration, a capture, a passing and a refused check,
and the hunk and prune commands.

## Where the method stops and customization begins

FORGE draws a hard line: **the user owns flavour, FORGE owns rigour.** Flavour is who the agents
are, how they speak, what they know, what tools they can reach, which stack conventions they follow,
how much ceremony a project gets — all of that is customisable. Rigour is traceability, gate
determinism, separation of duties, file-ownership safety, and the requirement that decisions are
recorded — that's fixed, or requires an explicit, recorded, expiring waiver. See
[`authoring-guide.md`](authoring-guide.md) for how to actually change the flavour column.
