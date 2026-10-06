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

Oracles 5 and 6 compare against a reference. F-TEST-9 (post-v1.0, `specs/22` M16) is their normative
definition where a reference exists: what a differential or reference-implementation comparison must
rest on.

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
- **AC-binding (`09` §9.5) is nominal, not behavioural, and this framework names the gap rather than
  letting it pass unremarked.** A test satisfies §9.5 by being named and annotated with an AC id and
  reported against it — nothing in that rule asks whether the test would fail if the behaviour it
  names were removed. `test('AC-014-2 returns 422 for an empty invoice', () => expect(true).toBe(true))`
  is AC-bound today. Closing this is **behavioural binding** (post-v1.0, `specs/22` M15): for a
  completed unit of work, revert the implementation change and require its named tests to fail,
  then restore and require them to pass again — the simplest possible mutation operator (the whole
  change, reverted, rather than one operator applied to one line) chosen specifically because it is
  cheap enough to run per story, at commit time, as a **gate-blocking** check (`test:binding`),
  which this section's own nightly Stryker-class mutation testing is deliberately not (per-commit
  mutation testing on every package would not fit inside `13.1`'s fast-feedback requirement,
  F-TEST-7 point 6). The two are complementary, not duplicative: behavioural binding is coarse,
  universal, and blocks a merge; nightly operator-level mutation testing on core domain packages is
  precise, informational, and does not. Neither replaces AC-binding (`09` §9.5), which remains the
  mechanism that maps a result back to a specific acceptance criterion at all; behavioural binding
  only adds the question §9.5 never asks.

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

### F-TEST-8 · Exempting a test from behavioural binding (post-v1.0, `specs/22` M15)

Not every test can be mutation-bound: a pure type-level assertion, an external-snapshot fixture a
human already reviewed, and a timing or resource-exhaustion guard each have no implementation hunk
whose revert would make them fail for the right reason. Behavioural binding (F-TEST-5) needs an escape
hatch for these, shaped like F-TEST-6's own quarantine mechanism rather than invented fresh — an
exemption is governance, not a free pass, and the framework says so the same way quarantine does:

- An exemption names the test id, a reason in prose, an owner identifier, and an expiry — the
  identical shape `10` §10.3 rule 1's waiver already carries (reason, owner, expiry), reused rather
  than given a second one.
- **A stale exemption fails the check.** An exemption that matches no currently non-binding test — the
  test it names now passes behavioural binding on its own, or no longer exists — is itself a failure,
  naming the stale exemption. Not a new invariant: FORGE's own build process already applies this exact
  discipline to a structurally identical exemption list
  (`test/brief-write-paths-in-claim.test.ts`'s own `EXEMPT` table, "known false positives... fail the
  test when stale, so they cannot outlive their evidence"); behavioural binding's own exemptions follow
  the same rule, not a new one invented for them.
- **An expired exemption fails the check**, naming its own expiry and owner, the same way an expired
  waiver already does.
- **Exempting a test that currently binds is refused.** An exemption excuses a real gap; pre-emptively
  exempting something that works is not disclosure, it is insurance against a future regression never
  being caught, which this framework does not permit.
- Every exemption is recorded in the project's disclosure ledger (`18` §18.7's `Disclosure` type)
  automatically, so "we exempted it" is never invisible the way F-TEST-6's own quarantine is never
  invisible ("quarantine is visible in every gate report").

### F-TEST-9 · Parity oracles: the differential and reference-implementation oracles made normative (post-v1.0, `specs/22` M16)

F-TEST-2's oracles 5 and 6 compare against a reference — the implementation before a change, or an
implementation the project already trusts and holds at a git ref — and until now said nothing about
what such a comparison must rest on. The danger is the one F-TEST-2 already bans: a "reference"
recorded from the code under test is that code agreeing with itself. A **parity oracle** is therefore a
*reviewed declaration* plus an *immutable capture* of the reference's behaviour, never a recording of
whatever the candidate does. Parity applies only where a reference exists: a `refactor` always has one
(the code before the change), `adopt`'s is the system as found (`17` §17.4 item 3), and greenfield work
has none, so it must not claim parity and keeps relying on behavioural binding (F-TEST-5).

- **The declaration** is `.forge/parity/<name>.parity.yaml`, one file per declaration, its `name` the
  file stem. It names the reference (`reference.ref`) and the surfaces to compare. `reference.ref` is
  a full commit sha (40 hexadecimal digits, or 64 in a repository that uses SHA-256) or a tag name,
  resolved to the commit it points at: a sha as `<sha>^{commit}` and a tag as
  `refs/tags/<name>^{commit}` (so a tag is peeled), with replace objects disabled, because an
  unqualified name follows git's own ambiguity rules and a ref planted elsewhere could win, and under
  the exactness rules that the trust anchor states below (a tag name that `git check-ref-format` does
  not accept as `refs/tags/<name>`, `v1~1` for one, is `invalid`); `HEAD` and an abbreviated sha are
  each `invalid`, because each can move or be ambiguous. So, checked explicitly against
  `refs/heads/<name>` and regardless of whether a tag of the identical name also exists, is a name
  that names a branch, since a branch moves exactly as `HEAD` does, which the self-agreeing oracle
  (F-TEST-2) bans as a reference; a bare name that names no branch is resolved only as a tag, so one
  with no matching tag reads `missing`, never `invalid`. The
  declaration is human-authored and committed. It is not unwritable by an agent: `.forge/**` is in the
  never-writable floor for agent steps, but that floor is enforced after the fact, by claim
  enforcement (`06` §6.7), which runs only when the adapter reports changed files, so a session that
  commits its own work is not reverted (disclosed in `process/SPEC-QUESTIONS.md` Q212). The floor is
  therefore not what protects the oracle: the trust anchor below is, and it has a boundary of its own,
  stated there. It satisfies "human or spec review" (F-TEST-2) only with a `review` block — `by` (the
  reviewer), `basis` (what the review rested on) and `at` (when) — **and** an `expires` date. A
  declaration missing either is `invalid`; one that has reached its `expires` date is `expired`
  until a person renews it (the date is read as UTC and expires at its start, as an F-TEST-8
  exemption's expiry does). FORGE enforces the block's presence, shape and expiry; it cannot judge
  how careful the review was.
- **A capture** is the reference's observed, normalised behaviour, taken at the declared ref in a
  scratch worktree, never in the candidate's tree, and stored at
  `.forge/parity/captures/<sha256>.json`. It holds the declaration's name and digest, the reference's
  ref and sha, the platform and, for each case, the normalised observation (for a file in `bytes`
  mode, its sha256 alone), as canonical JSON (compact, with keys sorted at every depth and no
  trailing newline), in UTF-8; it holds no tool or interpreter version, no clock time and no host
  path of its own, so identical behaviour is the identical file. It is **content-addressed** (its
  file name is the sha256 of its canonical bytes), **digest-bound** (it records the declaration's
  digest: a sha256 over the whole declaration in canonical form, except `review`, `expires` and
  `unobservable`, joined with the content hashes of the files it overlays and the bytes of the
  probes it names, so renewing a review does not invalidate a
  capture and changing anything that determines what is observed, or how, does) and **never
  overwritten**. A capture's file name must equal the sha256 of its canonical bytes, which is verified
  whenever a capture is read: a capture that fails the check is `invalid`, and so is the declaration
  whose name it records. Capturing identical behaviour again is a no-op; a capture that would differ
  from an existing one with the same key is refused, never replacing it and never sitting beside it.
  Capture is a human act that no workflow runs, so a refactor cannot mint its own oracle, and
  `forge parity capture` refuses whenever the FORGE session marker `FORGE_RUN_ID` is present,
  whichever run it names (`10` §10.3 rule 6 defines the marker, an honest-session signal and not a
  security boundary). Captures are never pruned (`18` §18.8). The way out of a refused capture (the
  reference's behaviour legitimately changed under the same key) and of `ambiguous` is a reviewed
  commit that deletes the stale capture file; FORGE itself never deletes a capture.
- **The trust anchor.** A declaration, probe or capture that was rewritten is not an oracle, so
  `forge parity check --trusted <ref>` compares everything under `.forge/parity/`, whatever `--name`
  selects, with the tree at `<ref>`, which is a full commit sha or a ref name that begins `refs/`
  and that `git check-ref-format` accepts; `HEAD`, an abbreviated sha and a bare name (which a tag
  can shadow) are refused. It is resolved once, by `git rev-parse --verify <ref>^{commit}` (the form
  above cannot begin with `-`, so the argument cannot be read as an option), and the commit id that
  returns is the one every later step uses. A ref name is resolved only after
  `git show-ref --verify <ref>` confirms that exact ref exists (a name that merely resolves, as
  `refs/heads/refs/heads/main` does for `refs/heads/main`, is not that ref), and a sha is accepted
  only as lower-case digits of the repository's full object-id length, the id `rev-parse` returns
  having to be those same digits (an abbreviation, an upper-case spelling and a tag object's id are
  refused). A `reference.ref` is held to the same rules, a tag being checked as `refs/tags/<name>`:
  an invalid name or sha is `invalid`, and a valid one that resolves to no commit (a tag that does
  not exist, for one) is `missing`. The harness makes the comparison itself and does not ask
  git what changed: it lists every entry under `.forge/parity/` as it is on disk, without following
  symlinks and with ignored and untracked entries included, and compares each path, and the git blob
  id of each file's raw bytes, with the listing of `git ls-tree -r -z <commit> -- .forge/parity`
  (`<commit>` being that id), run with the project root, the directory that holds `.forge/`, as its
  working directory. The blob id is computed in-process, in the repository's object format (a
  64-digit commit id means SHA-256), with no filter or line-ending conversion, which
  `git hash-object <path>` would apply. It never consults the index or `git status`, which a
  `skip-worktree` or `assume-unchanged` flag, or an ignore rule, can blind. Every git command the
  harness runs has replace objects disabled (`GIT_NO_REPLACE_OBJECTS=1`), because `git replace` can
  make a ref read as a different tree. The comparison is made first, before any case runs, and, when
  a case ran, again after the last, against the same commit id, so a ref that moves while the check
  runs does not move the anchor. A path added, modified or deleted relative to that tree is
  `oracle-changed`, whether the difference is committed, staged, untracked or ignored, and so is a
  symlink or any other entry that is neither a regular file nor a directory, whatever the tree holds
  (`.forge` and `.forge/parity` themselves included: where present, each must be a directory), and so
  is an entry that cannot be read. Modified means a different blob id. A file's mode (its executable
  bit) is not compared, and an empty directory, which git records no entry for, is not an entry: the
  harness executes nothing under `.forge/parity/` in place (an overlaid file is written as a plain
  file, below) and loads nothing from a mode or an empty directory, so neither can change what it
  loads or runs. Paths are compared as raw bytes, so a case-only or
  Unicode-normalisation respelling reads as one path deleted and another added. A checkout that
  converts bytes (line endings, an `ident` expansion, a smudge filter, a `working-tree-encoding`)
  reads as a modification, so a project marks `.forge/parity/**`
  `-text -filter -ident -working-tree-encoding` in its `.gitattributes`: `-text` alone cures only the
  line endings. `oracle-changed` makes every declaration `invalid` and the overall verdict `invalid`,
  and the envelope carries it as its own `reason`, naming each differing path, even when the change
  was the deletion of every declaration, which reads `oracle-changed` and not `no-declarations`. At
  the first comparison each file is read once: the bytes compared are the bytes loaded, and a probe or
  an overlaid file is written into the tree under observation from those same bytes, never read from
  `.forge/parity/` again. The second comparison reads the tree afresh, only to compare it again, and
  loads nothing. A `--trusted` that is not in the form above, or that does not resolve, is a refusal
  (`ok: false`), never a skipped comparison; without `--trusted` the check makes no comparison and the
  evidence records `trusted: null`. The `G-Parity` gate's one check is
  `forge parity check --json --no-record --trusted refs/heads/main` (`10` §10.3 rule 8), so inside a
  workflow run the anchor is trunk, an explicit argument of the command and nothing sniffed from the
  environment.
- **The anchor's boundary.** The comparison makes a rewritten oracle fail the evaluation that sees it,
  in that run and in every later one until the anchor and the tree agree again. It does not prevent
  the rewrite or its landing: a lane is integrated onto the integration branch between ticks whatever
  a gate says, so the gate that sees a rewrite sees it after it has landed there; an agent with a
  shell can move a ref; code a case runs can change a file and restore it between the two comparisons,
  which neither sees (the harness uses only the bytes it loaded, so such a change alters nothing the
  harness itself writes into a tree or compares, but a case's own command can read the file while it
  is changed, and code a case runs can do anything the user can in any case); and a
  project that configures its integration branch to be the trunk itself gets no protection, because
  lanes then land on the anchor.
  It cannot tell a person's deliberate change from an agent's: a reviewed change to `.forge/parity/`
  is trusted once it is on the anchor, and until then reads `oracle-changed`. The gates a run
  evaluates are read from the main project when the run starts, so a lane's edit of a gate or check
  file does not change that run. By hand, `forge gate check G-Parity` runs the same command, so it
  compares with trunk too.
- **Stability.** A reference that disagrees with itself is not an oracle. At capture each case runs
  `stability.runs` times against the reference (default 3; an integer from 2 to 10, else the declaration
  is `invalid`) and every run must be equal after normalisation, else the case is `unstable` and capture
  refuses and writes nothing. At check each case runs `stability.runs` times on the candidate, and
  every run must be equal after normalisation, else the case is `unstable`; the value the runs share
  is what is compared with the capture. Stability is a sample: a case that varies too rarely for
  `stability.runs` runs to show it can still read `match`.
- **A reference that did not do what was expected is not an oracle either.** Capture refuses a case
  whose reference run exits with a code other than the case's declared `expect` exit (default 0), a
  run that a signal ended included, and a case whose entire observation is empty unless it declares
  `expect: empty`.
- **Normalisation** is declarative and bounded: no code from a declaration runs. Before any declared
  rule runs, the harness rewrites each observed tree's root path, both as given and as its real path, to
  a fixed token, so where a tree happens to live is not a behaviour difference. The rules are
  `strip-ansi`, `line-endings`, `trim-trailing-whitespace`, `sort-lines`, `json-canonical` (parse, sort
  keys, re-serialise; a non-JSON observation is an error, not a pass), `ignore-json-pointers` and
  `replace` (a regular-expression source with a literal replacement, scoped to a stream or an output
  file, linted at load for catastrophic-backtracking shapes — conservative, not a proof of linear time —
  and run under a time limit, exceeding which makes the case `error`). The rules run in the order a
  declaration lists them: `line-endings` rewrites CRLF and a lone CR as LF; `strip-ansi` removes CSI
  escape sequences (`ESC [`, parameter and intermediate bytes, then a final byte);
  `trim-trailing-whitespace` removes the spaces and tabs at the end of each line; `sort-lines`
  orders lines by UTF-16 code unit; and `replace` replaces every match. A rule that would erase a
  non-empty observation entirely is refused, and so is a `replace` whose match is the entire content of
  a non-empty stream: a surface that does not want a stream says so with `streams` (below) rather than
  erasing it. **Equality is decided on the full normalised content**, never on a truncated display:
  a mismatch report shows the first differing line with context under a byte cap, labelled as
  display only, and printed only without `--json`: an envelope and a `ParityEvidence` record carry
  no observed text, and a `reason` says where a difference is (the surface, the case and the
  stream), never what the text was. The secret check runs on exactly what would be stored, which is
  the observation after normalisation. An observation that contains a secret, or a text observation
  that does not decode as UTF-8, is refused at capture, before anything is stored.
- **The surfaces** are four, and only declared surfaces are observed; everything else is unobserved. A
  declaration lists its surfaces, each surface lists its own cases (at least one: a surface that lists
  none observes nothing, and its declaration is `invalid`), and a case belongs to exactly one surface
  and is run against that surface alone. `process` observes the stdout, stderr and exit code of a
  vetted command, or, where a signal ended the process and so there is no exit code, that signal.
  Vetting is the engine's check of a command that a project stores and FORGE runs
  (the confinement model of `20` §20.1, as the engine applies it to a stored command): one plain
  invocation, with no chaining, redirection or substitution, no variable, tilde or brace expansion
  and no shell `-c` string, nothing on the hard denylist, and `network: none`, which no declaration
  can relax for a command, so a program on the engine's list of network programs (`curl`, `wget` and
  `ssh`, for three), a URL and, for the package managers the engine knows, a verb that fetches or
  changes dependencies (an install, for one) are refused, and every path it names that exists, a
  glob's matches included, must stay inside the project, a symlink being followed to where it ends
  (a path that does not exist yet is judged by its text alone). It also refuses what the engine's
  other lists name: some programs that run another program (`env`, `xargs`, `timeout`), some that
  change files or the environment (`rm`, `mv`, `chmod`), some package runners that fetch what they
  run (`npx`), `find` with `-exec`, `-execdir`, `-ok`, `-okdir` or `-delete`, a git subcommand
  outside the engine's read-only set, and a path whose name, as written, matches the engine's
  patterns for a secret file, `.git` or `.forge/state`. Those lists, the one of network programs
  included, are closed, not classes, so a program or path on none of them passes (`cp`, `touch` and
  `python3 -m pip install` do), and vetting is a filter on what a reviewed declaration can say, not
  a sandbox. A glob is allowed, unlike in the test command that `20`
  §20.1 grants, which may not name a `*`. Vetting is applied when the declaration loads, against the
  project's tree, whichever tree a command later runs in. A `run` or `setup` that vetting refuses, a
  `run` composed with a case's arguments (below) included, makes the declaration `invalid`, so a
  declaration that can never run fails at load. A surface that
  wants only some of the two streams lists them with
  `streams` (for example `streams: [stdout]`), and an unlisted stream is unobserved, which shows in
  review and is reported in the evidence. `file` observes declared output files at declared paths,
  cleaned before and after each case. An output path must be relative, with no `..` component, and lie
  outside `.git` and `.forge`, and one that is tracked in git in the tree being observed is `invalid`;
  before cleaning, the harness examines each component of the path without following links, and a case
  whose output path passes through a symlink is `error`. Cleaning therefore deletes only a file the
  reviewed declaration names, and never a tracked one. A declared file that is not text is declared in
  `bytes` mode: only its sha256 is observed and stored, never its content. `library` is the probe
  protocol below. `http` observes a request/response pair through an in-process client against a
  loopback server the harness starts with the declaration's vetted start command: an explicit opt-in
  in the declaration (`network: loopback`, visible in review), with a literal loopback port verified
  free before the server starts — a held port makes the case `error`, never a comparison against
  whatever is listening — and a client that refuses any other host. A case has no placeholders: its
  inputs are overlaid files, copied from under `.forge/parity/` (where the trust anchor covers them)
  to a declared destination in the tree being observed, under the output-path rule above, written
  from the bytes the harness loaded as a plain file with mode 0644 whatever the source's (so a
  script is run through its interpreter), and removed after the case. Its arguments are literal
  words: each is appended to the surface's `run` as one single-quoted word, and the composed line is
  what vetting judges at load and what runs, so an argument that holds a single quote, a newline or
  a shell operator such as `;` or `|` cannot be declared (the declaration is `invalid`), and a value
  that cannot be a word is an overlaid input instead. A destination that already exists in that tree
  makes the case `error`; it is never overwritten.
- **The library probe protocol.** The `library` surface is a `process` surface whose command is a
  reviewed probe script under `.forge/parity/probes/`. The probe calls the library and prints exactly
  one JSON object on stdout: `{"ok": true, "value": ...}` for a return, or
  `{"ok": false, "error": {"name": ..., "message": ...}}` for a thrown error. A throw is an
  observation, compared like a return; a stack trace is not part of the protocol, because it carries
  host paths. Stdout that is not exactly one such object is `error`, never `match`. The probe's bytes
  are in the declaration digest and it is overlaid into whichever tree is observed, from the bytes the
  harness loaded, so the same reviewed bytes run against the reference and the candidate; being under
  `.forge/parity/`, it is covered by the trust anchor.
- **The environment is pinned.** Every case runs in a scrubbed environment with `TZ=UTC`,
  `LC_ALL=C.UTF-8` and `LANG=C.UTF-8`, so a locale or timezone difference between machines is not a
  behaviour difference.
- **Where each side is observed.** The reference in a scratch worktree at the declared ref, placed
  under the `.forge/state/` of the tree a capture runs in (gitignored, `18` §18.2) and always removed;
  the candidate in place, with its head sha, a dirty flag and a digest of its working-tree delta
  recorded. The scratch tree holds the ref's tracked files and nothing installed or built. Because it
  sits beneath the same project directory as the candidate, a runtime that finds dependencies by
  walking up the directory tree (Node's `node_modules`) reaches the same installed copy from both
  sides, so a change of installed dependency is not seen; for any other runtime, and for anything that
  must be built from the tracked files, a declaration carries `setup` commands, vetted exactly as
  `run` is (so `network: none` applies to a `setup` too: an install by a package manager the engine
  knows is refused, and a declaration is not given the registry allowlist that `20` §20.1 allows an
  agent that needs one, so `setup` is meant to build from what is tracked, which vetting narrows and
  does not enforce: see the honest boundary), whose bytes are in the declaration digest and which
  run only in the scratch tree, before the reference is observed (so only at capture: a check
  observes the candidate alone and runs no `setup`). With none, a surface that
  needs more than the tracked files cannot be observed on the reference side, and the declaration must
  say how to get it. FORGE builds nothing for the candidate. A case's command is the same on both
  sides, so one that reads build output must build it itself: ignored build output is outside the
  declaration digest, the anchor and the snapshot below, so a stale build of the candidate is not
  detected and can read as `match`. Observing must leave the candidate's tree unchanged. Before and
  after each case the harness takes a snapshot: `HEAD`, plus, for every path that
  `git status --porcelain=v1 -z --no-renames --untracked-files=all` lists (its paths are relative to
  the repository's top level, which can lie above the project root, and are resolved from there),
  its status code and a digest of its bytes (or `absent`, `dir` or `link:<target>` where it is not a
  regular file). The delta digest recorded for the candidate is the digest of the snapshot taken
  before the first case, and a case whose two snapshots differ is `unclean`. An ignored file is not
  part of a snapshot, and neither is a tracked file marked `skip-worktree` or `assume-unchanged`, so
  a change to either is not observed.
- **Verdicts.** There are nine, at two levels, listed here in precedence order. Four are decided about
  a **declaration**: `invalid`, `expired`, `missing` and `ambiguous`. Each is decided before any case
  is observed and stops that declaration's cases from running. There is one exception: the trust
  anchor's second comparison, made after the last case, can still find `oracle-changed`, which makes
  every declaration `invalid` and means that no case's result counts. Five are decided about a
  **case**, which runs only when its declaration was not stopped: `error`, `unclean`, `unstable`,
  `mismatch` and `match`. Each case that is run ends in exactly one of the five.
  - `invalid` — the declaration does not load or cannot be trusted: an unknown key, a missing `review`
    or `expires`, a `name` that is not its file stem, a `reference.ref` that is not a full commit sha
    or a tag name, a `stability.runs` outside 2 to 10, a `run` or `setup` command, or a `run`
    composed with a case's arguments, that vetting refuses, a surface that lists no case, an output
    path or overlay destination that is absolute, has a `..` component or lies under `.git` or
    `.forge`, a declared `file` output tracked in git, a capture whose file name is not the sha256
    of its bytes, an `unobservable` entry that names no surface of the declaration, an oracle that
    changed since its trust anchor (`oracle-changed`), or a declaration that compares nothing
    (`nothing-compared`: it has no surface that is not exempt).
  - `expired` — the declaration's `expires` date, or an `unobservable` entry's expiry, has been
    reached (a date is read as UTC and expires at its start).
  - `missing` — no capture is selected for the declaration, or the one selected holds no entry for a
    case that is compared (see capture selection).
  - `ambiguous` — two or more differing captures share one selection key.
  - `error` — the harness could not complete the case: a timeout, an output over its cap, a probe that
    printed no well-formed object, a rule that cannot be applied (a `replace` over its time limit
    included), an output path that passes through a symlink, an overlay destination that already
    exists, a snapshot that cannot be taken, a loopback port that is not free.
  - `unclean` — observing changed the candidate's tree, or a case wrote outside its declared outputs.
  - `unstable` — the candidate (at check) or the reference (at capture) disagrees with itself across
    repeated runs.
  - `mismatch` — the candidate's normalised observation differs from the capture's.
  - `match` — the candidate's normalised observation equals the capture's, in full.

  **Precedence is total**: `invalid`, `expired`, `missing`, `ambiguous`, `error`, `unclean`, `unstable`,
  `mismatch`, `match`, and the first that applies is the one reported. The same order picks a
  declaration's verdict from its cases' verdicts and a record's overall verdict from its declarations'.

  **Counting.** The unit is the case. `passing` counts the cases that are `match`, in declarations
  that were not stopped at declaration level. `failing` counts the cases that are not `match`, plus
  one for each declaration that was stopped at declaration level, however many cases it declares. A
  case on an exempt surface is not run and has no verdict: the exempt count is separate (below),
  counts surfaces, is never failing and is never counted as compared. A check with no declaration at
  all counts one failing and no passing, and its overall verdict is `invalid` with the `reason`
  `no-declarations`. A declaration that was not stopped has a surface that is not exempt, and every
  surface lists a case, so it runs at least one case: `failing` is 0 only when `passing` is at least
  1, and a check that compared nothing cannot pass. A check that would still print 0 passing and 0
  failing is a refusal instead, as is a `--name` that matches no declaration, which names the
  declarations that exist.
- **`unobservable`** declares, by a human, that a surface genuinely cannot be observed, and names that
  surface. Each entry carries a reason, an owner and an expiry — the shape of an F-TEST-8 exemption.
  The surface's cases are not run and have no verdict: it counts in its own exempt bucket, once per
  surface, and never as a match. An entry excuses one surface, never a whole declaration (one whose
  every surface is excused compares nothing: `nothing-compared`), and an expired entry fails
  (`expired`).
- **Capture selection.** A capture is selected by the key
  `(name, declaration digest, reference sha, platform)`, the reference sha being the one
  `reference.ref` resolves to when the check runs. None selected is `missing` — which is what a
  capture taken under an older digest, at another reference sha (a tag that has since moved or been
  deleted, for one) or on another platform reads as: it is never silently compared. Two or more
  differing captures under one key is `ambiguous`. A selected capture that holds no entry for one of
  the declaration's cases on a surface that is not exempt (an `unobservable` entry removed since the
  capture was taken) also reads `missing`, never a partial comparison.
- **`platform`** is the operating system and CPU architecture as the harness's own runtime reports
  them, `<os>-<arch>` (for example `darwin-arm64` or `linux-x64`); it is not the agent platform of `07`.
  Tool and interpreter versions are recorded in the evidence but are not in the key, and **a capture
  does not pin interpreter versions**: a reference captured under one runtime and a candidate checked
  under another are compared as they are, and a difference the interpreter causes reads as a `mismatch`
  for a person to resolve. A capture on a second platform is a second human act.
- **What the check prints.** `forge parity check --json` prints one `{"v":1,...}` envelope (`03` §3.5)
  with numeric `failing` and `passing` counts, which is what the `G-Parity` check's
  `failOn: "failing > 0"` reads under `parser: forge-json` (`10` §10.3's check contract); the overall
  verdict; the check's own `reason` where the check itself stopped (`no-declarations`, or
  `oracle-changed` naming each differing path); the evidence id (null when nothing was recorded,
  below); and a `declarations` list, in order of `name`, whose entries each give a declaration's
  `name`, `verdict`, `reason` (a short stated reason wherever the verdict is not `match`), `passing`
  and `failing`. A check with no declaration has no entry to carry its reason, which is why the
  envelope does. `failing` is 0 only when `passing` is at least 1 (Counting, above), so a check that
  compared nothing cannot pass. A refusal envelope (`ok: false`) fails the gate; a `--name` that
  matches no declaration and a `--trusted` that is not in the accepted form or does not resolve each
  get one.
- **Evidence.** One `forge parity check` invocation writes one `ParityEvidence` record (`18` §18.7),
  however many declarations it checks, unless it is given `--no-record`. The record's body carries a
  `declarations` list (for each: the name, the declaration digest, the reference's ref and sha, the
  platform, the digest of the capture it selected, its verdict and, where that is not `match`, its
  `reason`, the verdict and content hashes of each case, and the exempt count), the check's own
  `reason` where the check itself stopped, and `trusted`, the trust anchor's sha or null. It holds
  verdicts and content hashes, never the observed content. `--story <id>` names the story the check
  ran for: it is the record's `story` and its retention subject, which without it is the single shared
  subject `project` (`18` §18.7, Retention). `EvidenceBundle.parityEvidence` is where a bundle lists
  the ids of these records; M16 changes no bundle assembler, so nothing populates it yet (`18`
  §18.7). The `G-Parity` gate (`10` §10.3 rule 8) runs `forge parity check` as its one deterministic
  check, `behavior:parity`, and passes `--no-record`, because it evaluates in the integration
  worktree, where a file written by a check leaves the worktree dirty and the next run refuses to
  start (`VCS-INTEGRATION-DIRTY`). An evaluation inside a run therefore leaves its trail in the run's
  event log (`18` §18.4), not in a `ParityEvidence` record: the `GateEvaluated` event carries each
  check's verdict and output digests, and where the run's id reaches the command in `FORGE_RUN_ID`
  and the command can name the run's own project root (a gate check runs in the integration
  worktree, which is not that root), the check adds a `CheckRun` event of kind `'parity'`.
- **The honest boundary.** A green parity check says the **declared surfaces** matched the reference
  on the **declared cases** after the **declared normalisation** — never that behaviour is preserved.
  Everything undeclared is unobserved, and the evidence says so. Over-normalising can hide a real
  difference, which is why the rules sit in a digest-bound, human-reviewed declaration and none may
  erase everything. The candidate is observed in place, so the code under test can read
  `.forge/parity/`, a capture's stored observation included: a change that reads its own expected
  output is a code change this check cannot tell from a faithful one, and review is what catches it.
  Vetting judges a command's text against the engine's closed lists and, for a glob or a symlink,
  the project's tree as it is when the declaration loads. That judgement covers neither the
  reference's scratch tree, which a ref fills, nor what the program the command names does when it
  runs, nor a program that is on none of the lists, so a `run` or `setup` that names a script does
  whatever that script does, a fetch included, and a `setup` that runs a program the lists do not
  know can install dependencies: review of the declaration is what covers both.
  Timing, memory and concurrency ordering are not compared, a change of installed
  dependency is not seen where both sides run against one installed copy, the candidate's own build is
  not checked (FORGE builds nothing for it, so a stale build can read as `match`), and a reference
  that is not held at a ref in the project's own history is outside this definition.

### F-TEST-10 · Hunk-level behavioural binding (post-v1.0, `specs/22` M16)

F-TEST-5's behavioural binding reverts a story's whole implementation change at once: it shows that the
story's tests bind to *something* in the change, not that every part of the change is exercised.
Hunk-level binding is the same mutation at a finer grain — reverse one hunk at a time and ask whether a
test that passed at baseline now fails. It is opt-in, bounded, and report-only.

- **A hunk** is a unit of *text* change between an explicit base and the head, over the change's
  implementation paths only; test files are never mutated. It is not a semantic unit: a comment-only
  or formatting-only hunk is still a hunk. Hunk boundaries are an artefact of the diff algorithm, so
  the algorithm is pinned and recorded in the evidence. An added or deleted file, a binary file, a
  mode-only change and any other non-text change is not split into hunks: it is ONE file mutant, a
  revert of that file as a whole, whose verdict comes from the same revert-and-run procedure as the
  change-level mutant for that file and which takes the change-level load-failure credit (File-load
  failures, below). A hunk that cannot be reversed against the head is recorded `invalid`, never
  dropped.
- **Requirements on a hunk id.** An id is stable for one base/head pair: two parses of the same pair
  give the same ids. Ids are distinct for textually identical hunks in one file. The format is not
  fixed here; the piece that builds the parser (`specs/22` M16 P11) fixes it under these two
  requirements.
- **`--base <ref>`** is the explicit base for hunk mode: `--hunks` without it is a usage error, and so
  is `--base` without `--hunks`. It governs the whole run, the change-level portion included, so the two
  halves of one `--json` envelope describe one range. Without `--hunks` the range is as M15 shipped it.
- **Verdicts.** Each hunk ends in exactly one of five:
  - `killed` — reversing it made a test that passed at baseline fail with an assertion failure or a
    crash; the test is named in `killedBy`.
  - `uncovered` — every baseline-passing test still passes with it reversed.
  - `invalid` — the reversal did not apply cleanly, or every failure it caused is a failure to load:
    a stillborn mutant proves nothing about an assertion.
  - `timeout` — the run exceeded its time limit with no killing failure.
  - `skipped` — the run could not proceed (a failing baseline, for one); the reason is recorded.
- **`granularity`.** The `granularity` a run reports says how it mutated the text changes: one mutant
  per hunk (`hunk`), one per file (`file`) or one for the whole change (`change`). A file that is not
  split into hunks is a file mutant at `hunk` and at `file`; at `change` everything is the one mutant.
  Above `--max-hunks` the mode degrades hunk → file → change and reports the `granularity` it actually
  used. It never samples: a sampled result would read as a verdict on hunks that were never run. The
  default for `--max-hunks` is not fixed here: `specs/22` M16 P12 chooses it and states it.
- **Report-only.** Hunk verdicts never change the exit code, which follows the change-level result over
  the same `--base` range, by the rule it follows without `--hunks`; the `--json` additions are optional
  fields and every M15 field is unchanged. No default gate threshold ships. A project that wants one
  authors a check over the `--json` envelope, under `10` §10.3's check contract, and takes on three
  costs: a comment-only or formatting-only hunk reads `uncovered`, there is no hunk exemption, and
  attribution is bounded by the story's own tests.
- **File-load failures** (the position `specs/22` M16 P10 is to confirm by real runs under both test
  runners, or amend). At change level a revert that makes a test file unloadable credits the
  baseline-passing tests of that file under both runners — a new module's tests cannot load without
  the module, and M15's shipped vitest behaviour already credits it. At hunk level a text hunk whose
  reversal makes a file unloadable is `invalid`, not `killed`. The rule follows the kind of mutant,
  whatever `granularity` the run reports: a hunk mutant is `invalid` for it, and a file mutant and the
  whole-change mutant take the change-level credit.
- **Cost.** N hunks cost N + 3 runs of the story's test command (baseline, revert, restore, and one per
  hunk), which is why the mode is opt-in and bounded.

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
