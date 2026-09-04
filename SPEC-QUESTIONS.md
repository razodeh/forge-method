# SPEC-QUESTIONS.md

Ambiguities and conflicts found in the spec pack, with the answer taken and the reasoning. Each entry
is proceeded-with as marked; none is a blocker unless it says so.

---

## Q1 — Coverage thresholds: `specs/21` §21.1 vs `BUILD-PROMPT.md` §0.3

**Conflict.** `specs/21` §21.1: 90% lines / 85% branches on `core`, `schemas`, `kb`, `engine`,
`extensions`, `vcs`; 80/70 elsewhere. `BUILD-PROMPT.md` step 0 item 3: "coverage ≥ 85% lines / 80%
branches on changed packages". The two disagree for non-critical packages, where the build prompt is
*stricter* (85/80 vs 80/70).

**Answer taken (proceeding):** per-package maximum of the two — 90/85 on the six critical packages,
85/80 everywhere else. This satisfies both documents simultaneously and never lowers a spec
threshold.

**Recommended resolution:** amend `specs/21` §21.1 to read 85/70→85/80 elsewhere so the two documents
agree.

---

## Q2 — `mcp` as a forbidden string above `adapter-kit`

**Ambiguity.** `CLAUDE.md` forbids the strings `claude`, `mcp`, `subagent` and model names outside
`packages/adapter-*`. But `specs/15` places the **MCP server registry, per-role grants, and grant
validation** inside `@forge/extensions` (`specs/02` §2.9, and M2's build list in `specs/22`), which is
above `adapter-kit`. Taken literally, M2 cannot be built.

**Answer taken (proceeding):** MCP is treated as a *protocol name the spec itself uses as a
first-class FORGE concept*, not a platform concept. `@forge/extensions` and `@forge/schemas` may name
it, because the registry describes servers and grants generically and contains no knowledge of any
platform. `claude`, `subagent`, and model identifiers remain forbidden above `adapter-kit` with no
exception. This is encoded as R4 in `QUALITY-BAR.md`.

**Recommended resolution:** confirm, and add the carve-out to `CLAUDE.md` so the lint rule and the
prose agree.

---

## Q3 — Where `ForgeError` lives, given `schemas` may have no forge dependencies

**Conflict.** `specs/02` §2.6: "All errors extend `ForgeError`". `specs/02` §2.2:
`schemas ← (no forge deps)`. `specs/22` M1 places the `ForgeError` taxonomy in `@forge/core`, and
`core ← schemas`. So `@forge/schemas` cannot throw a `ForgeError` without an upward import.

**Answer taken (proceeding):** `@forge/schemas` never throws. It exposes zod schemas and returns
typed validation *results* (`SafeParseReturnType`, and the `ValidationOutcome` shape in P12).
`@forge/core` is the only place a validation failure becomes a thrown `CFG-`/`SPEC-` `ForgeError`,
converting the zod issue path into the error's `details`. This satisfies both rules and keeps the
error taxonomy in one package, as M1 requires.

**Recommended resolution:** amend `specs/02` §2.6 to say "every error *surfaced to a caller outside
`@forge/schemas`* extends `ForgeError`", and note that `schemas` is result-returning by design.

---

## Q4 — `docsUrl` is required on `ForgeError` but no documentation site exists at M1

**Ambiguity.** `specs/02` §2.6 requires `docsUrl` on every error. No docs host is named anywhere in
the pack, and `specs/23` does not list it as an open decision.

**Answer taken (proceeding):** `docsUrl` is derived, not hand-written — a single
`DOCS_BASE_URL` constant in `packages/core/src/constants.ts` (per `specs/README` §1, which requires
names be centralised so a rename is a one-file change) plus the error code, giving
`<base>/errors/<code>`. At M1 the base is a placeholder constant with no network dependency; nothing
fetches it, so no test needs the network.

**Recommended resolution:** confirm the docs base URL before the first publish, or drop `docsUrl` in
favour of `forge explain <code>` reading a local catalogue.

---

## Q5 — `tools/` is not in the `specs/02` §2.2 monorepo layout

**Ambiguity.** `specs/02` §2.2 lists `packages/`, `modules/`, `fixtures/` and `docs/` and nothing
else. The dependency-boundary lint (`specs/22` M1, "the dependency-boundary lint") has to live
somewhere; it is a build-time eslint plugin, not a runtime `@forge/*` package, and putting it under
`packages/` would place it in the dependency graph it exists to police.

**Answer taken (proceeding):** add a `tools/` workspace root for build-time-only packages that are
never published and never imported by runtime code. It is included in `pnpm-workspace.yaml`, in the
vitest include globs and in the coverage globs. `PACKAGE_GRAPH` (P2) will not contain it, so a
runtime package importing from `tools/` is a boundary error.

**Recommended resolution:** add `tools/` to the `specs/02` §2.2 layout with that one-line
restriction.

---

## Q6 — `specs/21` §21.1 names an "undici/fetch interceptor", which does not cover the whole surface

**Divergence, recorded because the implementation is broader than the spec text.** §21.1 says network
denial is implemented "by an undici/fetch interceptor". A `fetch`-only interceptor was built first
and verified to be ineffective: a probe using `node:http` completed a real request to a public host
while the suite reported green. `node:net`, `node:tls`, `node:http2` and `WebSocket` are equally
unguarded by it.

**Answer taken (proceeding):** the guard patches `net.Socket.prototype.connect` — the chokepoint all
of those funnel through — plus `dgram` for UDP, and keeps the `fetch` patch only for its clearer
error message. Loopback and unix sockets are permitted, since §21.1's stated target is the
*accidental external dependency*. A child process is out of reach of any in-process guard; git is
separately denied every credential source so it fails fast instead of hanging.

**Recommended resolution:** amend §21.1 to say "a socket-level interceptor" rather than naming
undici, since naming the narrower mechanism invites exactly the ineffective implementation.

---

## Q7 — Amendments made to `PLAN-M1.md` P1 during P1's own review

Recorded here because `QUALITY-BAR.md` §3 treats weakening a check to get past it as a review failure
in itself. Both edits are visible in `git diff PLAN-M1.md`; neither removes work from the milestone.

**Q7a — P1's floor is four commands, not five.** P1's Checks said "All five floor commands exit 0",
including `pnpm boundaries`. The boundary rule is P2's mandate. Adding a `boundaries` script that
exits 0 without checking anything would be exactly the stub R7 forbids, so the command is introduced
in P2 together with its implementation and its CI step. The work is moved, not dropped.

**Q7b — the coverage ratchet moved from P1 to P3.** `specs/13` F-TEST-5 requires ratchet-only
thresholds. With no package in the workspace there is nothing to ratchet and the script would have no
input and no test. `vitest.config.ts` no longer claims the guarantee; P3's Checks now own
`scripts/check-coverage-ratchet.mjs`.

**Recommended resolution:** confirm both. If either should have stayed in P1, say so and it comes
back.

---

## Q8 — `vitest.workspace.ts` (planned) vs a single root `vitest.config.ts` (built)

**Divergence from `PLAN-M1.md` P1's stated Surface.** The plan named `vitest.workspace.ts`.

**Answer taken (proceeding):** one root `vitest.config.ts` with no `projects` array. Every guarantee
the suite rests on — the setup file, the coverage thresholds, the fork pool the network guard depends
on — lives in one file, and a package shipping its own config would inherit none of them.
`test/workspace-floor.test.ts` asserts no package has one. The cost is that per-package `include`
globs are impossible, so collection patterns must be maintained centrally; a test asserts every test
file on disk is matched by one of them, which is the property that actually matters.

**Recommended resolution:** confirm; update P1's Surface line in `PLAN-M1.md` if so.

---

## Q9 — The Node floor: `>= 20.10` runtime vs `>= 20.19` for the dev toolchain

**Conflict discovered by execution.** `specs/02` §2.1 sets Node `>= 20.10` and "tested on 20/22/24".
On a real Node 20.10.0 the dev toolchain cannot run at all: `@changesets/cli@3` requires
`^22.11`, `vitest@4`'s `rolldown` dependency imports `node:util`'s `styleText` (added in 20.12), and
`import.meta.dirname` (used by the eslint config) arrived in 20.11.

**Answer taken (proceeding):** two distinct floors. The **runtime** floor for published packages
stays `>= 20.10` as the spec requires. The **dev toolchain** floor is `>= 20.19` — the current Node 20
release, so "tested on 20" still holds — declared in the private root `package.json`, with
`@changesets/cli` pinned to `2.31.1`, which supports it. CI runs the floor on the latest 20, 22 and
24 rather than on 20.10.0 exactly.

This leaves the published artifact's `>= 20.10` claim unverified until there is an artifact to verify.
`PLAN-M1.md` records the obligation against the first piece that publishes one.

**Recommended resolution:** state the two floors separately in `specs/02` §2.1, or raise the runtime
floor to `>= 20.19` and drop the distinction.

---

## Q10 — Ambient locale cannot be pinned on Windows, so it is forbidden instead

**Divergence, recorded because the mechanism differs from what a reader would assume.**
`specs/21` §21.1 requires determinism and names a fixed timezone. Locale is the same class of hazard —
`Intl.Collator`, `toLocaleString` and every locale-sensitive sort vary by host — but it cannot be
pinned the same way. ICU resolves the default locale at process start, so assigning `LC_ALL` from a
setup file is a no-op; and on Windows ICU reads `GetUserDefaultLocaleName` and ignores `LC_ALL`/`LANG`
entirely, so even setting them before launch does nothing there.

An earlier version asserted `Intl.DateTimeFormat().resolvedOptions().locale` in `test/setup.ts`. That
assertion passed on the CI Windows legs only because the runner happens to be en-US, and would have
thrown on every test file for a contributor on a non-English Windows machine, with a message blaming
the launcher for something it never controlled.

**Answer taken (proceeding):** the guarantee is *no dependence on ambient locale*, not *a pinned
locale*. `eslint.config.js` makes `localeCompare`, `toLocale*String` and argument-less `Intl.*`
errors in production code, and `test/lint-rules.test.ts` proves each of those rules fires.
`scripts/run-tests.mjs` still sets `LC_ALL`/`LANG` as belt-and-braces for POSIX test code, but nothing
asserts them, because on one supported platform they mean nothing.

**Recommended resolution:** add a sentence to §21.1 distinguishing the two — timezone is pinned,
locale is forbidden — so the next implementer does not try to pin it and ship an assertion that
passes by luck.

---

## Q11 — Q6 superseded: child processes are covered, and the original rationale was wrong

**Correction to a previously recorded divergence.** Q6 declared child processes out of scope on the
rationale that "a child process is out of reach of any in-process guard". Executed, that rationale is
false: the child *already loads the guard*, because `scripts/run-tests.mjs` puts `--import` into
`NODE_OPTIONS` and Node applies it to spawned processes. The guard did nothing there only because it
was gated on `worker_threads.isMainThread`, which is `true` inside a child process. A spawned
`node -e` completed a real HTTP 200 while the suite reported green.

**Answer taken (proceeding):** the gate is removed; the guard self-installs in whichever realm loads
it. Child processes are now a covered channel with a test, alongside worker threads (default,
explicit `execArgv`, and nested). `git` remains separately denied every credential source, which is
now defence in depth rather than the only control.

Nothing in the guard's threat model is currently declared out of reach. If a channel is found that
genuinely cannot be covered, it belongs here — with a rationale that has been executed, not assumed.

---

## Q12 — One case the guard cannot cover: a non-Node binary

*Rewritten after review. The earlier version of this entry declared three cases out of reach on a
rationale that execution disproved — two of them are now covered. The false rationale is recorded
below rather than deleted, because a declared divergence that turns out to be wrong is worse than an
undeclared one, and the log of how it was wrong is the useful part.*

**Out of reach:** a non-Node binary. `execFileSync('curl', [...])` reached a public host and returned
200 from inside a passing suite. No in-process mechanism can guard a foreign executable; the control
for that is capability restriction at the process boundary (`specs/20` §20.1), which
`BLOCKED-P1b.md` §4 records as option B for the piece that adds CI infrastructure.

**Now covered, previously declared out of reach:**

- *A worker or child spawned with an explicit `env`.* `{ env: { PATH } }` replaces the environment
  the guard rides in on. The parent owns that options object, so the guard rewrites it — see
  `withGuardOption` in `test/network-guard.mjs`. Both have tests.

**Why the earlier rationale was wrong.** It said "it is the env replacement, not the patching
technique, that keeps these cases out of reach". Two separate failures had been conflated. The first
attempt patched `node:child_process` *after* its ESM facade existed, so a named import
(`import { execFileSync } from 'node:child_process'`) read a snapshot and never saw the patch; and it
replaced `exec` without carrying over the symbol-keyed property `util.promisify` reads, which hung
vitest before a test ran. Both are fixed here — the first by reaching the module through
`process.getBuiltinModule`, the second by `replaceMethod` copying symbol-keyed own properties — and
with them fixed, the `env` cases close.

**Completeness of the covered list.** `test/network-guard.test.ts` asserts that every resolver-
addressing function on `dns`, `dns.promises` and `Resolver.prototype` is patched, rather than
trusting the hand-written list — the same discipline `eslint.config.js` applies to Node's builtin
module names, and for the same reason: a hand-typed list already omitted `net`/`tls`/`dns`/`http2`
once in this repo. `process.binding` is also closed.

**Recommended resolution:** none needed; recorded so the reasoning survives.

---

## Q13 — A test was changed, not to make code pass, but because the test was wrong

Recorded because `BUILD-PROMPT.md` and `CLAUDE.md` both make editing a test to get past a failure a
review failure in itself. **Please reverse this if you disagree.**

**The test:** `denies an options object with no host, rather than defaulting it to localhost` in
`test/network-guard.test.ts`, asserting that `net.connect({ port: 80 })` is denied.

**Why it was wrong:** Node documents the default host for `connect({ port })` — and for
`connect(port)` — as `localhost`. An absent host is therefore a *modelled* shape with a known
destination, not an unknown one. The allow-list permits loopback, so the correct behaviour is to
permit it. Denying it was a false denial that would have hit every integration test written as
`net.connect(server.address().port)` from P2 onward, with an error naming `<undefined>`.

I wrote that test in the round that introduced the fail-closed allow-list, on the belief that any
absent field was an unmodelled shape. Review found the false denial; the belief, not the code, was
the defect.

**What replaced it:** a test that a host which is *present but not a string* is denied — the case
that is genuinely unmodelled — plus a positive test that `net.connect(port)` reaches a loopback
server the test started. The fail-closed property is still asserted; only the incorrect instance of
it was removed.

---

## Q14 — Residual risk accepted in the test network guard, and where the real control belongs

**Decision, not a question.** Recorded so nobody later mistakes the guard for something it is not.

`specs/21` §21.1's stated purpose is catching *accidental* network dependencies — "the main cause of
test suites that work on the author's machine". The guard meets that: every ordinary spelling on
every channel it declares is denied, each with a test, across every realm a test can create.

It is **not** proof against a contributor deliberately working around it. It is an in-process
monkey-patch, and a determined author can defeat one — by hand-crafting `NODE_OPTIONS`, by spawning a
non-Node binary, or by reaching a binding that has not been thought of. Ten adversarial review rounds
found progressively narrower instances of exactly that, and the last few required constructing values
no contributor writes by accident.

**Accepted:** the guard's contract is *accidental* denial, and that is what `PLAN-M1.md` P1b claims.
Deliberate circumvention is a review matter, not a runtime one.

**Where the real control belongs:** `specs/20` §20.1 already establishes capability restriction at
the process boundary as FORGE's model — "capability restriction, not injection detection, is the
control". The airtight version of this guarantee is the same idea applied to the suite: run it in CI
with no network egress. `BLOCKED-P1b.md` §4 option B records the design. It is deliberately not
scheduled: it buys defence against a hostile committer, which is not the threat `specs/21` §21.1
names, and it costs CI infrastructure no milestone budgets.

**Revisit trigger:** the first time a test reaches the network in CI despite the guard.

---

## Q15 — `USR-001` and a SIGINT share exit code 130

**Ambiguity in a normative table.** `specs/02` §2.6 lists `130 interrupted` and gives `USR-001 gate
rejected by operator` as the `USR-` example. Taken together, a deliberate human rejection at a gate
and a process killed by SIGINT exit with the same status, so CI cannot tell "someone said no" from
"the job was cancelled" — and §2.4 makes SIGINT a *graceful pause* that leaves the run resumable,
while a gate rejection is a decision that should not be retried unchanged.

**Answer taken (proceeding):** implement 130 as the spec states. Diverging here would be exactly the
quiet improvement `CLAUDE.md` forbids, and the two are at least both "a human stopped this", which is
what an exit code coarsely conveys.

**Recommended resolution:** give operator rejection its own code — 7 is free — or state in §2.6 that
130 deliberately covers both and that callers must read the event log to distinguish them. This wants
deciding before `specs/14`'s CI templates start branching on exit status.

---

## Q16 — Two gaps in `specs/02` §2.2's table, and how `no-platform-concept` avoids a third

*Written after review found three source comments citing this entry before it existed — the
citations were added when the reasoning was decided, the entry itself was not. Recorded now with
the content those comments always meant to point at.*

**Gap 1 — `templates` and `testkit` have no row in the §2.2 dependency table.** `templates` is
described in the §2.2 layout tree as bundled data (templates, workflows, checklists), not logic, so
it is given no forge dependencies at all — `PACKAGE_GRAPH.templates: []`. `testkit` is required by
`specs/22` M4 to implement `FakePlatformAdapter`, which needs `adapter-kit`'s interface, so it is
given `['adapter-kit', 'schemas']`. Both are proceeding-with defaults per `CLAUDE.md`'s rule for
spec silence, asserted directly in `tools/eslint-plugin-forge-boundaries/test/boundaries.test.ts`
rather than left as an unchecked assumption.

**Gap 2 (a design note, not a spec gap) — how `platform.claudeCode`-shaped config avoids becoming a
banned platform concept.** `specs/18` §18.3's canonical config shows a `platform.claudeCode` block
with adapter-specific fields (`transport`, `bare`, `minimumVersion`). Read literally, `@forge/schemas`
— which sits below `adapter-kit` in the §2.2 graph — would need to hardcode a Claude-specific key,
directly contradicting `specs/README` §2 principle 8 ("no platform-specific concept may leak past
@forge/adapter-kit"). The resolution: `platform.primary` and any per-adapter config block are typed
generically (`z.string()` for the id, a passthrough record for adapter-specific fields) in the
schema — never a closed enum naming `'claude-code'` — with each adapter package responsible for its
own config sub-schema, registered at the `adapter-kit` boundary rather than baked into `@forge/schemas`.
This is what `no-platform-concept` (`specs/README` §2 principle 8) leans on: platform and model
identifiers are meant to be opaque values below `adapter-kit`, never literals or enum members in
behavioural code, so the rule does not need a carve-out for them the way `mcp` needed one (Q2) — a
literal genuinely should not appear there. Binding for `@forge/schemas`, built in a later piece
(`PLAN-M1.md` P8); recorded now so that piece does not hardcode the field.

**Recommended resolution:** none needed for gap 1. For the design note, confirm before P8 builds the
config schema.

---

## Q17 — Coverage-v8 under-reports a widely-shared module's coverage, non-deterministically, at full-suite scale

**Not a spec question — a build-tooling limitation, recorded here because it produces a declared
divergence from `QUALITY-BAR.md` §3's coverage floor and that divergence must not pass silently.**

`tools/eslint-plugin-forge-boundaries/src/{graph,locate}.mjs` are imported by every rule module in
the plugin; the rule modules are each imported by exactly one test file. Both classes of file report
well below the 85/80 per-file threshold when the *full* test suite runs, despite being thoroughly
tested.

**Evidence, in order of what was tried:**

1. Every plugin source file, run via its own dedicated test file with nothing else in the suite:
   85–100% lines/branches/functions, repeatedly, across several isolated runs.
2. The same six test files, run together as `tools/` only (no other package's tests in the run):
   92–100%. Still clean.
3. The full suite (12 files, 300+ tests, everything in the repo): 60–75%. The shortfall appears only
   once files outside `tools/` join the run — not a property of the plugin's own tests.
4. Ruled out as the cause, each independently verified not to reproduce the shortfall in isolation:
   the `NODE_OPTIONS` network-guard injection; `RuleTester`'s internal `describe`/`it` flattening;
   `RuleTester`/`Linter`'s own CJS dependencies (espree); running serially via `--fileParallelism`;
   `test.isolate: false` (this made it *worse*, disproving a per-file module-reset theory); a fan-in
   of six files sharing one module in a minimal synthetic repo (stayed at 100%).
5. **Non-determinism, conclusively:** two full-suite runs with byte-identical configuration and code
   produced different coverage numbers for the same files (one run: `no-deep-package-import.mjs`
   72.72% lines; the next, unchanged, run: 45.45%). A deterministic algorithmic merge defect would
   reproduce identically; this does not. It is a race in coverage collection under this many
   concurrent forks with this vitest/coverage-v8 version (4.1.11), not a gap in what is tested.
6. Consolidating the plugin's five per-module test files into one (`boundaries.test.ts`) measurably
   improved but did not eliminate the shortfall — kept as the test organisation regardless, since it
   is a reasonable structure on its own merits and reduces the effect's severity.

**Answer taken (proceeding):** a glob-keyed threshold override was tried first
(`'tools/eslint-plugin-forge-boundaries/src/**': { lines: 0, ... }`) and does not work: vitest's
coverage-v8 provider applies the *global* threshold to every file regardless of whether a narrower
group also matches it — groups only add a stricter, additional check, never a replacement (see
`resolveThresholds` in `@vitest/coverage-v8`'s `provider.js`: "Global threshold is for all files,
even if they are included by glob patterns"). There is no config-level way to give one glob a
*lower* bar than the global one.

`vitest.config.ts`'s `coverage.exclude` therefore carries the glob instead, with the same evidence
inline as a comment. This also had to cover `scripts/check-coverage-ratchet.mjs`'s own per-package
comparison, which reads the same `coverage-summary.json` and would otherwise flag the identical
files as regressing against their own prior high-water mark on an unlucky run. This is categorically
different from lowering a threshold on undertested code: the code is tested, verified repeatedly
above 85/80 in isolation; only the automated *measurement* is unreliable at full-suite scale, and
excluding it from that measurement is the only mechanism vitest offers for saying so.

**The exclusion alone was an incomplete answer, corrected during review.** Excluding the glob from
the *full-suite* run's coverage removed the flake, but it also removed *all* coverage enforcement
for this plugin going forward — including for code the flake never touched. Verified: a planted,
untested, unreachable-branch function added to `locate.mjs` passed `pnpm lint`, `pnpm typecheck` and
the full `pnpm test` without a single warning. That is a real gap this piece introduced while fixing
a different one.

The fix is `vitest.boundaries-coverage.config.ts`: a second, narrowly-scoped vitest config, run
against only this plugin's own six test files with real 85/80 thresholds and no exclusion — the
exact scope this investigation proved trustworthy (92–100% coverage, repeatably, whenever these
files ran without the rest of the suite's hundreds of tests competing for forks). `pnpm test` now
runs it as a required third step (`pnpm coverage:boundaries`), and it was verified both ways: the
planted dead function above fails it (`functions 66.66%`, `statements 83.33%`, exit 1), and the
clean tree passes it (100%/98.57%/100%/100%).

**Recommended resolution:** vitest 5.0.0 is published; revisit the full-suite exclusion when the
toolchain next moves to it (a separate piece — it is a major-version bump across `vitest`,
`@vitest/coverage-v8` and possibly `@vitest/*` peers, not a P2-scoped change). If the same shortfall
reproduces there, file it upstream with the reproduction steps above. The isolated compensating
config can retire at the same time, once the full-suite run is trustworthy again for this plugin.
