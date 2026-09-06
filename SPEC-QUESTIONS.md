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

---

## Q18 — `18` §18.6's per-type `requiredSections` has no source of values for the §18.7 registry types

`18` §18.6 says validation is two-phase: front matter against the type's JSON Schema, "then body
structure against required sections declared by the type (`requiredSections: [Statement, Rationale,
…]`)." `PLAN-M1.md` P5 accordingly names `requiredSections: readonly string[]` as a field on
`ArtifactTypeDefinition`.

Nothing in the spec pack supplies the actual list for any of the §18.7 registry's 21 types. §18.7's
own table (the "canonical" source this piece transcribes verbatim) has no `requiredSections` column
at all. §9.3 ("essentials") shows only front-matter YAML for six of the 21 types (Vision, Capability,
NFR, Epic, Story, Task) — no body markdown, no section headings. The one concrete example of the
pattern, `08` §8.3's `## Statement` / `## Rationale` / `## Implications` / `## Verification`, is for
a knowledge-base entry (`type: knowledge`), which is not one of the §18.7 registry's 21 types at all
— KB entries use a distinct `KB-<AREA>-####` id shape (`KB-PROD-0001`, seen in the Vision example at
§9.3), not the registry's `^[A-Z]+-\d{3,4}(-\d+)?$` pattern, and are `PLAN-M1.md` P7's schemas, not
P5's. `PLAN-M1.md` P6 and P7, which define the eight spec-side and remaining artifact types' detailed
field schemas, also do not mention `requiredSections` anywhere in their Checks.

**Recommended resolution:** keep the field on `ArtifactTypeDefinition` (the surface `PLAN-M1.md`
documents, and body-structure validation is a real, named `18` §18.6 mechanism that some later piece
will need it for), but set every type's value to `[]` in this piece rather than invent section names
with no spec source. Populate real values type-by-type only when each type's detailed schema is
authored and a spec section actually states its required sections — not before. Proceeding with `[]`
for M1; revisit if a later milestone's spec pages (`18` §18.6's mechanism is exercised by `forge kb
lint`, not named again after §18) supply the missing lists.

---

## Q19 — Story's own `type` field collides with the base front matter's `type` discriminator

**Conflict, not just a gap.** `18` §18.6 requires `type` in every artifact's front matter as the
artifact-type discriminator (`type: Story`, matched against the `specs/18` §18.7 registry). `09`
§9.3's Story example front matter separately lists its own field, also named `type`, with a
completely different value set: `type: feature # feature | tech | spike | bug | chore | migration`.

Front matter is one flat YAML mapping per `18` §18.6 ("every artifact file carries this base,
extended per type") — it cannot contain two keys both named `type` with different meanings. The
spec's own worked example is self-contradictory as written: a real `STORY-014` document following
both §18.6 and §9.3 literally cannot exist.

**Answer taken (proceeding):** rename Story's own classification field to `storyType` in the
implementation, preserving its meaning and the six values verbatim. `kind` was considered and
rejected — it is already used for two other, unrelated concepts one level down in the same document
(`acceptance[].kind`: functional/error-handling/nfr, and, on `NFR`, `verification.kind`:
test/benchmark/monitor/review/audit), and reusing it a third time for a third meaning in the same
artifact family adds ambiguity precisely where `18` §18.6's two-phase validation already asks a
reader to hold two different vocabularies apart.

**Recommended resolution:** rename the field in `09` §9.3's Story example to `storyType` (or another
name distinct from the base `type`) to match; the six enum values need no change.

---

## Q20 — Task, InterfaceContract and DataModel have no field-level schema anywhere in the spec pack

`PLAN-M1.md` P6 names `taskSchema`, `interfaceContractSchema` and `dataModelSchema` among its eight
required per-type schemas, citing `09` §9.6 for the latter two. Unlike Vision, Capability, NFR, Epic
and Story — each given a complete worked YAML example in `09` §9.3 — these three have no example and
no field list anywhere in the spec pack:

- **Task** (`09` §9.3, end): one paragraph of prose ("optional decomposition inside a story... agent-
  executable unit of work... generated by the workflow, not usually hand-authored"), no fields.
- **InterfaceContract** and **DataModel** (`09` §9.6): a purpose/producer table entry each, plus a
  path convention and codegen expectation — no fields. Two other spec files (`05` §5's KB-index
  layout, `10`'s workflow examples) reference these types only as opaque schema-file names
  (`interface-contract.schema.json`, never defined) or as gate `evidence` entries, never as field
  lists.

**Answer taken (proceeding):** for these three types only, the per-type schema is the base front
matter shape (`baseFrontMatterShape`, `18` §18.6) narrowed just to `type: z.literal('<Type>')` and
re-checked with `checkIdMatchesRegisteredType` — no invented business fields. This is the same
discipline Q18 already applied to `requiredSections`: implement exactly what the spec states, and
name the gap rather than filling it with plausible-looking invented content that later needs undoing.

**Recommended resolution:** author a worked example for each of the three, matching `09` §9.3's
existing style for the other five, before a schema richer than "base front matter, correctly typed"
is expected of them.

---

## Q21 — NFR ids are 4 digits everywhere they're used, but `18` §18.7's registry gives NFR no
`idWidth` override (defaulting it to 3)

**Conflict.** `18` §18.7's registry table declares `idWidth` only for ADR (`4`); every other type,
NFR included, gets the stated default of 3. But every single NFR id that appears anywhere else in
the spec pack is 4 digits, with zero 3-digit counterexamples: `09` §9.3's own worked NFR example
(`id: NFR-0002`), the same id referenced three more times in that section (`nfrs: [NFR-0002,
NFR-0007]`, `context_refs: [..., NFR-0002]`, `nfr: NFR-0002`), and `09` §9.4's traceability example
(`NFR coverage: 7/9 verified · 2 unproven (NFR-0005, NFR-0009)`). This piece's `nfrSchema` inherited
the registry's 3-digit default via `checkIdMatchesRegisteredType`, and its own valid fixture —
transcribed directly from `09` §9.3's example — failed against it, which is what surfaced this.

**Answer taken (proceeding):** treat this as `18` §18.7 having omitted NFR from the same
`idWidth: 4` annotation ADR already carries, rather than every other spec page being wrong five
times over. Updated `PLAN-M1.md` P5's already-committed registry (`ARTIFACT_TYPES` in
`packages/schemas/src/registry/artifact-types.ts`, plus its independent test transcription) to give
NFR `idWidth: 4`, matching actual usage.

**Recommended resolution:** add `idWidth: 4` to NFR's row in `18` §18.7's table, next to ADR's.

---

## Q22 — SessionRecord's own `type` field collides with the base front matter's `type` discriminator (same defect as Q19, a second type)

**Conflict, same shape as Q19.** `16` §16.5's own worked SessionRecord example uses `type: brainstorm`
for the session's technique category (one of the ten `16` §16.2 session types: brainstorm,
design-review, tradeoff, premortem, retro, war-room, estimation, standup, discovery-interview,
story-refinement) — colliding with the base front matter's `type: SessionRecord` discriminator
(`18` §18.6), exactly as Story's own `type: feature` did.

**Answer taken (proceeding):** renamed to `sessionType` in `sessionRecordSchema`, using the same
reasoning Q19 already recorded (and the same replacement name pattern: `<Type>Type`) — enumerated
from `16` §16.2's closed, ten-row table verbatim.

**Recommended resolution:** rename the field in `16` §16.5's example to `sessionType` (or another name
distinct from the base `type`), matching Q19's recommendation for Story.

---

## Q23 — Six collection-entry types and GateReport have only partial or no field-level spec

`PLAN-M1.md` P7 names schemas for all thirteen remaining registry types. Unlike ADR (`08` §8.4),
Diagram (`08` §8.11.5), SessionRecord (`16` §16.5), RCA and Defect (`13` §13, INTAKE and RECORD
steps) — each with a complete worked example or an exhaustive field list — seven types have only
partial or no spec content:

- **Risk**, **Assumption**, **OpenQuestion**, **Waiver**, **Environment**, **HandoffRecord** are
  registry `collection: true` types (many entries in one shared file, not a whole front-matter
  document each — `PLAN-M1.md` P7's own Check names this distinction). Of these, `Assumption` and
  `HandoffRecord` have complete worked examples (an assumption entry embedded in `05` §5.6's
  HandoffRecord example; the HandoffRecord example itself). `Waiver` has an explicit three-field
  list (`reason`, `owner`, `expiry` — `20` §20, `21` §21.3 E4, `PLAN-M1.md`'s own Check) and
  `Environment` has an explicit seven-field list (`14` §14, "purpose, URL, deploy trigger, data
  policy, secrets source, owner, and how to get access"). `Risk` has only a four-field shorthand
  (`08` §8.2: "likelihood/impact/mitigation/owner" — no field for what the risk actually *is*).
  `OpenQuestion` has no field list at all, only a purpose description ("unanswered questions
  blocking or shadowing work", `08` §8.2) and a plain-string usage in `05` §5.6's
  `open_questions: [ "..." ]` — never a structured entry shape.
- **GateReport** has no field-level spec anywhere — `10` §10's gate rules say only that "every gate
  evaluation writes a `GateReport` artifact... with the exact command output," never what fields
  that document has.

**Answer taken (proceeding):**
- `waiverSchema` and `environmentSchema` are built fully from their explicit field lists.
- `assumptionSchema` and `handoffRecordSchema` are built fully from their worked examples (and
  `handoffRecordSchema`'s `assumptions` field reuses `assumptionSchema` for its entries, rather than
  a second, possibly-drifting transcription).
- `riskSchema` adds one field beyond the stated four, `statement` (what the risk is), reusing the
  same field name every other artifact type in this registry already uses for "the thing being
  described in prose" (NFR, Capability) — a naming choice, not a structural invention, and the
  narrowest addition that makes a "register" of risks legible at all.
- `openQuestionSchema`, given no field shape at all, is minimal: `id`, `question`, and `status`
  (`open | resolved`) — `status` justified directly by `10` §10's gate rule that "blocking OQs must
  be resolved," which presupposes a resolved/open state to check.
- `gateReportSchema` is the base front matter narrowed to `type: z.literal('GateReport')` only, no
  invented fields — the same Q20 discipline for a type with no spec content at all.

**Recommended resolution:** author a worked example for OpenQuestion and GateReport matching the
other types' style; confirm `riskSchema`'s added `statement` field name (or replace it) when Risk's
own worked example is written.

---

## Q24 — HandoffRecord's own worked example is 4 digits, the same `idWidth` defect as Q21, a second type

**Conflict, same shape as Q21.** `05` §5.6's only HandoffRecord example (`id: HO-0042`) is 4 digits;
`18` §18.7's registry gives HandoffRecord no `idWidth` override, defaulting it to 3. Surfaced the same
way Q21 was: `handoffRecordSchema`'s valid-fixture test, transcribed verbatim from the spec example,
failed against the registry's default width.

**Answer taken (proceeding):** corrected `ARTIFACT_TYPES`'s `HandoffRecord` row to `idWidth: 4`,
matching the one existing usage — there is no competing 3-digit example to weigh it against, so this
is the same call Q21 made, not a new kind of judgment.

**Recommended resolution:** add `idWidth: 4` to HandoffRecord's row in `18` §18.7's table. Given two
of twenty-one rows have now needed this correction from real usage the table itself did not predict,
also worth a pass checking every remaining type's only-ever-used id width against its declared
default before more schemas are built against it.

---

## Q25 — `18` §18.3's canonical config literally names a platform (`claude-code`, `claudeCode`), which the already-shipped `no-platform-concept` rule refuses everywhere in `@forge/schemas`

**Conflict, confirming Q16's "confirm before P8" note with the concrete evidence Q16 didn't yet
have.** `18` §18.3's canonical `.forge/config.yaml` names the platform directly, twice: `platform:
{ primary: claude-code, ..., claudeCode: { transport: sdk, ... } }` and again in
`models.tiers.*.claude-code`. `PLAN-M1.md` P8's Check requires "the canonical YAML block from §18.3
parses and validates unchanged (golden fixture)."

This is not just an architectural preference against it (Q16, written during P4/P5) — it is now a
hard mechanical fact about a rule this project already built and gauntlet-reviewed in P2:
`tools/eslint-plugin-forge-boundaries/src/rules/no-platform-concept.mjs` scans **every** `Identifier`
and string `Literal`/`TemplateElement` node under `packages/*` outside `packages/adapter-*` for the
whole word `claude` (via camelCase/kebab-case splitting). This fires on `claudeCode` as an object
property *key* in a zod schema exactly as it would on a variable name, and — critically — it fires
identically inside `packages/schemas/test/**`: a test fixture that merely contains the string
`'claude-code'` as example data, with no behavioural meaning at all, is caught the same way a real
platform-conditional branch would be. There is no way to satisfy "parses the canonical YAML
unchanged" and pass `pnpm lint` at the same time; one of the two has to give.

**Answer taken (proceeding):** the schema gives. `platform.claudeCode` becomes
`platform.adapterConfig: Record<string, Record<string, unknown>>` — keyed by an opaque platform id,
one level of structure, values entirely `unknown` because only the adapter package that owns a given
platform id knows its own config shape (Q16's resolution, now concrete). The golden-fixture test
validates the *same shape and every other field verbatim*, with two substitutions `no-platform-concept`
forces, both from the same rule's banned-token set (`claude`, `subagent`, `opus`, `sonnet`, `haiku`,
`fable`): `example-adapter` for `claude-code`/`claudeCode` throughout (`platform.primary`,
`platform.adapterConfig`, `models.tiers.*.example-adapter`), and `small-model`/`medium-model`/
`large-model` for the spec's own `haiku`/`sonnet`/`opus` model names in `models.tiers.*`. Those are
the only two departures from "unchanged." `DEFAULT_CONFIG.platform.primary` defaults to `''` (unset)
rather than naming any adapter, matching Q16's framing that a specific platform's identity is an
installed adapter's concern, not `@forge/schemas`'s own built-in default.

**Recommended resolution:** amend `18` §18.3's example to use a placeholder platform id (or note
explicitly that `claude-code`/`claudeCode` there are illustrative project-level configuration, not
part of the schema `@forge/schemas` itself may encode) — the same spirit as Q16's original
recommendation to amend `02` §2.6, now with the concrete mechanical reason.

---

## Q26 — `18` §18.3's own `redactPatterns` example is not valid JavaScript `RegExp` syntax

**Conflict.** `18` §18.3's canonical config gives `redactPatterns: [ "(?i)api[_-]?key",
"(?i)authorization" ]`. `(?i)` is a PCRE/Python-style inline case-insensitivity flag; it is not valid
anywhere in JavaScript's `RegExp` syntax, on the exact runtime `02` §2.1 pins this project to —
verified directly: `new RegExp('(?i)api[_-]?key')` throws `SyntaxError: Invalid regular expression:
/(?i)api[_-]?key/: Invalid group` on Node 22. JavaScript has no inline case-insensitivity syntax at
all, scoped or unscoped — case-insensitivity is only ever the separate `i` flag argument to the
`RegExp` constructor. `PLAN-M1.md` P8's own Check ("redactPatterns entries compile as regular
expressions") surfaced this directly: the canonical example, used as the golden fixture, failed to
compile.

**Answer taken (proceeding):** the compile-check in `configSchema` recognizes a leading `(?i)` as
exactly that PCRE idiom, strips it, and compiles the remainder with the JS `i` flag —
`` `(?i)api[_-]?key` `` is treated as `` new RegExp('api[_-]?key', 'i') ``, which does compile and
does mean the same thing. This is a narrow, single-idiom translation, not general PCRE emulation: a
pattern using any other PCRE-only construct (lookbehind assertions predating Node's support, atomic
groups, possessive quantifiers) is still rejected, correctly, as not valid JavaScript `RegExp` syntax.
Whatever later piece actually performs redaction with these patterns needs the identical
`(?i)`-stripping step to interpret them as intended — noted here so that piece does not reinvent or,
worse, silently diverge from this convention.

**Recommended resolution:** either state in `18` §18.3 that `redactPatterns` entries use JavaScript
`RegExp` syntax with the one `(?i)`-prefix case-insensitivity convention this schema now defines, or
add a separate structure (`{ pattern, flags }` instead of a bare string) so case sensitivity is
explicit rather than inferred from a borrowed PCRE idiom.

---

## Q27 — Migration runner: `18` §18.9's own example mutates its input, and `PLAN-M1.md`'s stated
signatures cannot report failure without throwing

**Conflict, two parts.**

First, the same `schemas ← (no forge deps)` tension Q3 already resolved recurs here in a new shape.
`PLAN-M1.md` P10's stated surface is `planMigrations(type, fromVersion, toVersion): readonly
Migration[]` — a bare array, no room to report "resolves the chain **or fails**" (P10's own Mandate)
without throwing, which `@forge/schemas` cannot do (Q3).

Second, `18` §18.9's own worked example is not pure by the definition P10's own Checks demand of it.
The spec's code block does `up(doc) { doc.frontmatter.reversibility ??= 'medium'; ...; return doc; }`
— mutating the input and returning the same reference. P10's own Check says the opposite is required:
"the runner passes a frozen document and asserts the input object is not mutated." A migration written
exactly as `18` §18.9 illustrates would throw a `TypeError` the instant it ran against a frozen input
(`??=` on a frozen object's missing property is an assignment attempt, which throws in strict-mode
ESM) — the spec's own reference implementation fails its own build plan's acceptance check.

**Answer taken (proceeding):**
- `planMigrations` and `applyMigrations` return `{ success: true; ... } | { success: false; ... }`
  discriminated unions (matching `registry/paths.ts`'s `RenderArtifactPathResult`, the one precedent
  already in this package), not bare arrays or thrown errors. `planMigrations` gains a fourth,
  optional `migrations` parameter defaulting to the real `MIGRATIONS` registry, so a plan can be
  resolved against fixture migrations in a test without waiting for M1's real (empty) registry to
  gain entries — the three-argument call `planMigrations(type, fromVersion, toVersion)` still matches
  `PLAN-M1.md`'s stated call shape exactly for production use.
- `applyMigrations` deep-freezes the document it hands to each `up`/`down` call. A migration written
  in `18` §18.9's own mutating style throws immediately; `applyMigrations` catches that (and any other
  thrown error) and reports it as a typed failure rather than letting it propagate, so the "never
  throws" rule holds even when a migration itself is buggy or written against the spec's illustrative
  (non-conforming) style. `18` §18.9's code block is treated as illustrative pseudocode of *what* a
  migration does (add fields with defaults), not a literal contract for *how* to write one — no
  migration in this repository is written that way; the fixtures built for this piece's own tests
  return new objects instead of mutating.

**Recommended resolution:** amend `18` §18.9's example to a non-mutating style (`return { ...doc,
frontmatter: { ...doc.frontmatter, reversibility: doc.frontmatter.reversibility ?? 'medium', ... } }`)
so the spec's own illustration would pass the purity check `PLAN-M1.md` requires of every real
migration; amend `PLAN-M1.md` P10's stated `planMigrations` signature to name its actual, result-
returning shape rather than a bare array.

---

## Q28 — P11's three prerequisites: real `requiredSections` values, a `templates`↔`schemas`
boundary deadlock, and what "Handlebars placeholders parse" means for a static template stub

Three separate things had to be settled before any P11 code, all discovered by actually trying to
build the piece rather than by re-reading the plan text.

**1. `requiredSections` (deferred by Q18).** Q18 left every type's `requiredSections` as `[]`,
recommending it be revisited "only when each type's detailed schema is authored and a spec section
actually states its required sections" — P6/P7 have since authored every type's schema, so this
piece did the deferred search. Two types have a concrete, spec-given `##`-heading list in a full
worked example (front matter *and* body): ADR (`08` §8.4) — `Context`, `Options considered`,
`Decision`, `Diagram`, `Consequences`, `Reversal plan` — and SessionRecord (`16` §16.5) — `Frame`,
`Diverge`, `Converge`, `Decisions`, `Non-decisions`, `Actions`, `KB write-back`. No other type has
one: several (Runbook, Environment) have prose naming *candidate fields* ("symptoms, immediate
mitigation, diagnosis steps...") with no literal heading list — Q18's own standard ("not invent
section names with no spec source") rules out promoting prose-only mentions into headings, so those
stay `[]`, correctly, not from oversight. Diagram (`.mmd` raw source) and InterfaceContract (a `.yaml`
file) cannot have `##` sections at all — structurally different file formats, `[]` is the only
correct value, not a placeholder for missing data.

**2. `@forge/templates` cannot import `@forge/schemas`, in `src/` *or* `test/`.** `PLAN-M1.md` P11's
own Check — "front matter validates against that type's schema" — requires the per-type zod schemas
from `@forge/schemas`. But `02` §2.2's graph gives `templates: []`: zero `@forge/*` dependencies, and
(confirmed by reading `tools/eslint-plugin-forge-boundaries/src/index.mjs`'s file-glob registration)
the boundary ESLint rules apply to `packages/**/*.{ts,...}` with no `test/` exemption — so a test
*inside* `packages/templates/test/` importing `@forge/schemas` would fail `pnpm lint` exactly as a
`src/` import would. `@forge/schemas` is equally forbidden from importing `@forge/templates`
(`schemas: []` too), so there is no package on either side of this validation that is allowed to
depend on both.

**Answer taken (proceeding):** `@forge/templates` stays a pure data package — `TEMPLATE_INDEX` is
typed by a `TemplateArtifactTypeId` union declared independently *inside* `packages/templates`
(the 21 names transcribed again, not imported), not by `@forge/schemas`'s `ArtifactTypeId`. The actual
cross-package validation test (front matter against schema, headings against `requiredSections`, and
`TemplateArtifactTypeId`'s set kept in sync with the real registry) lives at the repository root
(`test/templates.test.ts`), which the `packages/**` boundary glob does not cover — the same place
`test/workspace-floor.test.ts` and `test/lint-rules.test.ts` already do cross-cutting checks no single
package's own boundary permits. This is an implementation-location decision, not a specs/ conflict
(neither `PLAN-M1.md` nor any spec file says where the test file must live), recorded here because the
reason is easy to lose without it.

**3. Handlebars.** `02`'s tech-stack table pins Handlebars, strict mode, a custom helper set, for
*rendering* templates (`19` §19.2's `TemplateContext`) — a run-time mechanism no piece before M2's
engine work implements. `PLAN-M1.md` P11's own Check nonetheless says "Handlebars placeholders parse
in strict mode with the declared helper set only." Putting a real `{{project.name}}`-style expression
in one of these 21 files' *front matter* would break the other Check in the same list — front matter
must validate against the type's schema, and a raw Handlebars expression is not a valid date, enum
member, or id pattern. Resolved by keeping these 21 stub templates entirely static: concrete,
schema-valid front matter, and `<…>` angle-bracket placeholders (per this Check's own other half) for
every piece of body prose a human or agent must supply — no `{{...}}` anywhere in any of the 21 files.
The Handlebars Check is still real and tested, not vacuous by construction: `test/templates.test.ts`
scans every template for `{{...}}`-shaped substrings (finding none today) and separately unit-tests
the scanning function itself against both a valid and a deliberately malformed/undeclared-helper
Handlebars expression, so the mechanism is proven before the day some future template actually uses
it, rather than "passing" only because nothing has ever exercised it.

**Recommended resolution:** none needed for (1) — Q18's own plan already anticipated this outcome.
For (2), no spec text needs changing; if a later `templates ← schemas` or `schemas ← templates` edge
is ever proposed, note that this M1 piece is the reason validation of one against the other currently
lives outside both packages. For (3), no spec text needs changing; a note that "template stub" (`22`'s
M1 acceptance wording) means a static, hand-editable file at M1, with Handlebars rendering arriving
only once `19` §19.2's engine exists, would avoid a future reader assuming these files are already
render-ready.

---

## Q29 — P13's cache path is inside `resolveWithin`'s own deny list, and no spec states a real
collection file's on-disk shape

Two separate gaps, both discovered while trying to build the ID allocator, neither answerable by
re-reading the same section again.

**1. `.forge/state/ids.json` vs `CFG-004`.** `18` §18.8 and `09` §9.2 both name
`.forge/state/ids.json` as the ID cache's location, verbatim. But `02` §2.5's deny list — implemented
in P4 as `ProjectPaths.resolveWithin`'s `CFG-004` — blocks every write under `.forge/state/`
unconditionally, with no exception for a cache file. Read literally, the spec asks for a file at a
path the spec's own write gate refuses to resolve. `CFG-004`'s own remedy text already gestures at
the answer without building it: "Write through the owning subsystem instead: ... event-log entries
through the run's own append-only writer" — implying `.forge/state/`'s internal writers use a
different route than ordinary artifact/content writes, but P4 never built that second route, because
nothing before this piece needed one.

**Answer taken (proceeding):** added `ProjectPaths.resolveState(relative)`, a second resolver scoped
to `<root>/.forge/state/` — traversal- and symlink-escape-checked exactly like `resolveWithin`
(sharing its containment logic), but never consulting the deny list, since being *inside*
`.forge/state/` is the point of calling it, not something to refuse. `resolveWithin` itself is
unchanged: an ordinary caller still cannot write there. Only `IdAllocator`'s cache (and, going
forward, whatever the event log and the project lock end up implemented against) uses the new method.

**2. No spec states what a populated `collection: true` file (`kb/risks.md`, `reports/waivers.md`,
...) actually looks like on disk once it holds more than one entry.** `08` §8.2 calls `risks.md` a
"register," and `PLAN-M1.md` P11's own stub template for each collection type (`SPEC-QUESTIONS.md`
Q28) is a single `---`-fenced entry with a comment telling a human to copy it into the shared file —
but copying *how many times, formatted how* (concatenated front-matter blocks? one YAML document
listing all entries? a Markdown table?) is not stated anywhere in the spec pack, and P11 deliberately
did not invent an answer for the stub alone.

**Answer taken (proceeding):** `IdAllocator.scan()` (`18` §18.8: "truth is a scan of existing
artifacts") walks the project tree and treats every `.md` file that parses as a single
`ArtifactDocument` (`@forge/core/artifacts`, P12) with a registered `type` and a matching `id` as one
artifact — which covers all 15 document types, and covers a collection-type entry *if* it is stored
as its own file (a real, if unproven, convention already implicit in specs/22 M1's overall single-
file-per-artifact framing). It does **not** parse a shared collection file for multiple concatenated
entries; scanning `kb/risks.md` for more than one `RISK-###` inside it is out of scope until a spec
page states the file's actual shape. Every allocator test in this piece uses one-artifact-per-file
fixtures for the six collection types, matching what it actually implements — not a claim that the
eventual real format will look like this.

**Recommended resolution:** for (1), amend `02` §2.5 to name the exception `18` §18.8/`09` §9.2 both
already assume: `.forge/state/`'s own internal writers (the event log, the project lock, the ID
cache) resolve within it directly, without the deny-list check that exists to keep everything *else*
out. For (2), state a collection file's real on-disk shape once — multiple concatenated front-matter
blocks, one YAML list, or a table — so `IdAllocator.scan()` (and whatever later piece writes a new
entry into one of these files) has an actual format to target instead of each independently guessing.

**Implementation note, added after initial review:** `IdAllocator.scan()` originally tried to skip
the expensive parse phase whenever a *cheap* directory-listing hash (`computeValidityHash` over the
scanned file *paths* only) matched the on-disk cache's own stored hash. A gauntlet critic found this
unsound: editing an existing artifact's `id`/`type` in place, with no file added or removed, leaves
the listing hash unchanged while the true maximum id changes underneath it — exactly the silent
duplication `18` §18.8's "never reused" exists to prevent, reachable by nothing more adversarial than
a human fixing a typo by hand. `scan()` now always does the full parse; the on-disk cache is read
only to detect and warn about corruption, and `validityHash` is written for provenance, not consulted
as a skip-the-scan signal. `PLAN-M1.md` P13's Check ("a mismatched hash forces a rescan") only ever
required a mismatch to force one — it never required a match to skip one — so this is a correction to
an over-eager optimization this piece invented on its own, not a reopened spec question.

---

## Q30 — `PLAN-M1.md` P13's own Check contradicts the already-shipped, exact-width id regex from P5/P6

**Conflict.** `PLAN-M1.md` P13's Check says: "the 1000th story widens to `STORY-1000` without
colliding with `STORY-100`." But `checkIdMatchesRegisteredType` (`registry/front-matter.ts`, P5) and
`entryIdSchema` (`artifacts/entry-id.ts`, P6) both build their id-validation regex as
`` `^${idPrefix}-\d{${idWidth}}(-\d+)?$` `` — an **exact** digit count, not "at least." Under the
schema as already committed and gauntlet-reviewed, `STORY-1000` (4 digits) fails Story's own front
matter validation outright (`idWidth` is 3 for every type but ADR/NFR/HandoffRecord). No spec page
states overflow behaviour either way — `09` §9.2 and `18` §18.8 both just say "zero-padded to 3 (4
for ADR)," silent on what happens past 999. The Check's "widens" language appears to have been
written without checking it against the id regex two milestone pieces had already locked in.

**Answer taken (proceeding):** the schema is not revisited — reopening P5/P6's already-reviewed,
gauntlet-passed regex for a scenario neither spec page actually requires is a disproportionate risk
for this piece to take on. Instead, `IdAllocator.allocate`/`allocateMany` refuse to produce an id that
would need more digits than `idWidth` allows, failing with a new, actionable code (`CFG-010`) rather
than silently handing back an id the schema's own validation would then reject on the next
`validateArtifact` call — a caller finding out at allocation time, with a clear remedy, is strictly
better than finding out later at validation time with a confusing schema error pointing at a
perfectly-formed id string. `PLAN-M1.md` P13's Check is corrected to match: the 1000th `Story` fails
allocation with `CFG-010`, naming the type and the digit ceiling, rather than "widening."

**Recommended resolution:** state the real overflow behaviour once, in `18` §18.8, next to "zero-padded
to `idWidth`" — either "allocation fails past the digit ceiling" (what this piece implements) or "ids
widen past the ceiling" (which would mean revisiting the id regex everywhere it's already enforced:
`registry/front-matter.ts`, `artifacts/entry-id.ts`, and every per-type schema built on top of them).

## Q31 — P14's spec graph: `02` §2.6's "capability" vs `09` §9.4's "epic," and which required edges are
actually derivable from `ArtifactDocument[]` alone

**Conflict 1 — parent-type wording.** `PLAN-M1.md` P14's Check says: "a story with no parent epic
produces the documented `SPEC-` violation naming the story (`02` §2.6 example: `SPEC-021 STORY-014 has
no parent capability`)." But `09` §9.4's own edge table states the Story's one required edge as
`STORY partOf EPIC`, not `STORY … CAPABILITY` — the two spec pages name a different parent type for
the same node. `02` §2.6's line is a one-off illustrative example in an error-taxonomy table, not a
restatement of the traceability rules; `09` §9.4 is the section this piece implements and the one
`REQUIRED_EDGES` transcribes row-for-row.

**Answer taken (proceeding):** `09` §9.4 is authoritative for graph structure — the checked edge is
`STORY partOf EPIC`, sourced from `story.epic`. `SPEC-021` (already shipped, `errors/codes.ts`) takes a
generic `{ artifact, expectedParent }` pair and renders `"<artifact> has no parent <expectedParent>."`;
`SpecGraph` calls it with `expectedParent: 'Epic'` for this violation. `02` §2.6's "capability" wording
is read as loose illustrative phrasing (the Story's ultimate ancestor chain does end at a Capability,
two hops up), not a second literal requirement — nothing in `09` §9.4 or anywhere else asks for a direct
`STORY → CAPABILITY` edge, and `Story`'s own `capability` field (`schemas/artifacts/story.ts`) is
treated as denormalized convenience data, not a graph edge, since `EdgeKind` has no member for it.

**Conflict 2 — five of the eleven `09` §9.4 rows are not derivable from `ArtifactDocument[]` alone
under the schemas P6/P7 already shipped.** `SpecGraph.build`'s stated surface takes only
`docs: readonly ArtifactDocument[]`. Checking each row against what a `Story`/`Epic`/`Capability`/
`Task`/`ADR`/`InterfaceContract`/`NFR` document's front matter actually carries:

| Row | Data exists to derive it? | Built by `SpecGraph.build` in M1? | Source / why not |
|---|---|---|---|
| `CAP realises VIS` | yes | **yes** | implicit: `Capability.parent === 'Vision'` (registry) and Vision is a singleton (`cardinality: 'one'`) — every `Capability` node realises the one `Vision` node present, no field needed |
| `EPIC delivers CAP` | yes | **yes** | `epic.capability` |
| `STORY partOf EPIC` | yes | **yes** | `story.epic` |
| `AC belongsTo STORY` | yes | **yes** | synthesized: each `story.acceptance[]` entry is an AC node, implicitly belonging to the Story document it is embedded in |
| `TEST proves AC` | yes, by convention | **yes** | `story.tests[]` entries are test-name strings; `09` §9.5 point 1 requires a test's name to start with the AC id it proves (`AC-014-2 …`); a leading `^AC-\d{3,4}-\d+` token is extracted as the `proves` target. No token, or a token naming an AC absent from the graph, makes the test an orphan (`09` §9.4's own example: `TEST-198 proves no AC`). The same test-name string resolving to more than one distinct AC anywhere in the corpus is the cardinality violation the Check names. |
| `TASK implements STORY` | no | no | `taskSchema` (P6, `SPEC-QUESTIONS.md` Q20) has no field beyond `type: 'Task'` — deliberately, since `09` §9.3 gives Task no field list. Neither does `Story` carry a reverse `tasks: string[]`. There is currently no data anywhere in an `ArtifactDocument` that names which Story a Task implements. |
| `COMMIT implements STORY` | no | no | a git commit is not a FORGE artifact document at all; this needs VCS history, not front matter. No such ingestion exists in M1. |
| `FILE primaryFor STORY` | yes (partial: "claims" half only) | no | `story.files_expected[]` gives the "claims" half of "advisory (from claims + commit history)"; "+ commit history" is unavailable in M1. Deferred rather than half-built: `PLAN-M1.md` P14's Checks never exercise this row, and this piece has no way to test the advisory ranking a real `spec matrix` view would need against real commit history. |
| `ADR constrains EPIC/STORY/component` | yes (partial: no way to tell "component" from a typo) | no | `adr.blast_radius[]` is a free-form string list naming affected ids or components, with nothing distinguishing "a component name the graph legitimately has no node for" from "an id that no longer resolves because it was renamed." Deferred alongside `FILE primaryFor STORY` for the same reason: no Check exercises it, and building it now would be exactly the kind of unverified, builder-invented resolution rule this project's own `GAUNTLET-LOG.md` has twice already found to be where the real defects hide (P12's fence-pairing heuristic, P13's cache-trust optimization). |
| `INT consumedBy STORY` | yes | no | `story.interfaces[]` names the ids (the edge would be authored from the consuming Story's side, not a back-reference on `InterfaceContract`, which P6 left field-free like Task, `SPEC-QUESTIONS.md` Q20) — deferred for the same reason as the two rows above. |
| `NFR verifiedBy TEST/benchmark/monitor` | yes | no | `nfr.verification.ref` names the target, but it may be a real `TEST` node, a benchmark, or a monitor — three different resolution rules with nothing in the front matter distinguishing which applies, and again no Check exercising any of them. |

**Answer taken (proceeding):** `REQUIRED_EDGES` transcribes all eleven `09` §9.4 rows verbatim, as data
— the Check asks for the table row-for-row, not for only the checkable subset. `SpecGraph.build`
constructs real edges only for the five rows `PLAN-M1.md` P14's Checks actually exercise (`realises`,
`delivers`, `partOf`, `belongsTo`, `proves`); the other six are deferred, not half-built from an
untested guess at each one's resolution rule. `missingRequiredEdges()` correspondingly evaluates only
the three parent-chain rows (`SPEC-021`) and the `proves` cardinality rule (`SPEC-022`) — evaluating an
unbuilt row would either flag every `Task`/`ADR`/`InterfaceContract`/`NFR` document as a violation (a
wall of false positives) or silently claim compliance it cannot verify, and neither is better than not
evaluating it at all. This scoping is recorded in `graph/build.ts`'s own doc comment and in
`SpecGraph.parentsOf`'s, not hidden. Closing `TASK`/`COMMIT` needs either a spec-given `Task.story`
field (revisiting the P6 schema `SPEC-QUESTIONS.md` Q20 deliberately left minimal) or a git-integration
piece (a later milestone); closing `FILE`/`ADR`/`INT`/`NFR` needs a real Check to build and test each
row's resolution rule against, which is a decision for whichever future piece first needs `spec:
nfr-coverage` or the advisory half of the traceability matrix, not one to make speculatively here.

**Recommended resolution:** align `02` §2.6's example to say `"SPEC-021 STORY-014 has no parent epic"`,
matching `09` §9.4's own table; give `Task` a real `story: string` field once a spec page actually
specifies one; and, when a future piece needs `FILE`/`ADR`/`INT`/`NFR` edges for a real gate, add Checks
for each one's resolution rule at the same time, rather than inheriting an unverified guess from here.

## Q32 — P3's required-role levels reuse `L0`–`L4` for a concept `15` §15.2 already owns, and that
concept is never itself defined

**Conflict.** `PLAN-M2.md` P3's `REQUIRED_ROLES` names each required role's minimum level verbatim
from `15` §15.3.3: "`pm` (L2+), `architect` (L2+), `test-architect` (L1+)." But `L0`–`L4` is *already*
a defined term in this exact spec file — §15.2's five customization layers (built-in, module, org,
project, personal) — and §15.3.3's "L1+"/"L2+" plainly mean something else: a **project scale level**,
the only other place that notation appears in the whole spec pack being `10` §10's module-manifest
example (`levels: [ L1, L2, L3, L4 ] # which scale levels this applies to`). Neither page defines what
distinguishes an `L0` project from an `L4` one, how a project's own current scale level is chosen,
selected, or stored (`03`'s `forge discover` is described as doing "level selection," but no page
gives the mechanics), or even confirms `L0`–`L4` for scale levels has the same five-member range as
the customization layers — it could coincidentally share notation with a different cardinality.

**Answer taken (proceeding):** treated as a distinct, ordinal `ProjectLevel` type (`L0`...`L4`,
matching the layer notation's own range since nothing contradicts it), kept structurally and
nominally separate from `@forge/extensions/resolve`'s `Layer` — two same-shaped types for two
unrelated axes, not one reused type, so nothing conflates "project scale" with "which overlay layer."
`REQUIRED_ROLES`' checking function takes the project's current `ProjectLevel` as a plain parameter
the caller supplies; this piece does not read it from `.forge/config.yaml` or invent a config field
for it, since no spec page says where it lives. A role's own `minLevel` is compared ordinally
(`L0 < L1 < ... < L4`), the only reading `15` §15.3.3's "L1+"/"L2+" notation actually supports.

**Recommended resolution:** define project scale levels once, by name, with what each tier actually
means and where a project's own level is set and read (most plausibly `03`'s `forge discover` /
`.forge/config.yaml`) — ideally in a section of `10` or `11` that owns level selection already, not
reusing `15` §15.2's `L0`–`L4` notation for an unrelated axis without at least a cross-reference.

## Q33 — P4's skill validation: two numbers `15` §15.4.5 requires checking against, neither given a
value; and a Windows executable-bit gap `02` §2.7 requires be first-class

**Conflict 1 — no hard cap number.** `15` §15.4.5: "body ≤ `budget_tokens` (warn) and ≤ hard cap
(error)." `budget_tokens` is a real, per-skill front-matter field (§15.4.2's own worked example sets
it to `3000`), but "hard cap" names a *second*, presumably project-wide ceiling that no page in the
spec pack ever gives a number for, or even a config key.

**Answer taken (proceeding):** `validateSkill` takes the hard cap as an explicit parameter
(`hardCapTokens`), not a hardcoded constant or an invented default — the same resolution `PLAN-M2.md`
P3 used for `ProjectLevel` (`SPEC-QUESTIONS.md` Q32): a real number with no spec source is the
caller's to supply once a spec page gives one, not this piece's to guess.

**Conflict 2 — Windows has no POSIX executable bit.** `15` §15.4.5: "scripts are executable and
declared." `@forge/core/fs`'s new `isExecutable` (added by this piece, additive to the already-
committed P4-of-M1 module) checks the POSIX mode bit, which is meaningful on macOS/Linux but not on
Windows, where a shell script needs an interpreter regardless of any mode value Node reports there —
and `02` §2.7 makes Windows first-class for the whole project, not an afterthought.

**Answer taken (proceeding):** implemented and documented as POSIX-only, with the gap named in
`isExecutable`'s own doc comment rather than a guessed cross-platform check this environment cannot
verify against a real Windows host. `validateSkill`'s own script-executability check inherits the
same limitation.

**Recommended resolution:** state the hard-cap token number (and where it is configured, if at all)
next to `budget_tokens` in `15` §15.4.2 or §15.4.5; and give Windows script-executability its own rule
in `02` §2.7 or `15` §15.4 (a known-extension allowlist, a shebang check, or simply "scripts are a
POSIX-only concept in v1") rather than leaving "executable" to mean only what it means on POSIX.

## Q34 — P5's `grants` map has no worked example for a server-wide grant's own shape

**Conflict.** `15` §15.5.2 rule 2: "Server-wide grants require `grantMode: server-wide` and are
reported per run." But §15.5.1's own worked example only ever shows tool-level grants
(`pm: { acme-jira: [ search_issues, get_issue, create_issue ] }`) — no example anywhere in `15` shows
what a *server-wide* entry in that same map looks like in place of a tool-name array.

**Answer taken (proceeding):** a server-wide grant is written as the literal string `'*'` in place of
the tool-name array (`grants[role][serverId]: readonly string[] | '*'`) — the smallest change to the
worked example's own shape that can express "every tool," reusing a wildcard convention already
familiar from allowlist fields elsewhere in `15` (e.g. `tools.exec` glob entries) rather than adding a
second, differently-shaped field. `validateMcpConfig` reports `'*'` used under `grantMode: 'explicit'`
(the default) as an error, and under `grantMode: 'server-wide'` as accepted — the compile-time half of
rule 2; "reported per run" is a runtime/event-log concern for whichever piece owns execution.

**Recommended resolution:** add a server-wide grant to `15` §15.5.1's own worked example (even a
single line, `sre: { acme-postgres-staging: "*" }` or similar) so the map's two grant shapes are both
spec-given rather than one inferred.

## Q35 — `10` §10.1's inline error codes for workflow-overlay guardrails collide with `15` §15.10's
own invariant table

**Conflict.** `10` §10.1's "Customization" subsection says, in prose: "delete a gate step
(`GATE-501`), define a gate with zero deterministic checks (`GATE-502`), or remove the `red`
(test-first) or `review` steps from the inner loop (`CFG-502`)." But `15` §15.10's own invariant
table — the authoritative registry PLAN-M2.md P8 is built around — already assigns those exact codes
to two different invariants: `GATE-501` is I3 ("a gate cannot be approved with a failing deterministic
check; only waived"), and `CFG-502` is I2 ("the test-authoring step and the implementation step cannot
be the same agent instance"). Only `GATE-502` genuinely agrees between the two pages (both say "a gate
defined with zero deterministic checks"). `@forge/core/errors`' code registry (`packages/core/src/
errors/codes.ts`) is a flat `Record` keyed by code string — two different `ErrorDefinition`s cannot
share one key, so whichever piece registers real codes for these three guardrails cannot literally
follow `10` §10.1's text without silently colliding with `15` §15.10's own I2/I3 entries.

**Answer taken (proceeding):** P6 (`@forge/extensions/workflows`) does not mint or reference any
`GATE-`/`CFG-` numbered `ForgeError` code at all for its own two guardrails (refusing `$remove` on a
gate/red/review step, refusing an unresolvable `$insertAfter` anchor) — it returns typed, piece-local
finding objects (`code: 'gate-step-removed' | 'protected-step-removed'`, etc.), the same
"validate returns, it does not throw" shape `@forge/schemas` established (Q3) and P3/P4/P5 all reused.
Minting the real numbered code is deferred to whichever piece actually wires a refusal into
`@forge/core/errors`' registry (most likely P9's compile pipeline) — recorded here now so that piece
does not rediscover this collision from scratch. When it does, `GATE-502` can be reused as-is (both
pages agree); the "delete a gate step" and "remove red/review steps" refusals need *fresh* numbers
(e.g. `GATE-504`, `CFG-506` — the next free slot in each family after `15` §15.10's own I1–I12), not
`10`'s stated `GATE-501`/`CFG-502`, since those are already spoken for.

**Update (P8):** `PLAN-M2.md` P8 (`SPEC-QUESTIONS.md` Q40) independently needed fresh `CFG-*` slots
for its own I7–I9 and, without cross-referencing this entry, first landed on `CFG-506` too — the exact
slot this entry had already reserved for the future "delete a gate step" guardrail. Caught before
either piece's code shipped with the collision: P8's I7–I9 now register one slot higher
(`CFG-507`–`CFG-509`), leaving `CFG-506` exactly as reserved here. Any future piece minting the "delete
a gate step" code should still use `CFG-506` (not re-check this coordination against Q40 again — it is
now settled) and `GATE-504` for "remove red/review steps," unchanged from this entry's own numbers.

**Recommended resolution:** fix `10` §10.1's prose to cite the numbers `15` §15.10 actually assigns
these two guardrails (assigning them fresh codes there, and reflecting the same codes back into `10`),
rather than leaving two pages of the same spec pack disagreeing about what `GATE-501`/`CFG-502` mean.

## Q36 — No mechanical, general-purpose marker identifies a workflow's `red` (test-first) or `review`
step

**Conflict.** `10` §10.1 says an overlay may not remove "the `red` (test-first) or `review` steps
from the inner loop," and §10.6 names `red`/`green`/`review` as canonical *phase* names in a ten-step
sequence — but no page defines a mechanical field on a step object itself (no `phase` key, no `kind:
red` value — `kind` is drawn from an unrelated eleven-value set: `agent`/`command`/`gate`/`elicit`/
`session`/`fanout`/`merge`/`subworkflow`/`checkpoint`/`parallel`/`sequence`) that identifies which step
in an *arbitrary* custom workflow plays which canonical-loop role. The only evidence given is `10`
§10.1's own worked `build-stage.workflow.yaml`, where the step conventionally named `id: review` sets
`agent: reviewer`, and the step conventionally named `id: generate-tests` (phase 3, "red") sets
`agent: sdet` — role assignment, not a dedicated marker field.

**Answer taken (proceeding):** a step (or, for a `fanout` step, its nested `step`) is treated as the
protected "review" step if its `agent` is literally `'reviewer'`, and as the protected "red" step if
its `agent` is literally `'sdet'` — the only two role-to-phase associations the spec pack actually
shows, matching this session's precedent of role-id literals as the mechanical signal (P5's
`WRITE_DENIED_ROLES`). A `kind: gate` step is identified structurally and needs no such convention.

**Recommended resolution:** give steps an explicit, spec-defined marker for their canonical-loop role
(a `phase` field, or a reserved value in an extended `kind` enum) so "is this the red/review step" is
answerable without inferring it from which role happens to be assigned, which breaks the moment a
project renames or reassigns those roles for a legitimate reason unrelated to weakening the loop.

## Q37 — No worked example exists anywhere for a template overlay's own document shape

**Conflict.** `15` §15.7's "Template overlays" subsection is prose only: "Every artifact template is
overridable. Required schema fields stay required — a template that omits one fails compile with the
field name." Every *other* overlay-able kind in the same section (workflows, gate checks, frameworks)
gets a concrete YAML worked example; templates get none. Separately, `packages/templates/src/
artifacts/*.md` (`PLAN-M1.md` P11) shows what a *base* template actually looks like: a real front-
matter document whose keys are literally the artifact type's own schema field names, holding
placeholder values (`title: '<the story name>'`) instead of `$`-operator directives — templates are
customized by wholesale replacement, not `15` §15.2's incremental merge operators, unlike every other
overlay-able kind this milestone covers.

**Answer taken (proceeding):** `templateOverlaySchema` validates only that a template overlay parses
to a plain front-matter object (reusing `@forge/core`'s already-committed `splitFrontMatter`/
`parseFrontMatterYaml`, the same primitives P4 reused for `SKILL.md`) — no operator support, no
invented field list. `requiredFieldsFor(artifactType)` reads the required (non-`.optional()`)
top-level keys straight off `@forge/schemas`'s own per-type zod schema (via the newly-exported
`ARTIFACT_SCHEMAS` table), and `checkTemplateRequiredFields` compares those against the overlay's own
parsed front-matter keys — the concrete, mechanically-checkable half of the spec's prose, without
guessing at a document shape no page actually shows.

**Recommended resolution:** add a worked YAML (or front-matter) example for a template overlay to `15`
§15.7, matching the treatment every sibling subsection in the same section already gets.

## Q38 — Several preset postures (`15` §15.9's own table) name facts no overlay-able document kind
this milestone's own schemas can express

**Conflict.** `15` §15.9's preset table describes postures partly in terms P1–P7's own overlay schemas
can express directly (a custom role, a review step's perspectives, an MCP server list, a custom gate
check) and partly in terms that are real, schema'd concepts — but belong to `18` §18.3's *top-level*
`.forge/config.yaml` (`@forge/schemas`' already-committed `configSchema`, M1), not to any `.forge/
overrides/**` overlay-able document kind: `solo-fast`'s "L1–L2 default" is `configSchema`'s
`project.level`; "autonomy `autonomous` for non-destructive steps" is `execution.autonomy`/
`autonomyByGate`; `enterprise-rigor`'s "all gates `alwaysHuman`" is also `execution.autonomyByGate`.
Still others (`regulated`'s "no `emerging`-maturity technology," every preset's exact "waivers require
expiry ≤ 30 days"-style numeric policy) have no schema anywhere in the spec pack at all, config.yaml
or overlay.

**Answer taken (proceeding):** `PRESET_REGISTRY`'s own overlay files are scoped to exactly the seven
document kinds this milestone's own schemas cover (roster, agent overlay, MCP grants, workflow
overlay, gate check, framework overlay, style profile) — the same kinds `ejectPreset`'s round-trip
property (`AC15-8`) can actually mean something for, since only `.forge/overrides/**` files are
resolved by `@forge/extensions/resolve`'s layer model at all; `.forge/config.yaml` is a single,
already-existing physical file per project, not a layered/merged document, and patching *part* of it
non-destructively is a materially different, unaddressed problem this piece's own Surface (`styleProfileSchema`, `presetSchema`, `PRESET_REGISTRY`, `applyPreset`, `ejectPreset`) never mentions.
Each preset's `posture` field carries the *full* prose from `15` §15.9's own table, including the
config.yaml-level and unschematised facts, as a human-readable description — real information, just
not machine-applied by this piece. A concept with no schema anywhere (`emerging`-maturity technology,
a specific waiver-expiry-day number) is not invented a field for, matching `SPEC-QUESTIONS.md`
Q18/Q20/Q32/Q33's "no spec source, don't invent one" precedent.

**Recommended resolution:** give `.forge/config.yaml` an explicit, spec-named mechanism for a preset to
patch a *subset* of it non-destructively (the way overlays already patch `.forge/overrides/**`
documents), and give the still-unschematised posture facts (technology maturity, waiver-expiry
policy) a real field somewhere, so a future piece has something concrete to apply rather than prose.

## Q39 — `AC15-8`'s "apply then resolve" half needs infrastructure that does not exist until `PLAN-M2.md`
P9

**Conflict.** `PLAN-M2.md` P7's own Check restates `AC15-8` literally: "`applyPreset('enterprise-rigor')`
then *resolving*, versus `ejectPreset('enterprise-rigor')`'s files applied as ordinary L3 overrides
then *resolving*, produce byte-identical resolved output." But `@forge/extensions/resolve`'s own
`Resolver.resolve(id, contributions, options)` (`PLAN-M2.md` P2) is a pure, in-memory, *per-entity*
function — it takes an already-assembled `LayerContribution[]` and returns one `ResolvedEntity`; there
is no function anywhere in `@forge/extensions` (this milestone's own package) that reads a whole
project's `.forge/overrides/**` tree off disk and turns it into the `LayerContribution[]` set
`Resolver.resolve` needs, per entity, across every overlay-able document kind. `PLAN-M2.md`'s own P9
("The compile pipeline and `overlay explain`") is explicitly where that reading-and-assembling logic
is scoped to live — it does not exist yet.

**Answer taken (proceeding):** this piece verifies the mechanical precondition `AC15-8` actually
depends on — that `applyPreset(id, target)`'s written files and `ejectPreset(id)`'s returned files are
identical in path and content for the same preset — since if apply and eject ever disagreed about
*what* gets written, no resolve-based check downstream could produce byte-identical output either.
The full end-to-end version (actually resolving both trees and diffing the resolved entities) is
recorded here as blocked on P9's own compile pipeline existing, not silently skipped without a reason
on record.

**Recommended resolution:** once `PLAN-M2.md` P9 lands a "read `.forge/overrides/**` into
`LayerContribution[]`" function, add the literal `AC15-8` round-trip test this piece's own Check
describes, using that function plus this piece's already-built `applyPreset`/`ejectPreset`.

## Q40 — `15` §15.10's `SEC-` code prefix does not exist in `@forge/core/errors`' closed registry

**Conflict.** `15` §15.10's own invariant table assigns I7/I8/I9 the codes `SEC-501`/`SEC-502`/
`SEC-503`. But `@forge/core/errors`' `ErrorCodePrefix` (`02` §2.6) is a *closed* union of exactly ten
prefixes (`CFG`/`ENV`/`ADP`/`VCS`/`SPEC`/`KB`/`GATE`/`RUN`/`BUD`/`USR`) with no `SEC` member —
`PLAN-M2.md` P8's own design note flagged this before any code was written, recommending folding
I7–I9 under `CFG-5xx` rather than widening the closed union unilaterally.

**Answer taken (proceeding):** I7/I8/I9 register as `CFG-507`/`CFG-508`/`CFG-509` — `CFG` is `02`
§2.6's own "Configuration/validation" category, broad enough to cover a refused resolved-set
condition. Originally drafted as `CFG-506`–`CFG-508` (the next three free slots after `15` §15.10's
own I1/I2/I10/I11/I12, `CFG-501`–`CFG-505`), but `SPEC-QUESTIONS.md` Q35 — written earlier, during
P6 — had already reserved `CFG-506` for a *different* future guardrail ("delete a gate step" via
overlay). Caught before either piece's code shipped with the collision; I7–I9 shifted one slot higher
so `CFG-506` stays exactly as Q35 reserved it. I3–I6's own `GATE-501`/`GATE-502`/`GATE-503`/`SPEC-501`
need no change: `GATE` and `SPEC` are both already-valid prefixes in the closed union, so those five
codes are registered exactly as `15` §15.10 gives them.

**Recommended resolution:** either add `SEC` to `02` §2.6's closed prefix list (a cross-cutting change
no single milestone piece should make unilaterally), or update `15` §15.10's own table to cite
`CFG-507`/`CFG-508`/`CFG-509` in place of the `SEC-*` codes it currently gives, so the spec pack's own
two pages agree on what these three invariants are actually called.
