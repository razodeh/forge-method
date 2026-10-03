# PLAN-M16 — Parity oracles where a reference exists

**Status: plan. Nothing here is built.** Post-v1.0; M15 is feature-complete (P1–P14, `GAUNTLET-LOG.md`
`## M15 P14`). The `specs/22` M16 entry is amended by P1 (spec first), so no P0 piece exists — and P1
also corrects that entry's premise, which has no referent (see "Why this milestone exists"). Pieces
take the next free `SPEC-QUESTIONS.md` number at commit time (`Q294` as this plan is written); the log
entry is `## M16 P<n>` in `process/GAUNTLET-LOG.md`. M15 pieces are cited as `M15 P<n>`.

**Line references are deliberately omitted.** Every `Surface` below names real files and real symbols,
verified to exist while writing this plan; none carries a `:line` citation, because the plan was
written without a file-by-file line audit, and where a piece touches an internal helper the plan
describes its behaviour rather than naming it. A line-reference pass over each piece is part of that
piece's own BUILD step, not a claim this plan already makes. Disclosed here rather than faked.

## Why this milestone exists

M15 built the oracle that needs no reference: a test that does not fail when the behaviour it claims
to test is reverted is not a test. It also named, on purpose, what it did not build — and three of
those are this milestone: the oracle for the workflows that *do* have a reference, per-hunk precision
for the binding evidence, and the retention policy M15 P7 deferred.

When a reference exists the question changes. A refactor is, by definition, a change that preserves
behaviour. "The tests still pass" says only that the tests tolerate the change — and a suite that
cannot tell old behaviour from new is exactly what M15's binding evidence exists to expose, which makes
it a poor thing to lean on for the one workflow whose whole contract is "nothing observable changed".
The strong oracle is the reference itself: drive the old system and the new through the same inputs and
compare what an outside observer can see. That is the differential oracle (`13`, oracle 5) and the
reference-implementation oracle (`13`, oracle 6); `17` rule 3 already names the differential oracle for
brownfield work. Nothing implements either. Shopify's Helix (reviewed in PLAN-M15) demonstrates this
shape at production scale — checkpoints that cannot ship until behaviour-equivalence holds against a
reference implementation. PLAN-M15 set that oracle aside because greenfield work has no reference; this
milestone builds it for the work that does.

**The `specs/22` entry's premise has no referent.** It says the parity check is "wired into the gates
those three workflows reach". They reach none. `refactor` is `state-invariants` → `refactor-code` →
`verify-invariants` (a plain `forge test run --json` command step) → `commit`. `migrate` ends in the same
command step, and its `migrate-data` step runs a command, `forge migrate run`, that is not wired yet
(`test/command-steps.test.ts` pins it as a known gap, `Q213`/`Q202`). `adopt` is an inventory command and
two agent steps; its one gate, `G-Adopt` (`17`), is evaluated in-process by a pure function and has no
gate file at all. None of the three contains a `kind: gate` step. A check cannot be wired into a gate
that is not there, so M16 **creates** the attachment — and its first piece corrects the spec rather than
building on a sentence nobody checked against the code. It is the same class of finding as the one
PLAN-M15 opens with: do not build on a claim that was never run.

**M15's binding engine has gaps that per-hunk work multiplies.** Reading the shipped engine for this
plan found five that M15's log does not weigh against a per-hunk design. (1) PLAN-M15 P3's "revert
exactly those hunks" shipped as a whole-*file* revert (`git checkout <base> -- <path>`, or removal when
the file is new). (2) The base is hard-coded to `HEAD~1`. (3) There are exactly three runs — baseline,
revert, restore — with no retry, so one flaky baseline run decides a verdict. (4) No run has a timeout:
a hung test hangs the verb. (5) The two runners disagree about a file that fails to load — vitest's
synthetic load-failure outcome is credited to every baseline test in that file, while pytest 8.4.2's
collection `ImportError` surfaces as an `<error>` with an empty classname and is credited to none — so
a revert that merely breaks an import reads as "bound" under one runner and "non-binding" under the
other. One extra mutant tolerates all five as edge cases; N+3 runs do not. P10 fixes the two per-hunk
work depends on (failure kinds, timeouts) and every other gap is disclosed, not hidden.

Finally, this milestone keeps the promise M15 made about measurement: parity and hunk results emit the
same `CheckRun` telemetry M15 started, so M17 has a before-picture for the parity oracle too.

## Decisions this plan commits to

These are proposed for owner sign-off and become a binding `SPEC-QUESTIONS.md` entry at P1 commit time.

1. **M16 creates the attachment; it does not find one.** A new **workflow-scoped gate**, `G-Parity`
   (precedent: `G-Adopt`, a gate that is not one of the ten lifecycle gates), is reached through
   explicit `kind: gate` steps. It carries one deterministic check, `behavior:parity`
   (`run: 'forge parity check --json'`, `parser: forge-json`, `failOn: 'failing > 0'`). It omits `phase`
   because it belongs to no lifecycle phase (the loader accepts and drops `phase` today; P9 pins that
   nothing enumerating gates ever evaluates a phase-less one outside a workflow step). *Rejected:*
   attaching the check to `G-Verify` (couples `refactor` to a project-wide gate and forces a parity
   declaration on every `implement-story`), a vacuous pass when no reference exists (violates `10`
   §10.3's own "nothing found must not pass" and the spec's own "greenfield must not claim parity"), and
   engine conditionals or an `appliesTo.workflows` field (new orchestration surface, which M15's
   neutral-prerequisite note rules out).
2. **`refactor` becomes strict, with a fail-fast preflight.** A refactor with no valid parity
   declaration is refused, and a declaration must compare at least one surface: `unobservable` entries
   exempt individual surfaces (owned and expiring), never a whole declaration. The first step is a gate
   step that evaluates `G-Parity` on the unmodified tree, so a missing declaration, an expired review or
   an unstable reference fails before an agent spends a token. `verify-parity` sits between
   `verify-invariants` and `commit`. Whether one gate id may be referenced by two steps of one workflow
   is **unverified**; P9 settles it with a real run, and the fallback is the same check as an entry
   preflight inside `forge refactor`.
3. **`migrate` is wired but partly unreachable, and says so.** A `verify-parity` gate step follows
   `verify-migration`. A real `migrate` run does not reach it until `forge migrate run` is wired, which
   is pre-existing (`Q213`/`Q202`) and which M16 does not close. The step is proven structurally (it
   parses, names a known gate, is ordered after `verify-migration`), not end to end.
4. **`adopt` gets documentation only.** The system as found is a valid reference: `G-Adopt`'s `BASELINE`
   tag is a legitimate `reference.ref`. No adopt gate wiring is built — `G-Adopt` has no gate file and
   its evaluation is in-process.
5. **A parity oracle is a reviewed declaration plus an immutable capture, never a recorded snapshot.**
   `13` bans "snapshot tests created by recording current behaviour without human or spec review". A
   declaration (`.forge/parity/<name>.parity.yaml`) is human-authored and committed, with a required
   `review {by, basis, at}` and a required `expires`. Agents cannot write `.forge/parity/**` (it sits
   inside the never-writable set `.forge/**`; a test pins it), so the party under test cannot author its
   own oracle. The capture is content-addressed and immutable at
   `docs/forge/reports/parity/captures/<sha256>.json`, also agent-unwritable (it lies under the reports
   root).
6. **Applicability and expiry are explicit, and absence fails.** An expired declaration, a missing
   capture, a capture whose declaration digest no longer matches, two differing captures
   (`ambiguous`), a candidate that disagrees with itself (`unstable`), no declarations at all, or a
   declaration that compares nothing (every surface exempt) each report a failing count and a `reason`
   — never a pass on nothing compared (`10` §10.3). A surface that genuinely cannot be observed is
   declared `unobservable` by a human, with a reason, an owner and an expiry, exactly as M15 P6's
   exemptions are, and an expired entry fails.
7. **Observe the reference in a scratch worktree at the declared ref; observe the candidate in place.**
   The reference worktree comes from the existing lane machinery and is always removed. The candidate is
   observed at the tree the gate evaluates, with `headSha`, a `dirty` flag and a working-tree-delta digest
   recorded, and the tree is verified unchanged by the observation (`unclean` otherwise). Cases have no
   placeholders: inputs are overlaid files, arguments are literal words, outputs are declared relative
   paths cleaned before and after, probe scripts and fixtures live under `.forge/parity/` and are
   overlaid into whichever tree is observed so the same reviewed bytes run against both sides.
8. **Comparison is hardened against weakening the oracle.** The capture is bound to its declaration by a
   digest that excludes `review`, `expires` and `unobservable` (renewing a review must not invalidate a
   capture; changing what is observed or how must). A stability probe at capture refuses a reference that
   disagrees with itself. A normalisation rule that erases the whole observation is refused. Equality is
   decided on the full normalised content, never on a truncated display. Secret-bearing and lossy-UTF-8
   observations are refused at capture. The environment is pinned (`TZ=UTC`, `LC_ALL=C.UTF-8`,
   `LANG=C.UTF-8`). A capture is selected by `(name, declaration digest, reference sha, platform)`; zero
   is `missing`, two or more differing is `ambiguous`; platform is in the key so a capture from another
   platform is never silently compared.
9. **Four surfaces, one honest boundary.** `process` (stdout, stderr, exit code), `file` (declared
   outputs), `library` (a reviewed probe script that calls the library and prints one JSON object — a
   process surface whose probe bytes are digested) and `http` (P8: an in-process client against a
   loopback server the harness starts, explicit opt-in, port verified free before start). A green
   parity check says "the declared surfaces matched", never "behaviour is preserved".
10. **Evidence is an artifact, in two parts.** `ParityEvidence` is a new registered `.md` type
    (`PAR`, `reports/parity/{id}-{slug}.md`, no `parent`, optional `story`). `EvidenceBundle` gains an
    additive optional `parityEvidence` id list. Records that use a field M16 introduces carry
    `schemaVersion: 2`, with `1→2` migrations for `MutationEvidence` and `EvidenceBundle` (identity
    `up`, field-stripping `down`, golden tests) per `18` §18.9. **This is the plan's most
    owner-redirectable scope call:** the bundle field and the two migrations can be dropped, leaving
    `ParityEvidence` standalone, without breaking any other piece.
11. **Per-hunk mutation is opt-in, report-only, single-story, explicit-base.**
    `forge test binding --story <id> --hunks --base <ref>`. Verdicts per hunk:
    `killed | uncovered | invalid | timeout | skipped`, with `killedBy`. Above `maxHunks` (about 24) it
    degrades hunk → file → change and says so (`granularity`) — it is never sampled. The `--json`
    envelope is additive only: for the same range, every M15 field stays byte-identical to M15's. M16 ships **no**
    default hunk threshold; P13 proves a project-authored check on `uncoveredHunks` works through the
    real gate evaluator.
12. **The engine gaps per-hunk depends on are fixed; the rest are disclosed.** P10 classifies each
    failing outcome (`assertion | load | timeout | crash`), adds per-run timeouts and removes the
    vitest/pytest asymmetry. Any shipped change-level verdict P10 changes is disclosed as a change.
    Retry/flake policy, the `HEAD~1` landing range and operator mutation stay out of scope.
13. **Evidence retention is a verb, dry-run by default, with tombstones.**
    `forge evidence prune [--apply] [--keep <n>]` (`n` ≥ 1, default 5 per type and subject — precedent:
    `03` §3.4's "retaining the last 5" backups). The highest id of a type is never pruned, referenced
    ids are protected, and a pruned record leaves a per-id tombstone so a reference resolves to "pruned",
    not "dangling". `18` §18.8's "deleted artifacts are retained" is scoped in P1 to say what it means
    for retention-managed evidence. Capture files are never pruned by this verb (they are the oracle's
    baseline, not its evidence).
14. **Every new capability is a stateless `forge <noun> <verb> --json` command, and every M16 test
    names `specs/22 M16 P<n>`.** The first keeps the milestone neutral on the open orchestration
    question exactly as M15 was; the second makes `-t "M16"` select exactly this milestone's tests.
15. **No new dependencies, and no new step kinds.** Observation reuses the confined-command runner, the
    lane worktrees, the atomic append-only writer and the id allocator that already exist.

**Error codes.** Current highest: `RUN-116`, `GATE-516`, `CFG-509`, `KB-031`, `VCS-010`, `USR-004`
(verified in `packages/core/src/errors/codes.ts`). Expected assignments, fixed per piece at commit
time and never reused if abandoned: `RUN-117` onward (about five to seven: capture refusals, an
observation that cannot complete, an ambiguous or missing capture, hunk-mode refusals, prune refusals),
`GATE-517` (a `G-Parity` evaluation refusal), `CFG-510` (an invalid parity declaration) and `USR-005`
(hunk-flag misuse). Every new code needs its `packages/core/test/errors.test.ts` entries (the
imperative-verb remedy whitelist and `SAMPLE_DETAILS`) in the same commit.

## Left to a piece's own BUILD (each named with its owner)

Not settled by this plan, and said so rather than papered over:

- The exact library-probe JSON shape and the HTTP surface's start/readiness/kill helper placement
  (P1 text, P3/P8 build).
- Capture-selection details beyond decision 8, and what "platform" contains (P1/P2).
- `G-Parity`'s approval, evidence and `onReject` blocks — `runGateStep` ignores `evidence:` and
  `approval:` inside a workflow today (`Q287`), so the block follows `G-Verify`'s shape only where a
  human `forge gate approve` path reads it (P9).
- Whether one gate id can be referenced by two steps of one workflow (P9, decision 2).
- How a project with genuinely nothing observable proceeds. The plan refuses it rather than passing it
  vacuously; the human's recourse would be the existing gate-waiver path, and whether `runGateStep`
  honours a waiver inside a workflow step is a P9 research item. If it does not, the limitation is
  disclosed (P9).
- Whether the 1→2 migrations may honestly declare `reversible: true` when `down` discards fields (P5).
- Which stores hold evidence ids, for prune protection — event log, gate approvals and waivers,
  bundles, stories — each enumerated and tested (P14).
- Whether the id allocator must read tombstones, decided under an invariant test "no id is ever
  allocated twice across any prune sequence" (P14).
- The telemetry payload-versioning rule for an additive `CheckRun` payload (P1 text, P15).
- How `{slug}` resolves in the `ParityEvidence` path template (P5).
- The hunk-id format. P1's text fixes only the requirements — stable for one base/head pair, distinct for
  textually identical hunks in one file — and P11 fixes the format.
- Whether P10's change-level file-load policy (credited at change level, `invalid` for a text hunk)
  survives a real run under both runners. P1 states it; P10 confirms it, or amends the sentence in its
  own commit.
- The per-run timeout's default and its override flag (P10), and `--max-hunks`'s default (P12).

## Prerequisite this plan is deliberately neutral about

Unchanged from PLAN-M15: whether FORGE keeps its own orchestration runtime or becomes a method that
rides a host platform's agent loop is **not** settled here. Every piece is a stateless CLI verb over
files plus a gate-check wiring, which survives either answer. M16 adds no step kind, no conditional and
no scheduler behaviour; P9's workflow edits are three more `kind: gate` steps, the construct the engine
already runs.

---

## P1 — Spec first: what a parity oracle is, and what this milestone's premise actually was

**Mandate.** Correct the `specs/22` M16 entry: no existing gate is reachable by `refactor`, `migrate` or
`adopt`; M16 creates `G-Parity`; its exit-test lines become the real runner's form (`pnpm test --
--grep` is not how `scripts/run-tests.mjs` takes a filter). Amend `10` §10.3 for **workflow-scoped
gates** (a gate with no lifecycle phase, reached only from a workflow step) and restate its "nothing
found must not pass" rule for a reference oracle. Amend `13` so oracles 5 and 6 have a normative parity
definition: the reviewed declaration (what satisfies "human or spec review"), capture provenance and
immutability, the stability requirement, the normalisation rules, the verdict set
(`match | mismatch | missing | ambiguous | unstable | expired | invalid | unclean | error`, plus the
exempt count) and the library probe protocol. Amend `17` rule 3 and `G-Adopt` for the documentation-only
`adopt` reference. Amend `18`: register `ParityEvidence` (§18.7's checklist: registry entry, JSON
Schema, template, graph edges, migration note), the additive `parityEvidence` bundle field, `schemaVersion`
2 for hunk-level `MutationEvidence`, and the retention policy — including scoping §18.8's "never
reused / files retained" to retention-managed evidence. Amend `03` §3.2.5: `forge parity
capture|check`, `forge evidence prune`, and `forge test binding --hunks --base` (and record that its
`forge test <sub>` row already omits `binding` and `exempt`, a gap that predates M16). Define the
hunk shape: the requirements on a hunk id (stable for one base/head pair, distinct for textually
identical hunks in one file), the five verdicts, `granularity` degradation and report-only
semantics. Record all of it as binding in a `SPEC-QUESTIONS.md` entry. No code.

**Surface.** `specs/03-cli-and-installer.md`, `specs/10-workflow-engine-and-lifecycle.md`,
`specs/13-frameworks-testing-and-debugging.md`, `specs/17-brownfield-ingestion.md`,
`specs/18-persistence-config-and-schemas.md`, `specs/22-build-plan-and-milestones.md` (M16 entry),
`process/SPEC-QUESTIONS.md`, `test/spec-cli-examples.test.ts`, `test/output-contract-known-gaps.test.ts`.

**Tests first.** Spec-only piece: `pnpm run schema-drift` and the existing spec-reference suites stay
green; `test/spec-cli-examples.test.ts` gains pinned sentences (the premise correction, the declaration
requirements, the verdict set, the retention rule) so a later edit that drops them fails;
`test/output-contract-known-gaps.test.ts` is updated to name `ParityEvidence` and the hunk-level
`MutationEvidence` shape as not-yet-implemented rather than unknown.

**Mutation evidence.** Delete the premise correction or the declaration's `review` requirement from the
spec: the pinned-sentence assertion fails. Remove the `ParityEvidence` line from the known-gaps list:
that suite fails.

**Discloses.** Spec text alone changes no behaviour; P2–P15 carry it. The spec's exit-test shorthand
was stale before this milestone and is corrected here, not worked around.

---

## P2 — The declaration, the capture, and their digests (pure formats and loader)

**Mandate.** A pure module defining the parity **declaration** and the **capture** and everything that
can be computed without running anything. The declaration is strict (a Zod schema with a loader
mirroring `parseGateDocument`: unknown keys are errors with a "did you mean"): `name`
(`^[a-z0-9][a-z0-9-]*$`, equal to the file stem), `reference {ref}`, required `review {by, basis, at}`,
required `expires`, `surfaces` (each `process | file | library | http` with a vetted `run` and optional
`prepare`, literal arguments, overlaid `inputs`, declared `outputs`, `normalize` rules, per-case
`timeoutMs` and output cap, `stability {runs}`) and `unobservable` (surface, reason, owner, expiry). A
`run` that the existing command vetting refuses is a load error, so a declaration that can never run
fails at load, not at 2 a.m. The **digest** is a sha256 over a canonical serialisation of everything
that determines what is observed and how — the surfaces, the overlaid files' content hashes, the probe
bytes — and excludes `review`, `expires` and `unobservable`. The **capture** schema holds the observed
normalised content, no wall-clock time and no host path (so identical content is the identical file),
the platform, and the declaration digest. Content-addressed filename, selection by `(name, digest,
reference sha, platform)` with `missing` and `ambiguous` outcomes, and expiry evaluation against an
injected clock.

**Surface.** A new `packages/cli/src/commands/parity/` directory (the pure modules, placed beside the
verbs as M15's binding engine sits beside its verb under `packages/cli/src/commands/loop/test/`;
BUILD may move it into `packages/engine` if the package-boundary rule requires),
`@forge/engine/dispatch`'s existing command vetting, `@forge/core`'s `Clock`.

**Tests first.** Strict loader: unknown key refused with a suggestion; missing `review` or `expires`
refused; a `name` that is not the file stem refused; an unvettable `run` refused. Digest: key
reordering does not change it; changing `review.by`, `expires` or an `unobservable` entry does not;
changing any surface field, normalisation rule, overlaid file byte or probe byte does (a table over
every field). Capture: schema round-trip; the filename is the sha256 of the canonical bytes; a scan
proves no timestamp and no absolute project path appears in any capture. Selection: none → `missing`;
one → selected; two byte-identical → one; two differing → `ambiguous`; a capture from another platform
→ `missing`. Expiry: the injected-clock boundary day pinned.

**Mutation evidence.** Make the digest include `review`: the renew-without-invalidating test fails.
Drop `platform` from the key: the cross-platform test fails. Drop the vetting call from the loader: the
unrunnable-declaration test fails.

**Discloses.** No behaviour yet; nothing reads these.

---

## P3 — The observation engine: process, file and library-probe surfaces

**Mandate.** Given a declaration and a working tree, produce raw observations. A case runs its vetted
command through the confined-command runner (scrubbed environment, closed stdin, detached process
group killed on timeout, output cap) with the pinned `TZ`/`LC_ALL`/`LANG`, after overlaying its
`inputs` and cleaning its declared `outputs`, and reads back stdout, stderr, the exit code and the
declared output files — afterwards cleaning them again. A case that times out or breaches its cap is a
typed failure, never a truncated observation. The **library** surface is a process surface whose
command is a reviewed probe under `.forge/parity/probes/` that prints one JSON object (`{ok:true,value}`
or `{ok:false,error:{name,message}}`); its bytes are in the declaration digest, and it is overlaid into
whichever tree is observed. The reference tree is a scratch lane worktree at the declared ref, removed
in a `finally` on every exit path. The candidate tree is observed in place, with a working-tree-delta
digest taken before and after (tracked diff, plus untracked paths and content hashes, excluding the
harness's own report directory); any difference is `unclean`. Observations containing a secret
(the existing `SECRET_PATTERNS` set) or a lossy UTF-8 decode are refused here, before anything is
stored.

**Surface.** `packages/cli/src/commands/parity/*`, `@forge/engine/dispatch` (`runConfinedCommand`, the
limits, `vetConfiguredCommand`), `packages/vcs` (`createLaneWorktree`, `removeLaneWorktree`),
`packages/cli/src/commands/loop/test/system-temp.ts` (`createSystemTempPath` — R10).

**Tests first.** Real subprocess fixtures, not mocks: a program's stdout, stderr, exit code and a
declared output file are observed exactly; a stale output file from a previous run cannot leak into
the observation; inputs are written before and removed after; a case reading a secret from its
parent environment sees nothing; the pinned locale and timezone are observable; a case exceeding
`timeoutMs` fails typed and leaves no process behind; an output over the cap fails and is never
truncated; an unvettable command is refused before spawn; the scratch worktree is removed after a
throwing case and after SIGKILL mid-capture (the M15 `binding-sigkill` pattern); a case that writes
outside its declared outputs is `unclean`; a secret-bearing stdout and a lossy-UTF-8 stdout are
refused; a probe's byte change moves the declaration digest.

**Mutation evidence.** Skip output cleaning: the stale-leak test fails. Drop the cap check: the cap
test fails. Observe the candidate in a copy instead of in place: the in-place-delta test fails. Skip
the post-observation tree comparison: the `unclean` test fails.

**Discloses.** The reference worktree uses the **currently installed** dependencies, not the
reference's lockfile, so a refactor that changes dependencies is observed against the new ones on both
sides. "Network: none" is the existing vet policy (a refusal by program and host name), not an OS
sandbox. Only declared surfaces are observed; everything else is unobserved and the evidence says so.

---

## P4 — Normalise, compare, and the stability probe

**Mandate.** The comparison engine. Normalisation is declarative and bounded — no code from the
declaration runs: `strip-ansi`, `line-endings`, `trim-trailing-whitespace`, `sort-lines`,
`json-canonical` (parse, sort keys, re-serialise; a non-JSON observation is an error, not a pass),
`ignore-json-pointers`, and `replace` (a regex source with a literal replacement, scoped to a stream or
an output file; linted at load for catastrophic-backtracking shapes, with the outer check timeout as
the backstop). A rule that erases a non-empty observation entirely is refused. Equality is decided on
the full normalised content; a mismatch report shows the first differing line with context under a
byte cap, labelled as display only. The **stability probe**: at capture each case runs `stability.runs`
times (default 3, bounded) against the reference and all runs must be equal after normalisation, else
the case is `unstable` and capture refuses; at check the candidate's own repeated runs must agree, else
`unstable`. Every non-`match` verdict counts as failing; an exempt `unobservable` entry counts in its own
bucket; a check whose compared count is zero fails as `nothing-compared`.

**Surface.** `packages/cli/src/commands/parity/*`.

**Tests first.** A table over every normalisation rule with before/after pairs; a rule that empties an
observation refused; a pathological regex refused at load; two observations equal on their first
display-cap bytes and different after it are `mismatch` (the equality-on-display bug a critic would
find); a reference that flips between runs is `unstable` at capture; a candidate that flips is
`unstable` at check; every verdict kind reaches the failing count; all-exempt is `nothing-compared`.

**Mutation evidence.** Compare only the display excerpt: the late-difference test fails. Accept an
`unstable` run as a match: the stability tests fail. Skip the erase-everything guard: that test fails.

**Discloses.** Normalisation can hide a real difference if a declaration over-normalises; that is why the
rules live in the digest-bound, human-reviewed declaration and why a rule may never erase everything.
Regex linting is conservative, not a proof of linear time.

---

## P5 — `ParityEvidence` as a registered artifact type, and the additive bundle field

**Mandate.** Register `ParityEvidence` exactly as M15 P2 registered its two types: a Zod schema in
`packages/schemas`, a registry entry (`PAR`, `reports/parity/{id}-{slug}.md`, no `parent`, optional
`story`), emitted JSON Schema through `pnpm emit-schemas`, a template, graph edges, the `fm-core`
module list and the repo-wide count re-checks a new registered type forces. The record holds the
declaration name and digest, the reference ref, sha and platform, the candidate's `headSha`, `dirty`
and delta digest, the selected capture's digest, the overall verdict, a per-surface and per-case result
table of verdicts and content hashes (never the observed content), and tool versions. Append-only: a
record is never edited, and the writer refuses an overwrite. `EvidenceBundle` gains an optional
`parityEvidence` id list. Records that use a new field carry `schemaVersion: 2`; the first two
migrations (`MutationEvidence` and `EvidenceBundle`, `1→2`, identity `up`, field-stripping `down`) land
here with golden-file tests.

**Surface.** `packages/schemas/src/artifacts/{parity-evidence,evidence-bundle,mutation-evidence,index}.ts`,
`packages/schemas/src/registry/artifact-types.ts`, `packages/schemas/src/json-schema/emit.ts` and the
regenerated `packages/schemas/json/*`, `packages/core/src/artifacts/validate.ts`,
`packages/templates/src/index.ts` and `packages/templates/templates/artifacts/ParityEvidence.md` (plus
the fixture copy under `fixtures/greenfield-service/.forge/templates/`),
`modules/fm-core/module.yaml`, the migration registry, and the count assertions in
`packages/core/test/artifacts/{document,validate}.test.ts`, `test/frameworks.test.ts`,
`scripts/schema-drift.test.ts`, `packages/schemas/test/registry/artifact-types.test.ts`,
`test/fm-core-module.test.ts`, `packages/engine/test/dispatch/{output-claim,outputs}.test.ts`.

**Tests first.** Schema round-trip; registry id allocation gives distinct ids under concurrency (the
M15 P2 pattern); `schema-drift` clean; an edit of an existing record refused; a `schemaVersion: 1`
bundle still validates and a `2` bundle carrying `parityEvidence` validates; the `1→2` migrations pass
golden tests in both directions; `forge validate` and `forge doctor` neither flag nor mis-index
`reports/parity/captures/*.json`; the `{slug}` resolves.

**Mutation evidence.** Drop the registry entry: id allocation fails and the output-contract test names
the type unregistered. Make a record mutable: the append-only test fails. Make `down` keep the new
fields: the golden test fails.

**Discloses.** `planArtifactMigrations` walks only the specs tree, so `reports/` evidence is never
migrated by `forge upgrade` — a pre-existing limit — which means version-1 records stay version 1 on
disk and every reader accepts both. Nothing reads a `ParityEvidence` yet (P7, P9).

---

## P6 — `forge parity capture`

**Mandate.** `forge parity capture [--name <name>] [--json]` (omitted = every declaration). It loads
and validates the declaration, refuses an expired or unreviewed one, resolves `reference.ref` to a sha,
observes the reference in a scratch worktree (P3), runs the stability probe and normalisation (P4),
and writes the content-addressed capture through the atomic append-only writer. Re-capturing identical
behaviour is a no-op (the same bytes are the same file); a capture that would differ from an existing
capture with the same key is **refused**, naming the existing file and the remedy (retire it in
review, or change the declaration) — captures are never overwritten and never silently multiplied.
Under `--json` it prints one envelope, `{v:1, captured, unchanged, captures:[…]}`; refusals are typed
errors with remedies, never a stack trace.

**Surface.** `packages/cli/src/bin.ts` dispatch (a new top-level `parity` noun; free today),
`packages/cli/src/commands/parity/*`, `packages/core/src/errors/codes.ts` (`CFG-510`, `RUN-117`
onward), `packages/core/test/errors.test.ts`.

**Tests first.** Real subprocess tests in the `bin.test.ts` style: a fixture reference is captured and a
second run is `unchanged`; a nondeterministic fixture is refused as `unstable` and writes nothing; an
expired declaration, an invalid declaration and an unresolvable ref are typed refusals; a differing
re-capture is refused naming the existing file; `--json` stdout is exactly one line; the scratch
worktree is gone after every outcome.

**Mutation evidence.** Overwrite on a differing re-capture: the refusal test fails. Skip the
stability probe: the `unstable` fixture is captured. Emit prose under `--json`: the one-line test fails.

**Discloses.** Capture is a human act, deliberately: nothing in a workflow runs it, so a refactor cannot
mint its own oracle. Not safe to run concurrently with itself (no lock); disclosed.

---

## P7 — `forge parity check --json`, and the exit-test fixtures

**Mandate.** `forge parity check [--name <name>] [--json]`: select each declaration's capture (P2),
observe the candidate in place (P3), normalise and compare (P4), write a `ParityEvidence` record (P5)
and exit 0 only when nothing is failing. The `--json` envelope follows `10` §10.3: one JSON object,
`{v:1, passed, failing, matching, unobservable, total, evidenceId, results:[…]}`, exit 0 or 1 only, no
failure markers, a `reason` on any failing count caused by missing input. Zero declarations is failing
with a `reason`, not a pass. The fixtures are the spec's exit test made real: `fixtures/parity-refactor/`
holds a reference tree, a behaviour-preserving refactor and a refactor with one deliberate behaviour
change, plus the declaration; tests assemble real git repositories from them in system temp
directories.

**Surface.** `packages/cli/src/bin.ts`, `packages/cli/src/commands/parity/*`,
`fixtures/parity-refactor/`, `packages/core/src/errors/codes.ts`.

**Tests first.** Real subprocess: the preserving refactor exits 0 with `failing: 0`; the changing
refactor exits 1 naming the surface, the case and the first differing line; each non-match verdict
(`missing`, `ambiguous`, `unstable`, `expired`, `invalid`, `unclean`, `error`) is reachable and each
exits 1; no
declarations exits 1 with a `reason`; `--json` stdout is exactly one line; a ParityEvidence record is
written and its id is in the envelope; the check never modifies the working tree beyond its evidence
file; the envelope passes the real `evaluateGate` with `failOn: 'failing > 0'`.

**Mutation evidence.** Return exit 0 on a mismatch: the changing-refactor test fails. Treat zero
declarations as a pass: the no-declarations test fails. Skip the evidence write: the evidence-id test
fails.

**Discloses.** Not safe to run concurrently with itself or with edits to the observed tree; there is no
lock, and `unclean` catches an observation that changed the tree but not an edit made during one.
Every declaration applies to every refactor: a project retires a declaration when its subject changes
legitimately, or a stale one will refuse an unrelated refactor — correct strictness, and a sharp edge.

---

## P8 — The HTTP surface

**Mandate.** The `http` surface: a request/response pair observed through an in-process client against
a loopback server the harness starts. The declaration opts in explicitly (`network: loopback`, visible
in review), names a vetted start command, a literal loopback port, a readiness probe with a timeout and
a list of requests (method, path, headers, body). A new confined helper starts the server in its own
process group, **verifies the port is free before starting** (a held port is a refusal, never a
comparison against whatever is already listening), polls readiness while confirming the child is still
alive, and kills the group in a `finally`. The client refuses any host but loopback. Response status,
selected headers and body are normalised and compared like any other surface.

**Surface.** `packages/cli/src/commands/parity/*` (the helper placed beside the observer unless the
package boundary forces otherwise), `@forge/engine/dispatch`.

**Tests first.** A real tiny HTTP fixture server: matching responses match; a changed status, header or
body mismatches; a port already held is refused and the held server is never read; a server that dies
before readiness is an error, not a hang; the server process group is gone after success, failure and
SIGKILL of the harness-owned child; a declaration naming a non-loopback host is refused at load.

**Mutation evidence.** Skip the pre-start port check: the held-port test observes the stale server and
fails. Skip the kill: the leftover-process test fails.

**Discloses.** Loopback only; no TLS, no auth flows, no websockets, no streaming bodies. A harness
killed with SIGKILL can orphan the server it started; the next run then refuses on the held port rather
than comparing against it.

---

## P9 — `G-Parity`, `behavior:parity`, and the three workflows

**Mandate.** Add `packages/templates/templates/checks/G-Parity.gate.yaml` — `id: G-Parity`, no `phase`,
one deterministic check:

```yaml
    - id: behavior:parity
      run: 'forge parity check --json'
      parser: forge-json
      failOn: 'failing > 0'
```

— with `openQuestionsPolicy: block` and the approval and evidence blocks settled in BUILD against what
`runGateStep` and a human `forge gate approve` actually read. Extend `GateId`/`GATE_INDEX` and the
`forge init` content index; reword the two pin tests from "exactly the ten ids" to "the ten lifecycle
gates plus the workflow-scoped `G-Parity`", and add the spec amendment's pinned sentence. Edit the
workflows: `refactor` gains a first step `preflight-parity` (`kind: gate`, `gate: G-Parity`) that
`state-invariants` depends on, and `verify-parity` between `verify-invariants` and `commit`; `migrate`
gains `verify-parity` after `verify-migration`; `adopt` changes only in documentation. P9 settles by a
real run whether one gate can be referenced twice, and falls back to an entry preflight inside `forge
refactor` if not. It also pins that `forge gate list`, `forge gate check`, `forge doctor` and any
enumerate-every-gate path tolerate a phase-less gate and never evaluate it outside a workflow step.
The shipped fixture's generated `.forge/` copy is regenerated through a real `forge init` re-init,
copying back only the genuinely changed files, as M15 P5 did.

**Surface.** `packages/templates/templates/checks/G-Parity.gate.yaml`,
`packages/templates/templates/workflows/{refactor,migrate}.workflow.yaml`,
`packages/templates/src/index.ts` (`GateId`, `GATE_INDEX`), `packages/cli/src/init/content.ts`,
`packages/engine/src/gates/document.ts` (read; not modified unless the pin test finds a defect),
`packages/engine/src/dispatch/steps.ts` (`runGateStep`, read), `test/gates.test.ts`,
`test/workflows.test.ts` (the "ten-row catalogue" test), `test/command-steps.test.ts`,
`packages/cli/src/commands/run/gates.ts`, `fixtures/greenfield-service/.forge/`.

**Tests first.** Real `evaluateGate` against the shipped `G-Parity.gate.yaml`: the preserving fixture
passes, the changing fixture fails at `behavior:parity` naming the surface, a missing capture fails with
a `reason`. A real workflow run on the fixture: the preflight fails before any agent step when no
declaration exists; with a valid declaration `refactor` reaches `commit` and `GateEvaluated` events are
keyed by the two step ids. The two edited workflows parse, order the new steps correctly and name only
known gates. `forge gate list` and `forge doctor` succeed on a phase-less gate. `forge upgrade` on a
project initialised before M16 installs `G-Parity` and the edited workflows. The refactor-strictness
change is pinned: a refactor with no declaration is refused with the capture-and-declare remedy.

**Mutation evidence.** Remove the `verify-parity` step: the end-to-end changing-refactor test passes
through to `commit` and fails. Remove the preflight: the no-declaration test reaches an agent step and
fails. Drop `G-Parity` from `GATE_INDEX`: `forge init` omits it and the install test fails.

**Discloses.** `refactor` is stricter than before — a project must author a declaration that compares at
least one surface before any refactor runs; that is a deliberate behaviour change and is stated in the
release notes. A project with nothing observable to compare is refused rather than passed; whether the
existing waiver path can carry it inside a workflow step is settled in this piece's BUILD, and if it
cannot, that limit is disclosed. `migrate`'s step is structurally proven only until `forge migrate run`
is wired. `adopt` has no gate wiring.

---

## P10 — Failure kinds, per-run timeouts, and the load-failure asymmetry (M15 engine fixes)

**Mandate.** Fix the two M15 binding-engine gaps per-hunk work cannot tolerate, and nothing else. The
reporter classifies every failing outcome of a run as `assertion` (a test body ran and an assertion
failed), `load` (the file failed to import or collect before any body ran), `timeout`, or `crash` (the
runner or a test died, or threw something that is not an assertion), under both vitest and pytest. Every
run of the project's test command gets a timeout through the existing command limits, with an explicit
override flag; a run that exceeds it kills the process group and is a typed outcome — never a pass, never
a truncated result. A timed-out baseline is a typed refusal (binding cannot be established); a timed-out
revert run credits nothing, and the affected tests report as `timeout`, not as bound. The two runners
agree on a file that fails to load. The plan's position, which P1's text states and this piece confirms
by real runs under both runners (amending the sentence in its own commit if the runs show it wrong), is
that at **change level** a revert that makes a test file unloadable credits the baseline-passing tests of
that file under both runners — a new module's tests cannot load without the module, and M15's shipped
vitest behaviour already credits it — while at **hunk level** (P12) a text hunk whose reversal makes a
file unloadable is `invalid`, a stillborn mutant that proves nothing about an assertion.

**Surface.** `packages/cli/src/commands/loop/test/{reporter,binding,run,ecosystem}.ts`,
`@forge/engine/dispatch` (`runShellCommand` and the existing command limits),
`packages/core/src/errors/codes.ts`, `packages/core/test/errors.test.ts`.

**Tests first.** A classification table per runner over real fixtures that produce each kind (an
assertion failure, an import or collection error, a hang, a hard crash); the same "new module removed by
the revert" fixture credited identically under vitest and under pytest; a hung test is killed at the
limit, leaves no process behind, and the verb returns instead of hanging (the test carries its own outer
guard, so a regression fails rather than hangs); a baseline timeout is a typed refusal; every shipped M15
binding golden is unchanged except the ones this piece's disclosure lists, and the golden diff is that
list.

**Mutation evidence.** Classify an import error as `assertion`: the table fails. Drop the run timeout:
the hung-fixture test trips its outer guard. Restore pytest's empty-classname behaviour: the asymmetry
fixture fails.

**Discloses.** Every shipped verdict this piece changes, each with its before and after — the expected
one is a pytest change-level run whose revert breaks a collection, which moves from not credited to
credited. Retries and flaky-baseline handling stay out: one flaky baseline run can still decide a
verdict, and the log says so. The change-level range outside hunk mode stays `HEAD~1`.

---

## P11 — The hunk parser, hunk ids, and `--base`

**Mandate.** A pure module that turns the diff between an explicit base and the head into hunks, and
nothing that runs a test. The diff is produced with fixed flags — `git diff -U0 --no-renames` with fixed
prefixes and the `myers` algorithm — so the same pair always yields the same hunks and a rename is a
deletion plus an addition, over the change's implementation paths only (M15's implementation-versus-test
split; test files are never mutated). Each text hunk carries its path, its old and new ranges and a
content hash, and an id that is stable for one base/head pair and distinct for textually identical hunks
in one file; the format is this piece's, under the requirements P1 states. A hunk is *reversible* when
`git apply -R --check --unidiff-zero` accepts it against the head tree; one that is not is recorded
`invalid`, never dropped. Binary, mode-only and other non-text changes become file-level mutants. All
the text hunks of a file, reversed together, must reproduce the base bytes exactly, CRLF and
no-trailing-newline files included, handled as bytes. `--base <ref>` is the explicit base for hunk mode:
required with `--hunks`, resolved to a sha, and in hunk mode it governs the whole run — the change-level
portion included — so the two halves of one envelope describe one range. Threading a base through the
existing change-set computation is part of this piece; without `--hunks` the range stays as M15 shipped it.

**Surface.** A new `packages/cli/src/commands/loop/test/hunks.ts` beside the binding engine,
`packages/cli/src/commands/loop/test/binding.ts` (the implementation-versus-test split; the change-set
computation), `packages/cli/src/bin.ts` (the `forge test binding` dispatch), `packages/vcs` (a diff or
apply helper only if none fits), `packages/core/src/errors/codes.ts` (`USR-005`),
`packages/core/test/errors.test.ts`.

**Tests first.** Property tests over real throwaway git repositories with generated edits (several hunks
per file; added, deleted and modified files; CRLF; no trailing newline; a binary file; a rename):
reversing every text hunk reproduces the base exactly; ids are unique, and identical across two parses of
the same pair; two textually identical hunks in one file get distinct ids; a non-reversible hunk is
`invalid`, not absent; `--hunks` without `--base`, and an unresolvable `--base`, are typed refusals; with
`--base` equal to the default range the change set equals the one M15 computes.

**Mutation evidence.** Drop `-U0`: the pinned hunk count for a known diff changes and fails. Drop
`--no-renames`: the rename case yields one unreversible entry and fails. Derive the id from the ordinal
alone: the identical-hunks case collides.

**Discloses.** Hunk boundaries are a diff-algorithm artefact — another algorithm yields other hunks — so
the algorithm is pinned and recorded in the evidence. A hunk is a unit of text change, not a semantic
one, and the parser is not language-aware: a comment-only or formatting-only hunk is still a hunk.

---

## P12 — The per-hunk mutation engine: `forge test binding --hunks`

**Mandate.** Opt-in per-hunk mutation for one story:
`forge test binding --story <id> --hunks --base <ref> [--max-hunks <n>] [--json]`. It runs M15's three
change-level runs unchanged (baseline, revert, restore) and then, for each P11 hunk, one mutant run: in
the lane worktree, apply the reverse of that one hunk, run the story's tests under the per-run timeout
(P10), classify the outcome, and put the tree back and verify it (`restoreVerified`, as M15 does) —
**N + 3 runs** for N hunks. A hunk is `killed` when a test that passed at baseline fails with an
`assertion` or a `crash` (named in `killedBy`); `uncovered` when every baseline-passing test still
passes; `invalid` when the reversal did not apply cleanly or every failure is a `load` failure; `timeout`
when the run timed out with no killing failure; `skipped`, with the reason recorded, when the run could
not proceed (a failing baseline, for one). A file-level mutant follows the change-level policy, so a load
failure kills there. Above `--max-hunks` (the default is fixed in BUILD; the plan expects about two
dozen) it degrades hunk → file → change and reports the `granularity` it actually used; it never
samples. The verb is **report-only**: exit codes follow the change-level result exactly as they do
without `--hunks`. The `--json` envelope is additive — `hunks[]`, a count per non-killed verdict, and
`granularity` — and every M15 field is unchanged.

**Surface.** A new `packages/cli/src/commands/loop/test/hunk-mutation.ts` beside the binding engine,
`packages/cli/src/commands/loop/test/{binding,reporter}.ts`, `packages/vcs/src/lanes.ts`
(`createLaneWorktree`, `removeLaneWorktree`), `packages/cli/src/bin.ts`,
`packages/core/src/errors/codes.ts`, `packages/core/test/errors.test.ts`.

**Tests first.** A fixture change with two hunks in one implementation file, one exercised by an
assertion and one not: exactly one `uncovered`, named by id and path, and the other `killed` with
`killedBy` naming the test. A comment-only hunk reads `uncovered` (pinned: the sharp edge is documented,
not hidden). A hunk whose reversal breaks a syntax or an import reads `invalid`, not `killed`. A hung
mutant reads `timeout` and the verb terminates. Over `--max-hunks` the verb degrades to file level with
`granularity: file`, and further to change level. With `--base` equal to the default range, every M15
field is byte-identical to a run without `--hunks` (a golden), and the exit code is identical for the
passing, incomplete and refusal outcomes. The lane worktree is gone and the project tree untouched
(`git status` clean, tree hash equal) after success, after a throw mid-mutant and after SIGKILL (the M15
`binding-sigkill` pattern). An import-only test for a newly added file still reads bound (pinned, and
disclosed below).

**Mutation evidence.** Count a `load` failure as a kill for a text hunk: the stillborn-mutant test
fails. Let `--hunks` change the exit code: the exit-parity golden fails. Skip the tree reset between
mutants: the contamination test (hunk A's reversal visible in hunk B's run) fails. Sample instead of
degrading: the degrade test fails.

**Discloses.** Cost: N + 3 runs of the test command, which is why the mode is opt-in and bounded.
Attribution is bounded by the story's own tests — a hunk covered only by another story's test reads
`uncovered`. A newly added file is one file-level mutant, killed by a load failure, so an import-only test
still reads bound there; hunk mode cannot attribute finer than the file in that case. One flaky run can
still decide a hunk's verdict. Comment-only and formatting-only hunks read `uncovered`.

---

## P13 — Hunk-level `MutationEvidence`, surfacing, and a project-authored hunk check

**Mandate.** Add the hunk-set shape `MutationEvidence`'s own doc comment reserved for this milestone. The
`mutationKind` literal gains a second member for hunk mutation (the name is fixed in P1), and a record
that uses it carries `schemaVersion: 2` with the base sha, the diff algorithm, the `granularity` used, and
the hunk list (id, path, ranges, content hash, verdict, `killedBy`). `forge test binding --hunks` writes
it through the append-only writer M15 P7 built — an existing change-level record is never rewritten — and
surfaces it: the human output lists every non-killed hunk by id and path with its verdict, and the
`--json` envelope's hunk list equals the record's. M16 ships **no** default hunk threshold, but a project
must be able to author one, so this piece proves through the real gate evaluator that a project-authored
check running `forge test binding --story <id> --hunks --base <ref> --json` with
`failOn: 'uncoveredHunks > 0'` fails on a fixture with one uncovered hunk and passes on a fully covered
one, under `10` §10.3's contract (one JSON object, exit 0 or 1, no failure markers).

**Surface.** `packages/schemas/src/artifacts/mutation-evidence.ts` (and its `index.ts` export), the
regenerated `packages/schemas/json/*`, the `MutationEvidence` template under
`packages/templates/templates/artifacts/` and its fixture copy,
`packages/cli/src/commands/loop/test/binding-evidence.ts`, `packages/engine/src/gates/document.ts` (read),
`scripts/schema-drift.test.ts`.

**Tests first.** A version-1 record still validates; a version-2 hunk record validates and round-trips;
a version-2 record with a hunk that has no verdict is refused; the `1→2` migration's `down` strips the
hunk set and yields a valid version-1 record (the golden from P5); the writer is append-only; the
envelope's hunk list equals the written record's, hunk for hunk; the project-authored check passes and
fails as above through the real evaluator, and a hunk run whose change-level result passes (exit 0)
still fails that check, since `failOn` is evaluated on the parsed envelope.

**Mutation evidence.** Drop `killedBy` from the writer: the envelope-versus-record test fails. Let the
check ignore `uncoveredHunks`: the check-proof test fails.

**Discloses.** No default threshold, and why: comment-only and formatting-only hunks read `uncovered`,
there is no hunk exemption mechanism, and attribution is bounded by the story's own tests. A project
that gates on `uncoveredHunks` takes on all three, and the walkthrough in P16 says so.

---

## P14 — Evidence retention: `forge evidence prune`

**Mandate.** The retention policy M15 P7 deferred. `forge evidence prune [--apply] [--keep <n>] [--json]`
is a **dry run by default**; `--apply` acts. It keeps the newest `n` records per (type, subject) —
`n` ≥ 1, default 5, the precedent being `03` §3.4's "retaining the last 5" backups — over the
retention-managed evidence types (`MutationEvidence`, `EvidenceBundle`, `ParityEvidence`; the subject is
the story, or for a `ParityEvidence` with no story the declaration name). The highest id of each type is
never pruned — implied by `n` ≥ 1, and pinned on its own because the allocator's no-reuse guarantee rests
on it. A record that anything still references is protected and reported with the reason; this piece
enumerates every store that can hold an evidence id (a surviving `EvidenceBundle`, a gate approval or
waiver, a story field, and whatever the enumeration finds) and tests each. Pruning a record first writes
an exclusive-create tombstone for its id (`docs/forge/reports/pruned/<id>.json`: id, type, subject, the
record's sha256, the pruning time from the injected clock) and then removes the record, so a crash
between the two leaves a state the next prune completes, and a repeated or concurrent prune is
idempotent. A reference to a pruned id resolves to a distinct "pruned" answer naming the tombstone, never
to "dangling". `18` §18.8's "never reused, files retained" is scoped in P1 to say what it means for
retention-managed evidence; whether the id allocator must read tombstones is decided here under an
invariant test.

**Surface.** A new `packages/cli/src/commands/evidence/` directory, `packages/cli/src/bin.ts` (a new
`evidence` noun; free today), `packages/core/src/fs/atomic.ts` (`writeNewFileAtomic`),
`packages/core/src/ids/{allocator,scan}.ts` (read; changed only if the invariant test finds a defect),
`packages/cli/src/commands/run/gate-commands.ts` (the evidence-resolution refusal path),
`packages/schemas/src/registry/artifact-types.ts` (read), `packages/core/src/errors/codes.ts`,
`packages/core/test/errors.test.ts`.

**Tests first.** The dry run writes nothing and names its victims. `--apply` keeps exactly the newest `n`
per (type, subject) and removes the rest. The highest id of each type survives any `--keep`. One test per
reference store proves a referenced record is protected and reported. A tombstone exists for every pruned
id, and was written before its record was removed (fault injection at that point). `--keep 0`, a negative
and a non-integer are typed refusals. **Real multi-process runs**, not `Promise.all` in one process:
several concurrent `forge evidence prune --apply` processes against one store end in the same state as one
prune, with exactly one tombstone per pruned id and no process error, and a concurrent evidence append
during a prune is never lost or given a duplicate id. A property test over random prune and append
sequences shows no id is ever allocated twice. `forge validate` and `forge doctor` stay clean after a
prune. Citing a pruned id in a gate approval is refused with the "pruned" reason.

**Mutation evidence.** Allow `--keep 0`: its refusal test fails. Skip the tombstone: the tombstone test
fails. Remove the record before writing the tombstone: the fault-injection test fails. Skip the
referenced-id check: the per-store tests fail. Prune the highest id: the invariant fails. Make `--apply`
the default: the dry-run test fails.

**Discloses.** There is no lock; idempotence replaces it, and the log states the concurrency the real
runs actually held clean at (`forge-cross-process-locking` lesson: "clean on N runs", never "every
time", re-run during clean-worktree verification). Capture files are never pruned — they are the oracle's
baseline, not its evidence — so they accumulate, one per declaration change. `Exemption` and `Disclosure`
collections, the event log and the tombstones themselves are not pruned either; event-log retention is
`forge state prune` (`20` §20.7), which this milestone does not build. There is no configuration key for
the default `n`.

---

## P15 — Telemetry: `kind: 'parity'`, additive hunk counts, and `forge report`

**Mandate.** Extend the measurement M15 started, so M17 has a before-picture for these oracles.
`forge parity check` emits a `CheckRun` event with a `kind: 'parity'` payload — counts per verdict, the
total, the evidence id and the declaration names, never an observation — and `forge test binding --hunks`
adds its hunk counts and `granularity` to the existing binding payload as optional fields. Both ride
M15 P14's machinery: gated on `FORGE_RUN_ID`, redacted at write time with the existing secret patterns,
appended through the locked event-log writer. `forge report` (a pure projection of these events) renders
a parity line and a hunk line. P1's text states the versioning rule this piece pins: an added field or an
added `kind` never bumps the event's `v`, and a projection ignores a `kind` it does not know.

**Surface.** `packages/cli/src/commands/loop/test/check-telemetry.ts` (the existing binding emitter) with
a parity emitter beside the parity verbs in `packages/cli/src/commands/parity/`,
`packages/cli/src/commands/report.ts`, `packages/extensions/src/skills/patterns.ts` (`SECRET_PATTERNS`,
read), the event-log writer in `@forge/telemetry` (read).

**Tests first.** With `FORGE_RUN_ID` set, a real `forge parity check` in a temporary project appends
exactly one `CheckRun` event of kind `parity` with the expected counts and no observed content; with it
unset, nothing is appended. A real `forge test binding --hunks` appends the hunk counts onto the binding
payload. A secret-shaped value seeded into a payload field is redacted at write time. `forge report` over
a real log renders the parity and hunk lines, renders a pre-M16 log (no parity events, binding payloads
without hunk counts) exactly as before (a golden), and ignores an event of an unknown kind.

**Mutation evidence.** Emit without the `FORGE_RUN_ID` gate: the unset case fails. Add the observation
text to the payload: the no-content test fails. Project an unknown kind as parity: the ignore test
fails.

**Discloses.** Telemetry is a measurement, not a verdict, and a run without `FORGE_RUN_ID` is invisible to
it. The event payload is `unknown` in the shared type, so the contract lives in P1's text and in these
tests. Redaction is pattern-based, not a guarantee.

---

## P16 — Docs: authoring a declaration, a real walkthrough, and the status line

**Mandate.** Documentation only. `docs/method-guide.md` gains the parity method: what a reference oracle
is and is not (declared surfaces matched — never "behaviour is preserved"), how to author a declaration
(the `review` block and what counts as review, `expires` and renewal, what to declare `unobservable` and
why that is an owned exemption, normalisation and its limits), the capture-then-check cycle, why
`refactor` is now strict, and what per-hunk results do and do not tell you, including the three costs of
gating on `uncoveredHunks`. `docs/getting-started.md` gains a run-for-real walkthrough on the shipped
`fixtures/parity-refactor/`: capture, a behaviour-preserving refactor passing, a deliberate behaviour
change refused, then the hunk and prune commands — every pasted output observed from a real run, none
composed. `README.md`'s status line is updated to what is true after M16.

**Surface.** `docs/method-guide.md`, `docs/getting-started.md`, `README.md`.

**Tests first.** Documentation-only, with no automated docs test to write; M15 P13 had none either.
Verification is the gauntlet's: each critic re-runs the walkthrough literally in a fresh clone, every
command the docs name must be one the real CLI accepts, and the existing `test/spec-cli-examples.test.ts`
pins stay green. A walkthrough step that does not reproduce is a finding.

**Mutation evidence.** Not applicable to prose; the critics' literal re-run is the check.

**Discloses.** The walkthrough runs on a fixture, not on a real production refactor — P17 is that, if
authorized.

---

## P17 — Live run (owner-authorized only)

**Mandate.** Prove the milestone against a real agent and a real model, once, as M15 P14 did: a small
real project with a real parity declaration; a behaviour-preserving `forge refactor` that reaches
`commit`; a refactor with a deliberate behaviour change refused at `verify-parity`;
`forge test binding --hunks` on a real completed story; a real `forge evidence prune --apply`. Whatever
the run finds is fixed under the gauntlet and recorded, as M15 P14's own real run was.
**This piece does not start without the owner's explicit authorization in the conversation** — it spends
real money and uses the API key in the gitignored `.env`. The spec's M16 exit tests have no live item, so
the milestone's code exit is complete without it, and the final report says whether it ran.

**Surface.** None new — a run, a log entry, and whatever fixes the run forces.

**Tests first.** Each defect the run finds gets a failing regression test before its fix.

**Mutation evidence.** Per fix.

**Discloses.** What one real run on one real project does and does not show — the limit M15 P14 stated.

---

## Exit tests

```
node scripts/run-tests.mjs run                  # the whole suite
node scripts/run-tests.mjs run -t "M16"          # every test this milestone added (specs/22's `pnpm test -- --grep` shorthand, corrected in P1)
pnpm test                                        # the real script: coverage, ratchet, boundaries
pnpm typecheck && pnpm lint
pnpm emit-schemas && pnpm schema-drift
forge parity check --json    # fixtures/parity-refactor/, the deliberate behaviour change: refused (exit 1; names the surface and the case)
forge parity check --json    # fixtures/parity-refactor/, the behaviour-preserving refactor: exit 0, failing 0
forge test binding --story <id> --hunks --base <ref> --json   # one uncovered hunk, named by id and path
forge evidence prune --json                      # a dry run: names what it would prune, writes nothing
```

P17 adds a live item if, and only if, the owner authorizes it.

## What this milestone deliberately does not do

- **Visual or screenshot parity.** Helix's visual-equivalence gate is a different problem with a
  different oracle.
- **A parity claim for greenfield stories.** New behaviour has no reference; `implement-story` keeps
  relying on M15's binding oracle. (A `refactor` of already-built code always has a reference — the code
  before the change.)
- **Operator mutation** (changing `<` to `<=`). M16's mutants are reversals of real hunks.
- **Event-log or session-state retention** (`forge state prune`, `20` §20.7). M16 prunes evidence
  records only.
- **Fixing M15's `HEAD~1` range outside hunk mode**, or a flaky-test, retry or quarantine policy for the
  binding engine.
- **External validation of any of this.** Whether the oracles are right is M17.
- **Orchestration changes.** No step kind, conditional or scheduler behaviour; P9's edits are three
  `kind: gate` steps, which the engine already runs.
- **A default hunk gate threshold, or hunk exemptions.**
- **Agent-authored parity declarations.** A declaration and a capture are human acts; the agent under
  test cannot write either.
- **Cross-platform equivalence or normalisation beyond the declared rules.** A capture from another
  platform is `missing`, never silently compared.
- **Latency, resource or concurrency-ordering parity.** Timing and memory are not compared.
- **Closing pre-existing wiring gaps** — `forge migrate run` and the `adopt` gate (`Q213`/`Q202`).
- **Pruning capture files, the `Exemption` and `Disclosure` collections, the event log, or tombstones.**
- **A lock for `forge parity capture` or `check`.** Disclosed in P6 and P7.
