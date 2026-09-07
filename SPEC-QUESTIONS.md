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

## Q41 — `PLAN-M2.md` P9's own Surface reuses P8's `ResolvedSet` type name for a structurally
incompatible shape

**Conflict.** `PLAN-M2.md` P9's own Surface (written before P8 was actually built) declares
`interface CompileResult { readonly resolvedSet: ResolvedSet; ... }`, naming the same `ResolvedSet`
type P8 (`@forge/extensions/invariants`) exports. But P9's own Checks describe what that field must
actually contain: "a resolved set covering every kind `15` §15.2 rule 1 names (`agents, workflows,
frameworks, templates, checks, skills`) — matching, not a subset" — a document grouped *by kind*. P8's
real `ResolvedSet` is grouped by *invariant input shape* instead (`outputReviewAssignments`,
`gateConfigs`, `scanTargets`, …) — an intentionally different, incompatible axis, designed around
"whichever slice a caller already has," not "every document kind a compile pass touches." The same
name cannot honestly describe both shapes; `PLAN-M2.md`'s own Surface line is a leftover from
before P8's real shape existed.

**Answer taken (proceeding):** `CompileResult` carries the six-kind resolved document tree under its
own name, `documents: CompiledDocuments` (`Record<DocumentKind, ReadonlyMap<string, ResolvedEntity>>`)
— matching what P9's own Checks actually test — not a field literally typed `ResolvedSet`.
`PLAN-M2.md`'s own P9 Surface section is corrected in place to match, the same way earlier corrections
were made to this plan's own inaccuracies (e.g. P6/P7's "Depends on" notes). `compile({ check: true })`
still derives a real P8 `ResolvedSet` internally to call `runInvariants` — see Q42 for which of the
twelve invariants that derivation can actually cover from `CompileSources` alone.

**Recommended resolution:** none needed against the spec pack itself — this is a planning artifact
inside this repository's own `PLAN-M2.md`, already corrected there.

## Q42 — Most of P8's twelve invariants need data no `CompileSources`-shaped input actually carries

**Conflict.** `PLAN-M2.md` P9's own Check says `compile({ check: true })` must "surface every invariant
violation from P8." But `CompileSources` (this piece's own input) only carries layer contributions for
the six document kinds `15` §15.2 rule 1 names (agents, workflows, frameworks, templates, checks,
skills) — it has no gate-required/disabled-check flags (`gateCheckSchema`, P6, carries no such field
at all), no `config.yaml`-level autonomy/roster/security data (I3, I5, I6, I10, I12 all need some of
this), and no cross-reference between a workflow step's producer agent and a later review/test/
diagnose step for the same output (I1, I2) — none of which any of the six resolved document kinds
records as data, only as prose or as fields a different, not-yet-built piece owns.

**Answer taken (proceeding):** `compile({ check: true })` derives and runs only the invariants whose
full input is mechanically reachable from `CompileSources` alone, with no invented cross-referencing:
**I8** and **I9** (scanning every resolved document's own string content for secret-shaped literals
and injection patterns — genuinely available once every entity is resolved) are the only two run
automatically. The other ten remain exactly what P8 itself already designed them to be — functions a
caller with the richer data (a real `.forge/config.yaml`, a real workflow engine's step sequencing)
calls directly via `@forge/extensions/invariants`' own `runInvariants` with a hand-assembled
`ResolvedSet`. `compile()`'s own Check ("surfaces every invariant violation from P8") is satisfied for
the violations it is actually positioned to find, not by fabricating the other ten invariants' missing
inputs from data that does not exist in this piece's own input shape.

**Recommended resolution:** once a real `.forge/config.yaml` reader and workflow-step sequencer exist
(later milestones), extend `compile()`'s own input to include them and widen the derived `ResolvedSet`
accordingly — the ten invariants left as caller-supplied here are not less real, only differently
sourced than the two this piece can already reach.

## Q43 — `PLAN-M3.md`'s own exit tests name `forge kb lint`/`forge diagram validate` CLI invocations,
but `@forge/cli` does not exist until M6

**Conflict.** `specs/22` §M3's Exit tests read `pnpm forge kb lint -C fixtures/greenfield-service
--json` and `pnpm forge diagram validate -C fixtures/diagram-drift` (exit 3 with drift reported). But
`specs/22` §M6 is where `@forge/cli` is first built ("`@forge/cli` with every ... command") — no `forge`
binary of any kind exists at M3's point in the build order, so neither command can literally run yet.
This is the same shape of gap M2 hit with its own exit tests (a literal invocation the milestone's own
build order cannot yet satisfy), not a new kind of problem.

**Answer taken (proceeding):** `@forge/kb` and `@forge/diagrams` each expose the real behaviour as a
library function — `lintKb(...)` returning the same structured result `--json` would print, and
`validateDiagrams(...)` returning a result whose `hasDrift`/severity fields are what a future CLI
wrapper maps to exit code 3 — and M3's own Checks call these functions directly against
`fixtures/greenfield-service` and `fixtures/diagram-drift` (both created in this milestone, since
neither exists in the repo yet). Whichever piece wires `@forge/cli` in M6 becomes a thin argument-
parsing shell around these same two functions; nothing about their public contract is expected to
change shape at that point, only to gain a CLI entry point.

**Recommended resolution:** none needed against the spec pack itself — `specs/22`'s per-milestone exit
tests are written against the finished system's command surface throughout, and M6 is where the
literal `pnpm forge ...` invocations given here become runnable as written.

## Q44 — `diagram:refs`, `diagram:required` and `diagram:adr-coverage` (`08` §8.11.7) each need data
only `@forge/kb` owns, but `02` §2.2 forbids `@forge/diagrams` from depending on `@forge/kb`

**Conflict.** `02` §2.2's dependency rule is `diagrams ← core, schemas` — no KB dependency in either
direction except `kb ← diagrams`. But three of `08` §8.11.7's gate checks are, by their own stated
rule, checks against KB-owned data: `diagram:refs` ("every node in `depicts` resolves to a real
component, datastore, entity or actor" — the KB's own `components.md` inventory and domain entities);
`diagram:required` (taxonomy coverage "for the current level and gate" — the project's level lives in
`.forge/config.yaml`, read nowhere in `@forge/diagrams`' own dependency list); `diagram:adr-coverage`
("structural ADRs contain or reference ≥1 diagram" — enumerating "structural ADRs" means reading every
`ADR` entry in the KB). None of the three can be *implemented* inside `@forge/diagrams` without either
violating the dependency rule or inventing a second, parallel way to read KB data.

**Answer taken (proceeding):** `@forge/diagrams`' own validator (`PLAN-M3.md` P2) implements
`diagram:refs` against a caller-supplied resolver (`knownIds: ReadonlySet<string>` or an equivalent
callback) rather than resolving ids itself — the check's *logic* (does this depicted id exist) lives in
`@forge/diagrams`, but *what counts as existing* is injected, so the direction of the dependency stays
`diagrams ← core, schemas` exactly as `02` §2.2 requires. `diagram:required` and `diagram:adr-coverage`
are not implemented in `@forge/diagrams` at all: both run inside `@forge/kb`'s own linter (`PLAN-M3.md`
P10), which already reads the project's KB tree (ADRs, `components.md`) and is the one place with
legitimate access to every input either check needs. Both checks still report under the same
`diagram:*` id namespace `08` §8.11.7 gives them — the namespace is a reporting convention, not a
claim about which package's code raises the finding.

**Recommended resolution:** none needed against the spec pack itself — `08` §8.11.7's table names the
checks and their rules, not which package implements each one; `02` §2.2's dependency graph is what
actually decides that, and the split above is the only assignment consistent with both.

## Q45 — The `mermaid` package itself cannot parse in Node without a DOM, contradicting `02` §2.1's
"no browser" framing taken literally

**Conflict.** `02` §2.1 names "`mermaid` parser (pure JS, no browser)" as the diagram-validation
decision, and `08` §8.11.2 rule 3 says Mermaid "parses in pure JavaScript with no browser and no
server, so validation is cheap enough to run on every gate." Empirically (verified directly against
`mermaid@11` in a plain Node ESM script, no bundler): calling `mermaid.parse(source)` throws
immediately (`DOMPurify.addHook is not a function`) with no DOM globals present — the package's
sanitize step unconditionally expects a real `document`. `@mermaid-js/parser`, Mermaid's own newer
Langium-based pure-grammar package with no DOM dependency, is real and does run standalone, but its
exported `parse()` only covers `info | packet | pie | treeView | architecture | gitGraph |
eventmodeling | radar | railroad* | treemap | wardley | cynefin` — none of which is a kind `08`
§8.11.3's taxonomy table actually names (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`,
`gantt`, `C4*`, `quadrantChart`). The diagram kinds this milestone must actually validate are exactly
the ones still implemented by Mermaid's older, DOM-coupled parsers, not the new pure-grammar ones.

**Answer taken (proceeding):** use `mermaid` itself (not `@mermaid-js/parser`) with `jsdom` supplying
the minimal DOM surface it requires (`document`/`window`/`navigator`/`SVGElement`/`HTMLElement`/`Node`
set once at module load) — verified working for every taxonomy kind tested
(`flowchart`/`sequenceDiagram`/`stateDiagram-v2`/`erDiagram`/`gantt`/`C4Context`/`quadrantChart`, all
parse successfully with this shim in place). `jsdom` is a pure-JS DOM *emulation* library with no
rendering engine, no network access, and no external process — categorically different from "a
browser" or "Puppeteer" in the sense `02` §2.1 and `08` §8.11.8 are actually guarding against (a heavy
install, a spawned browser binary, a network call); it is the accepted mechanism the wider Node
ecosystem already uses to run browser-oriented libraries headlessly, and stays entirely in-process and
synchronous-enough for a gate check. `@forge/diagrams/parse` further found that Mermaid's own unified
renderer data (`diagram.db.getData()`) already returns a normalised `{nodes, edges}` shape for
`flowchart`/`stateDiagram-v2`/`erDiagram` — reused directly rather than hand-walking three separate
per-kind ASTs — while `sequenceDiagram` (`getActors()`/`getMessages()`) and all four `C4*` kinds
(`getC4ShapeArray()`/`getRels()`, shared across `C4Context`/`C4Container`/`C4Component`/
`C4Deployment`) each need their own two-call extraction, no `getData()` support. Only `gantt` and
`quadrantChart` report an intentionally empty graph — not because Mermaid ships no data for them
(`gantt`'s `getTasks()`/`getSections()` and `quadrantChart`'s `getQuadrantData()` are real and were
found during this same investigation) but because a task list and a set of quadrant coordinates are
not a node/edge graph in the sense `diagram:orphan-nodes`/`diagram:complexity`/`diagram:label-quality`
reason about — a deliberate modelling boundary, not a missing-extraction gap, and the two are not the
same thing (an earlier draft of this note conflated them, caught by this piece's own gauntlet critic).

**Correction from the critic round:** the C4 methods above are *own properties* of `diagram.db`, not
inherited ones — `Object.getOwnPropertyNames(Object.getPrototypeOf(db))`, used to enumerate methods
for `sequenceDiagram`/`stateDiagram-v2`/`erDiagram` during the first build pass, found nothing for C4
and was taken as proof no structural data existed there. `Object.keys(db)` (own properties) tells the
true story. The lesson generalises past this one file: a negative result from reflecting on an
external library's object shape is only as trustworthy as the specific reflection technique used, and
is worth re-checking a second way before it becomes a design decision — the same "trace concrete real
inputs, don't reason in the abstract" pattern this codebase's own `GAUNTLET-LOG.md` names repeatedly.

**Also found and fixed in the critic round:** the first build pass's keyword-detection (`detectKind`)
rejected any diagram beginning with Mermaid's own `---`-delimited YAML frontmatter block (a real,
commonly-authored, valid construct for a diagram `title`/`config`) — fixed by stripping a leading
frontmatter block before looking for the kind keyword.

**Recommended resolution:** none needed against the spec pack itself — "pure JS, no browser" is best
read as "no headless-browser binary, no Puppeteer, no network," which `jsdom` genuinely satisfies; if a
future Mermaid release moves `flowchart`/`sequenceDiagram`/`erDiagram`/`stateDiagram-v2` onto the
DOM-free `@mermaid-js/parser` grammars (already underway for other kinds), this piece's dependency on
`jsdom` should be dropped in favour of it without changing `@forge/diagrams/parse`'s own public
surface.

**Build note:** reaching the parsed `.db` (needed for node/edge extraction) requires
`mermaid.mermaidAPI.getDiagramFromText`, which the package itself marks `@deprecated` in favour of
`parse`/`render` — verified that the non-deprecated `parse` returns only `{ diagramType, config }` (no
structural data) and that `render` produces a full SVG (heavier than needed and still DOM-shaped, not
structural). `Diagram.fromText`, the class-based, non-deprecated path to the same `db`, is not
separately exported as its own runtime chunk (only as a `.d.ts` — the class is inlined into the main
bundle). The deprecated call is used deliberately, with an inline `eslint-disable` naming this
reasoning, rather than working around a warning with a worse design.

## Q46 — `sanitizeMermaidId`'s character-replacement alone is not injective and can produce a Mermaid
reserved word, plus three generators implement less than their own taxonomy row literally promises

**Conflict.** `08` §8.11.6's own table gives each generator's Output as a short phrase — "Context +
Container + Component views" for `components-to-c4`, "ER diagram reflecting *actual* schema" for
`schema-introspect-to-er` (sourced from "a live/dev database or migration files"), "CI/CD pipeline
stages & gates" is `08` §8.11.3's row for the same output `pipeline-to-flow` produces — none of which
this milestone's own scope (`specs/22` M3, one piece, `@forge/diagrams` with no adapter/engine
dependency) can fully build: three C4 abstraction levels is a materially larger generator than one
flat dependency graph; a real database/migration-file introspector is its own substantial subsystem
with no home before brownfield ingestion (M10); "gates" (approval/pass-fail semantics) have no
representation in a plain stage-dependency list. Separately, and found empirically while building
this piece (not a spec gap): a first implementation's `sanitizeMermaidId` replaced every character
outside `[A-Za-z0-9_]` with `_` and used the result directly as a bare Mermaid identifier. This is not
injective — `component-api` and `component_api` both sanitize to `component_api` — and a gauntlet
critic proved, by feeding both into a real `mermaid@11.17.2`, that two distinct declared nodes
silently collapse into one (the second declaration's label wins, the first's is lost, and any edge to
either now points at the merged node). The critic also proved several ordinary words — `end`, `class`,
`style`, `subgraph` in flowchart grammar; `end`, `participant`, and other sequence-diagram keywords —
fail to parse at all as a bare, unsanitized identifier, and are entirely ordinary real-world names (a
workflow step called `end`, a CI stage called `style`).

**Answer taken (proceeding):**

*Scope narrowing (three generators):* `components-to-c4` produces only the container-level view (`08`
§8.11.3's own `C4Container`/`flowchart` row) — the single most load-bearing of the three; the context
and component views are a documented gap for a future piece, not attempted. `schema-introspect-to-er`
takes already-extracted table/column/foreign-key structure as its own input — the actual database
query or migration-file parse that produces that structure is a separate, larger concern, deferred to
whichever future piece (plausibly brownfield ingestion, M10) builds real introspection. `pipeline-to-
flow` models stage ordering only, with no gate/approval concept — `PipelineToFlowInput` has no field
for one. All three narrowings are named in the affected generator's own doc comment in
`generators.ts`, not left silent.

*Sanitization fix:* `sanitizeMermaidId`'s raw character replacement is now only ever the first pass of
`buildSanitizedIdMap`, which every generator's rendering path (`render-flowchart.ts`, `render-er.ts`,
`render-sequence.ts`) calls once per diagram (and, for entity attributes, once per entity) over every
id it is about to emit. It assigns ids in a fixed, sorted order (never input order, so two calls over
the same id set always agree) and appends a numbered suffix (`_2`, `_3`, ...) to any later id that
would otherwise collide with an earlier one's sanitized form, and prefixes (`n_`) any id that
sanitizes to the empty string or to a curated, case-insensitive set of words verified empirically to
break at least one Mermaid grammar this package generates. That curated set is explicitly not claimed
exhaustive — Mermaid publishes no single reserved-word list — so a future word this set misses would
still be a real, if currently unencountered, gap of the same shape.

**Recommended resolution:** none needed against the spec pack itself for the sanitization half — that
was this piece's own implementation defect, now fixed. For the three scope narrowings: `08` §8.11.6's
table is the finished system's target, not a claim that one small piece must reach it in full; each
gap is named at its own generator and can be picked up as its own future piece without changing this
one's public surface (the return shape, `GeneratedDiagram`, does not preclude a richer implementation
later).

**Verify-round addendum: the sanitization fix itself introduced a display-identity regression in
`sequenceDiagram` output, found and fixed without a third round.** The first version of the fix
sanitized participant ids for use as Mermaid identifiers but left them to double as the *displayed*
name too — Mermaid's implicit participant declaration shows the identifier itself on screen, so a
participant named `end` (sanitized to `n_end` to parse at all) displayed as "n_end," not "end": the
exact "silent identity change with no signal" defect class the sanitization work exists to close,
resurfacing one layer up. Fixed by declaring every participant explicitly as `participant <sanitized>
as <real name>` — Mermaid's own alias mechanism — so the visible name is always the real one
regardless of what sanitization did to the identifier underneath it. `erDiagram` entities/attributes
have no equivalent alias mechanism (verified empirically: a bracket-quoted label after an entity id
parses without error but has no effect on the displayed name), so a real-world entity/attribute name
needing sanitization is the one case `renderErDiagram` genuinely cannot show its original spelling
for — documented on `ErEntity` directly as a Mermaid-grammar-imposed limitation, not a further
implementation gap to chase. The same verify round also found `renderErDiagram`'s `cardinality` field
was type-closed (`ErCardinality`) but never actually checked against `VALID_ER_CARDINALITIES` at
runtime, leaving the exact `runGenerator`/dynamic-dispatch boundary case the type existed to guard
against still open — fixed by validating it in `renderErDiagram` itself and raising `KB-002` for an
invalid value, the same code the shape checks already use.

## Q47 — P4's first draft never actually wired `diagram:transclusion` into its own stated entry point,
and its marker parser broke on ordinary Markdown formatting variance

**Conflict.** `08` §8.11.4 says a diverged transcluded block "is a lint error (`KB-031`), not a silent
inconsistency," and §8.11.7's own table lists `diagram:transclusion` as an **error**-severity gate
check, the same tier as `diagram:drift`. A first draft of `@forge/diagrams/drift` built
`parseTransclusionMarkers`/`checkTransclusion` as real, working, separately-tested functions, but
never called either one from `validateDiagrams` — the one entry point this milestone's own
`SPEC-QUESTIONS.md` Q43 names as "everything `@forge/diagrams` can check" — and `DiagramToValidate`
had no field even capable of carrying a Markdown document to check. A gauntlet critic found this by
reading the diff's own doc comments against its own behaviour: `@forge/diagrams/lint`'s own
`DiagramCheckId` doc comment, written in the same change, already claimed
"`diagram:drift`/`diagram:transclusion` are raised by `@forge/diagrams/drift`" — false the moment it
was written, since nothing raised the second half of that sentence.

Separately, and found by the same critic feeding the marker parser real, ordinary Markdown formatting
variance (not adversarial input): a first version anchored one large regex to the spec's own worked
example's *exact* line layout — one specific attribute order (`id=` before `src=`), no blank lines
between the marker comment and the fence, no trailing whitespace on either — and silently returned no
match at all (not an error, just `[]`) for any of: swapped attribute order, one blank line in either
gap, or trailing spaces on the marker/fence lines. It also compared fenced content and `.mmd` source
content without normalising internal line endings, so a document saved with CRLF (the ordinary Windows
default) reported real drift against a byte-identical LF `.mmd` file.

**Answer taken (proceeding):**

*Wiring:* `ValidateDiagramsOptions` gained a `markdownDocuments?: readonly string[]` field.
`validateDiagrams` resolves each document's own transclusion markers' `src` attribute against the
`diagrams` array's own `diagram.source`/`actualSource` pairs directly (the same relative path a
transclusion marker names is, by construction, a diagram's own committed `.mmd` path) — no second
source-lookup mechanism needed. A mismatch is reported as a `diagram:transclusion` finding whose
message is read from a never-thrown `ForgeError('KB-031', ...)` (the same "construct it only to read
`.message`" pattern `@forge/extensions/invariants`, M2 P8, already established), so the rendered text
can never drift from `08` §8.11.4's own registered code.

*Parser:* rewritten as a real line-based scan rather than one regex — an opening-marker line's
attributes are extracted independently of order, blank lines are tolerated between the marker and the
fence and between the fence and the closing marker, trailing whitespace is tolerated on every marker/
fence line, and every line is compared after normalising `\r\n`/`\r` to `\n` throughout (both in the
parser and in `checkTransclusion`'s own final comparison), so a CRLF-saved document is judged on its
real content, never on its line-ending convention alone.

*Batch resilience, found in the same round:* `validateDiagrams` originally let one entry's own
`parseDiagram`/`checkDrift` failure abort the whole call, discarding every other entry's already-
computed findings — a poor fit for a batch-lint entry point whose whole point is checking many
diagrams at once. `validateDiagrams` now returns `{ findings, errors }`: one entry's failure is caught
and recorded in `errors` (naming its `diagramId`), while every other entry's findings are still
returned.

**Recommended resolution:** none needed against the spec pack itself — `08` §8.11.4/§8.11.7 already
say what `diagram:transclusion` must do; the gap was entirely this piece's own first draft not yet
doing it, now fixed and covered by tests exercising the exact formatting variance and batch scenario
the critic found.

**Verify-round addendum: two more real gaps found by the verify pass's own further probing beyond the
original findings, fixed without a third round.** A quoted marker attribute (`id="DIAG-001"`, the
ordinary way anyone used to HTML-comment-shaped syntax reaches for, even though the spec's own worked
example writes it bare) parsed with the quote characters still attached to the value, silently
producing a `src` that could never match any real diagram's own `.mmd` path — the exact "ordinary
formatting variance, silent failure" shape this whole question already exists to close, just for a
variant the original round did not try. **Fixed** by accepting either a bare or a quoted (single- or
double-quoted) attribute value, stripping the quotes. Separately, `checkDrift` (`drift.ts`) — the
sibling comparison to `checkTransclusion` — normalised only trailing whitespace, not internal line
endings, meaning the exact CRLF false-drift defect already fixed for transclusion still existed one
file over, for the generator-drift comparison itself. **Fixed** the same way: line endings normalised
on the `actualSource` side before comparing.

## Q48 — `PLAN-M3.md`'s own P5 "Checks" text ("no `fetch(`, no `http://`/`https://` reference of any
kind — mechanically greppable") is unsatisfiable once the real, pinned `mermaid` bundle is inspected

**Conflict.** `08` §8.11.8 requires the HTML fallback path to "require... no network at render time";
before writing P5's code, `PLAN-M3.md`'s own draft elaborated that into a literal text-grep check:
the emitted HTML must contain no `<script src=`, no `fetch(`, no `http://`/`https://` substring
anywhere. Inspecting the actual pinned `mermaid@11.17.2` UMD build
(`node_modules/mermaid/dist/mermaid.min.js`, the file P5 inlines) before writing any code found this
check is impossible to satisfy literally: the file contains 81 occurrences of `http://`/`https://` —
SVG/XML namespace URIs (`http://www.w3.org/2000/svg`, `.../1999/xlink`, etc., which browsers require
verbatim and which are never fetched — they are opaque identifiers, not URLs a browser dereferences),
MIT-license attribution comments, and doc links embedded in Chevrotain's own parser-error message
strings — plus three literal `fetch(` substrings inside error-handling code paths not exercised by
ordinary diagram rendering. None of this is a real network call; all of it is inert vendored text.
Mangling the third-party bundle to remove these strings would be fragile (breaks on any dependency
bump) and actively harmful for the namespace URIs, which must stay byte-for-byte correct for the SVG
to render at all.

**Recommended resolution:** the "mechanically greppable" check was my own plan-time elaboration of
`08` §8.11.8, not spec text itself, so no spec ambiguity exists to record an answer against — the
check itself was simply wrong once checked against a real dependency rather than reasoned about in
the abstract, the same calibration failure this milestone has now hit five times (Q45, Q46, Q47, and
this one). **Answer taken (proceeding):** `PLAN-M3.md`'s P5 Checks section is corrected in place to
what's actually meaningful and actually verifiable:
1. **Static check, scoped to code this package itself authors**: the HTML *wrapper* `renderHtml`
   generates (everything outside the verbatim-inlined third-party bundle text) contains no
   `<script src=` and no hardcoded external URL of its own authorship.
2. **Behavioural check, in the headless-DOM render test**: `globalThis.fetch` and
   `XMLHttpRequest.prototype.send` are spied on before the rendered HTML's scripts execute in jsdom,
   and asserted never called during a real render pass across one example per diagram kind — this is
   what actually proves the zero-network claim for code this package does not author (the vendored
   Mermaid bundle), rather than a text grep that a license comment or a namespace URI trivially fails.
`BUNDLED_MERMAID_VERSION`/version pinning already satisfies `20` §20.6's "version-pinned and
integrity-checked": the dependency is pinned exact (no `^`/`~`) in `package.json` and the committed
lockfile records and verifies its integrity hash on every install, a repo-wide mechanism this one
piece does not need to reimplement.

## Q49 — `renderHtml`'s `RenderOptions.theme` has no field for `08` §8.11.8/§8.11.9's own third theming
requirement, "colour-blind-safe palette," and no spec document anywhere gives it concrete colours

**Conflict.** `08` §8.11.8 names three co-equal theming requirements in one sentence: "light/dark
pair, colour-blind-safe palette, consistent shape semantics." `RenderOptions.theme` implements only
the first (`{ light: string; dark: string }`, two Mermaid built-in theme *names*) and the legend
option implements the third; a gauntlet critic found the second has no implementation and no
acknowledgment anywhere in the code, even though `types.ts`'s own doc comment quotes §8.11.9's
worked config (`theme: { light: neutral, dark: dark, palette: colorblind-safe }`) — silently dropping
the one field it quotes. Searched the whole spec pack for concrete values to implement against
(`grep -rn "colour-blind\|colorblind\|palette" specs/*.md`): `04` §~261 states the same principle for
the TUI's own colours ("chosen to be distinguishable under common colour-blindness types") but, like
`08`, gives no actual hex/RGB values anywhere. Mermaid's own built-in theme names
(`default`/`neutral`/`dark`/`forest`/`base`) include nothing literally named or documented as
colour-blind-safe either.

**Recommended resolution:** implementing this for real requires a concrete palette (a set of actual
colours), which does not exist anywhere in the spec pack to implement against — inventing one here
would not be "implementing the spec as written," it would be inventing a spec. `08` §8.11.9 itself
frames `palette: colorblind-safe` as a *project style-profile* config value under customization
surface **C16** (`15` §15.1), which layers/resolves project-wide style profiles at a level well above
one rendering primitive that takes a diagram source string and, optionally, two already-resolved
theme names. **Answer taken (proceeding):** `RenderOptions.theme` stays exactly `{ light: string;
dark: string }` — this piece's job is to render *given* a resolved theme, not to define what
"colour-blind-safe" concretely means or resolve a project's style profile into one. A future C16
implementation is the one that should translate a project's `palette: colorblind-safe` setting into
either a real Mermaid built-in theme name or a concrete `themeVariables` override object, and pass the
result in through this same `theme` field — nothing about today's narrow shape blocks that. `types.ts`
is corrected to say this explicitly rather than silently truncating the config shape it quotes.

## Q50 — Closing `SPEC-QUESTIONS.md` Q29's second deferred point: a real on-disk shape for a
populated `collection: true` KB file (`risks.md`, `assumptions.md`, `open-questions.md`,
`kb/delivery/environments.md`)

**Conflict, continuing Q29.** `08` §8.2 calls `risks.md`/`assumptions.md`/`open-questions.md`
"registers" but gives no worked example of a populated file's actual body once it holds more than one
entry; Q29 (M1, `IdAllocator`) hit the same gap and explicitly deferred it — "state a collection
file's real on-disk shape once ... so ... whatever later piece writes a new entry into one of these
files has an actual format to target instead of each independently guessing." `parseKbTree` (this
piece) is that later piece: it has to actually read these four files (all four are under `08` §8.2's
own `docs/forge/kb/**` tree — `environments.md` is at `kb/delivery/environments.md`, matching the
registry's `Environment` row exactly, alongside `Risk`/`Assumption`/`OpenQuestion`), and
`@forge/core/artifacts`'s existing `ArtifactDocument`/`splitFrontMatter` — the parser `PLAN-M3.md`'s
own P6 mandate says to reuse — throws `CFG-005`/`CFG-006` on any file with no `---`-delimited front
matter at all, so "no front matter, just a table" is not an option compatible with existing tooling
without a second, bespoke parser this piece has no mandate to build.

Searched the spec pack for any worked example of *multiple* Risk/Assumption/OpenQuestion/Environment-
shaped records written together in one place. Found exactly one: `05` §5.6's `HandoffRecord` example
embeds one assumption as `assumptions: [ { id: ASM-004, text: ..., confidence: ..., validate_by: ... }
]` — a YAML list of the exact same entry shape `assumptionSchema` already validates, nested under a
plain key in a document's front matter. This is also the identical shape this same codebase already
uses for `changelog` (`baseFrontMatterShape`'s `changelog: [{ revision, date, by, summary }]`) — a
list of structured objects living directly in a document's front matter is not a new pattern being
invented for this decision, it is the one already in force everywhere else in the schema layer.

**Answer taken (proceeding):** each of the four files gets a thin front-matter-only wrapper schema
(`@forge/schemas/artifacts/collection-file.ts`, since these are front-matter *shapes* like every
other artifact schema, not KB-specific logic — `@forge/kb` reuses them exactly as it reuses
`adrSchema`/`diagramSchema`, per this piece's own mandate to add no schema `@forge/kb` doesn't have
to): `{ type: '<Risk|Assumption|OpenQuestion|Environment>' (literal), schemaVersion: number }` plus
one array field holding that type's own already-built entry schema — `risks: Risk[]`,
`assumptions: Assumption[]`, `open_questions: OpenQuestion[]` (snake_case, matching every other
multi-word front-matter key in the spec pack: `superseded_by`, `review_by`, `blast_radius`), and
`environments: Environment[]`. No `id` field at the wrapper level (a collection file names many ids,
not one, so `checkIdMatchesRegisteredType`-style single-id checking does not apply — the same
reasoning `entry-id.ts` already gives for why entry schemas themselves skip `baseFrontMatterShape`).
`schemaVersion` is kept (unlike a bare `id`) because `@forge/schemas`'s migration registry
(`packages/schemas/src/migrations/`) is keyed by `(ArtifactTypeId, schemaVersion)` uniformly across
every registered type, `Risk`/`Assumption`/`OpenQuestion`/`Environment` included — a collection file
with no `schemaVersion` would be unmigratable by the very infrastructure this repo already built for
every other type. The body (after the front matter) is left as free-form, unparsed prose, exactly like
`ArtifactDocument.body` already treats every artifact's body — `08` never states a required body
structure for a register the way it does for a `knowledge` entry's `## Statement`/`## Rationale`/etc.,
so none is invented.

**Recommended resolution:** state this shape once, normatively, in `08` §8.2 or `18` §18.7 (a `Risk[]`-
shaped worked example next to `risks.md`'s row would settle it beyond any doubt). The same shape is
the recommended answer for the two `collection: true` types P6 does not touch — `Waiver`
(`reports/waivers.md`) and `HandoffRecord` (`reports/handoffs.md`), both outside `docs/forge/kb/**`
and out of this milestone's scope — though `05` §5.6's own `HandoffRecord` worked example is a flat,
single-record document, in real tension with `18` §18.7 marking `HandoffRecord` itself `collection:
true` over one shared file; that specific tension is left unresolved here since neither file is part
of the KB tree this piece parses, and revisiting it belongs to whichever later piece actually builds
`HandoffRecord`'s own read/write path.

**Critic-round addendum: the first version dropped the entire `18` §18.6 base, not just `id`, fixed.**
A gauntlet critic found the first version of these four schemas omitted `title`/`status`/`created`/
`updated`/`revision`/`author`/`changelog` alongside `id`, with no stated reason beyond the one given
for `id` itself — and, being `.strict()`, actively rejected a compliant author who tracked who last
touched the register and when, something every sibling schema in the registry (`adrSchema`,
`diagramSchema`) already supports. **Fixed** by building from `baseFrontMatterShape.omit({ id: true
})` instead of a bare `z.object({...})` — every other base field is kept, only `id` (which genuinely
does not apply to a many-ids file) is dropped. Separately noted, not fixed (deliberately deferred, see
`collection-file.ts`'s own doc comment): two entries in the same file sharing one id is not caught at
this schema level — cross-entry uniqueness is a project-wide invariant (`18` §18.8: ids "never
reused") that belongs to the KB linter (`08` §8.7, `PLAN-M3.md` P10), not a single file's schema.

## Q51 — `kbEntrySchema`'s `section`→id-abbreviation mapping, and where `glossary.md`/`index.md` fit
`08` §8.3's own `type:` enum

**Gap, not a conflict.** `kbEntrySchema` needs to validate that a `KB-{SECTION}-####` id's own
embedded token agrees with its `section:` field (`PLAN-M3.md` P6's own Check: "a `KB-{SECTION}-####`
id in a section that does not match its own file's directory ... is a distinct, named validation
failure"). Grepping every `KB-[A-Z]+-\d+` occurrence across the whole spec pack finds real evidence
for four of `08` §8.2's eight named subdirectories: `product`→`PROD` (`KB-PROD-0001`,
`KB-PROD-0009`), `architecture`→`ARCH` (`KB-ARCH-0007`, three occurrences), `data`→`DATA`
(`KB-DATA-0001`, `-0003`, `-0011`), `constraints`→`CON` (`KB-CON-0003`, three letters, not four —
confirming this is a hand-chosen abbreviation table, not a fixed-width rule I could derive
mechanically). No spec-pack occurrence exists for the other four subdirectories (`domain`,
`delivery`, `ops`, `engineering`) or for the KB root's own two special files, `glossary.md` and
`index.md`.

**Answer taken (proceeding):** completed the table with the same "short, human-legible, no fixed
width" character the four confirmed entries already show, choosing the least ambiguous short form for
each: `domain`→`DOM`, `delivery`→`DELIV`, `ops`→`OPS`, `engineering`→`ENG`, `glossary`→`GLOSS`
(`glossary` treated as its own root-level pseudo-section — see below). Flagged explicitly in
`kbEntrySchema`'s own source as which four entries are spec-confirmed and which five are this piece's
own reasonable, but invented, choice — a maintainer correcting any of the five to match a future
spec-stated value changes one table entry, not the check's shape.

Two related scope decisions, made at the same time:
- **`glossary.md`** is one whole `kbEntrySchema` document (`type: 'glossary'`, `section: 'glossary'`,
  its own `KB-GLOSS-####` id), not a `collection: true`-style file holding many separately-validated
  term records — `08` §8.3's own `type:` enum lists `glossary` as one value a *generic* KB entry can
  take, the same schema `knowledge` entries use, and nothing in the spec pack gives field names for an
  individual glossary term the way it does for a Risk/Assumption/OpenQuestion/Environment row, so none
  are invented. `glossary.md`'s actual term list ("term → definition → source") lives in the entry's
  free-form Markdown body, exactly like every other artifact body — unparsed, untyped, same as
  `ArtifactDocument.body` already treats every other file's body.
- **`index.md`** is out of scope for this piece. `08` §8.2 calls it "generated: table of contents +
  counts + health" — derived output, not hand-authored content with front matter to validate — and
  `PLAN-M3.md` P6's own Surface never named it. `parseKbTree` does not attempt to parse it; generating
  it is a later piece's concern (nothing in this milestone's remaining P7–P10 currently claims it
  either — worth flagging at M3's own close if it still has no owner).

**Recommended resolution:** state the full nine-entry `section`→id-abbreviation table once,
normatively, in `08` §8.2 or §8.3 (the same fix Q50 asks for the collection-file shape) so the five
uninvented entries here have a real source to defer to.

## Q52 — P7's own `KbWriter`/`KbProposal` plan surface is under-specified in five separate ways, found
only by actually trying to implement `08` §8.6 against it

`08` §8.6 itself is three short paragraphs: two write paths, four `KbWriter` invariants ("schema-valid
or reject," "ids allocated centrally, monotonically, never reused," "every write records sources,"
"writes serialised; concurrent proposals to the same entry queued, the second rebased onto the first,
with a conflict escalation if the statement changed"). `PLAN-M3.md`'s own P7 draft elaborated this into
a `KbWriter`/`KbProposal` surface, but five real gaps surfaced only once actually building against it
— none answerable by re-reading §8.6 again, since it gives no worked example of a proposal, a diff, or
a rebase.

**1. Where does a brand-new KB entry's file live?** `08` §8.2 names fixed, curated files per section
(`architecture-spec.md`, `patterns.md`, ...) but states no rule for a genuinely new topic not already
on that list. **Answer taken:** `KbEntryInput` (the input to `KbWriter.write`) includes an explicit
`path` field (the destination's relative path under the KB root) that the caller supplies — `KbWriter`
does not invent a slugging/naming convention with no spec source to derive one from.

**2. "Checks contradictions" (§8.6's own words for the direct-write path) names §8.7's KB-linter
algorithm, which does not exist until `PLAN-M3.md` P10.** `PLAN-M3.md`'s own P7 Checks list never
actually tests a contradiction rejection, and P10 is not in P7's "Depends on" line (nor could it be —
P10 is built after P7). **Answer taken:** `KbWriter.write` in this piece does not perform contradiction
detection at all; the `08` §8.6 sentence is read as describing the *system's* eventual full behaviour
once P10 exists, not a requirement this one piece must satisfy standalone. A future integration point
(P10 calling into this writer, or this writer calling into P10's checker) is left for whichever piece
actually wires the two together.

**3. No spec-given format for `KbProposal.diff`, and the literal `diff: string` surface cannot support
"rebase" or "conflict if the statement changed" without inventing a full patch-application engine no
part of this codebase has any precedent for.** A generic multi-hunk unified-diff parser/applier is a
large, novel, error-prone undertaking to hand-roll with zero spec-given examples to validate against,
and a naive whole-file-fingerprint rebase check would conflict on *every* concurrent proposal pair
regardless of whether they touch the same content (defeating "the second is rebased onto the first" as
the normal, successful case). **Answer taken:** `KbProposal` is redesigned as a structured, single-
field change rather than a raw text diff: `{ targetId, field: 'statement' | 'rationale' |
'implications' | 'verification', baseValue, proposedValue, rationale, sources }` — `field` is one of
`08` §8.3's own four fixed body sections, the only place the spec text itself specifically calls out a
"statement changed" conflict for. Rebase is optimistic-concurrency-control on that one field's current
value: if the target's current `field` content still equals `baseValue` when the proposal's turn comes,
`proposedValue` is applied; if not (someone else's already-applied proposal changed it), that is the
conflict, reported rather than force-merged. A rendered `diff` string (`- baseValue\n+ proposedValue`)
is still produced for a human/audit reader, satisfying §8.6's own loose "a diff, rationale, and target"
framing, but the field-level structure — not a parsed diff — is what the code actually reasons about.
Proposals targeting an arbitrary front-matter field (not one of the four body sections) are out of
scope for this piece — a real, but narrower, gap than a fully general multi-field diff engine, and one
with no spec-given example to build the wider version against either.

**4. `propose`'s own literal return type, `Promise<KbProposal>`, cannot report whether a proposal
applied or conflicted** — the one distinction its own Check list requires observing. **Answer taken:**
corrected to `Promise<KbProposalOutcome>`, a tagged union of `{ status: 'applied', proposal, diff }`
and `{ status: 'conflict', proposal, currentValue }`.

**5. No event-log implementation exists anywhere in the codebase yet** (`grep` for `EventLog`/
`appendEvent`/`event.log` across `packages/*/src` finds only forward references — a governance flag
name, a comment pointing at "the run's own append-only writer" — never a real writer). Building a
general, run-wide, cross-subsystem event bus is a much larger piece than P7 (closer to the not-yet-
built engine/runtime layer) and has no spec section describing its schema. **Answer taken:** `KbWriter`
keeps its own small, KB-scoped append-only log at `.forge/state/kb-events.jsonl` (one JSON object per
line: `{ at, kind: 'write' | 'propose-applied' | 'propose-conflict', entryId, section }`), via
`ProjectPaths.resolveState` — satisfying "appends an event" for this piece's own writes without
building infrastructure no spec page yet describes.

**Recommended resolution:** a worked `KbProposal` example next to `08` §8.6 (even one sentence, one
field, one before/after value) would settle (3) and (4) beyond any doubt; §8.6/§8.7 stating explicitly
that write-time contradiction checking is optional until the linter exists would settle (2); a event-
log schema section anywhere in the spec pack would settle (5).

**Critic-round addendum: a "process-wide" queue was actually per-instance, and two sibling bugs in
`replaceSectionValue`, fixed.** A gauntlet critic found `KbWriter`'s own first-draft doc comment
claimed its serialisation queue was "process-wide" when it was really a private field on each
`KbWriter` object — two independently-constructed writers against the same project raced for real
(double-allocated ids, lost event-log lines). **Fixed** by a module-level queue keyed by the
project's own resolved root path, shared by every instance; fixing this surfaced a second, related
gap (each instance's own `KbIdAllocator` caching a now-stale view across sibling instances), fixed by
forcing a fresh scan before every allocation. Separately, the critic found `replaceSectionValue`
dropped the blank line before the next section's heading and that `doPropose`'s own unconditional
trailing `\n` compounded into ever-more stray blank lines across repeated edits to any non-last
section — and that the identical unconditional-`\n` bug existed a second time, in `doWrite`'s own
file-creation template. Both **fixed** the same way: a shared `withTrailingNewline` helper that adds
one only when the text doesn't already have one. Also fixed in the same round: `write()` silently
overwrote an existing file at the same path (now `KB-009`); `propose()` silently picked the first of
several files claiming the same id with no ambiguity signal (now `KB-011`, though see the verify-round
addendum below for a residual gap in this check); a schema-validation failure burned the id
`KbIdAllocator` had already allocated for it (now pre-validated against a placeholder id before ever
allocating a real one).

**Verify-round addendum: a narrower duplicate-id gap found in the KB-011 fix itself, documented rather
than chased further.** `doPropose`'s duplicate check only scans `tree.entries` — files that fully pass
`parseKbTree`'s own validation. A second file claiming the same id but *also* failing some unrelated
check (e.g. filed under a directory that doesn't match its own `section` field) lands in `tree.errors`
instead and is invisible to this check. This is a narrower instance of the same hazard KB-011 already
exists for, and — like Q50's own cross-entry-in-one-file duplicate-id gap — is left to the KB linter
(`08` §8.7, `PLAN-M3.md` P10)'s own project-wide integrity scan rather than reinvented here; documented
in `writer.ts`'s own comment at the check site.

## Q53 — P8's derived index: `hash`'s definition, which `links.kind` values this piece can actually
populate, and `expand`'s exact set semantics

`08` §8.5's own table gives each of the five derived-index tables' *column names* but not enough to
implement three of them mechanically, found while building `rebuildIndex` against `KbTree` (P6) alone.

**1. `entries.hash`** — no definition given anywhere. **Answer taken:** a SHA-256 hash of the entry's
own front matter plus body (its full on-disk content, effectively), mirroring the same hashing pattern
already established for `@forge/core/ids`'s `IdIndex.validityHash`/this milestone's own
`KbIdIndex.validityHash` — a plain content fingerprint, not consulted internally by anything this piece
builds (`rebuildIndex` always fully rebuilds, never diffs against a stored hash), stored for a future
piece's own change-detection use.

**2. `links.kind`: `related`, `supersedes`, `applies_to`, `derived_from`, `cites`.** Only the first
three map to a field `kbEntrySchema`/`adrSchema`/`diagramSchema` (P6, M1) actually has today
(`related`, `supersedes`, `applies_to` — plus `diagrams`, which this piece also links). No current
schema has anything resembling `derived_from` or `cites`. **Answer taken:** `rebuildIndex` populates
`links` for the four kinds it has real data for and leaves `derived_from`/`cites` unpopulated — not
invented fields on `kbEntrySchema` (P6 is closed; adding fields there without a spec source would
repeat the exact mistake this milestone's own discipline exists to avoid), and not fabricated link data
with no source. A future piece with an actual source for either (code-derivation tracking; a citation
extractor over body prose) populates them through this same table.

**3. `symbols` and `usage` are both described as populated by subsystems that do not exist yet**
("brownfield ingestion and... code-writing steps" for `symbols`; "which run/step" for `usage` — the
engine/runtime layer, not yet built at all). **Answer taken:** both tables exist in the real schema (the
two SQLite backends' own `CREATE TABLE` statements, and the JSON backend's own object shape) — `08`
§8.5 says the derived index maintains five tables, and it does — but `KbIndexBackend`'s own interface
(from `PLAN-M3.md`'s own draft) has no method touching either one, and `rebuildIndex` leaves both empty:
`KbTree` carries no run/step or code-symbol data to populate them from. Not a narrowing this piece
invented — the interface it was handed already excludes them.

**4. `expand(ids, hops)`'s exact return-set semantics** — `PLAN-M3.md`'s own Check text states the two
endpoints ("`hops: 0` returns `ids` unchanged"; "`hops: 1` returns exactly the entries linked to `ids`
and nothing two hops away") but not explicitly whether `hops: 1`'s result *also* still contains the
original `ids` themselves alongside what they link to. **Answer taken:** `expand` returns the full
union — the original `ids` plus everything reachable within `hops` steps — matching what "expand [a
set]" means literally and satisfying both stated endpoints (`hops: 0` is trivially the union at zero
steps; `hops: 1`'s result is still, truthfully, "the entries linked to `ids`," just not *only* those).

**Also, a refactor, not a design decision:** extracting a KB entry body's named section content
(`## Statement`/`## Rationale`/etc.) was `writer.ts`'s own private logic (P7); `terms` (FTS5 over
statement + rationale + title) needs the identical extraction. Moved to a shared
`@forge/kb/schema` module (`body-sections.ts`) both P7's `KbWriter` and this piece's `rebuildIndex` call,
rather than duplicating the heading-matching regex a second time — `KbWriter`'s own P7 tests are
re-run unchanged after the move to confirm no behaviour changed.

**Recommended resolution:** none of these four gaps needs a spec correction — `08` §8.5's own table is
reasonably read as "the eventual full shape once every subsystem is built," and this piece honestly
implements the slice of it `KbTree` alone can support, leaving the rest for whichever future piece
actually has the missing data.

**5. `KbIndexBackend.upsertEntry(row: EntryRow)` has no way to feed the `terms` table's own required
content.** `08` §8.5's `terms` row is "FTS5 index over statement + rationale + title" — but `EntryRow`,
per the same table's own `entries` column list (`id, type, section, title, path, status, confidence,
updated, hash`), carries `title` but neither `statement` nor `rationale` text at all, and the interface
has no second method (an `upsertTerms`, say) to supply them. **Answer taken:** `EntryRow` gains two
required fields, `statement: string` and `rationale: string` — required (not optional) so every
backend's own `upsertEntry` implementation can unconditionally feed `terms` without a branch for
"this row doesn't have them," with `''` passed for a document kind that has no such body section at
all (an ADR, a Diagram, a Runbook — `08` §8.3's Statement/Rationale sections are specific to the
generic `knowledge`/`glossary` KB entry `kbEntrySchema` shapes, per Q53's point 3 same reasoning: an
honest "not applicable" sentinel, not fabricated text). The same `''` sentinel is used for
`section`/`confidence` on the same non-`kb-entry` document kinds, for the identical reason — `adrSchema`/
`diagramSchema`/`runbookSchema` (M1) have neither field.

**6. `PLAN-M3.md`'s own Check text asserts BM25/FTS5 for "the two SQLite backends," but the installed
Node's own bundled `node:sqlite` does not actually include the FTS5 extension.** Verified directly,
before writing the `node:sqlite` backend: `db.exec('CREATE VIRTUAL TABLE t USING fts5(...)')` against a
real `node:sqlite` `DatabaseSync` (Node 22.14.0) throws `no such module: fts5`, while the identical
statement against `better-sqlite3@13.0.3` succeeds and returns real BM25 scores — the two "SQLite
backends" are not, in fact, equally capable, because Node's own build of SQLite omits an extension
`better-sqlite3`'s build includes. This is a build-time compilation choice in Node itself, not
something a caller can enable at runtime, and could in principle change in a future Node version, but
is the real, current, verified state. **Answer taken:** the `node:sqlite` backend uses the identical
deterministic term-overlap scoring the JSON fallback uses (a shared, pure JS function scoring against
each row's own `title`/`statement`/`rationale` text, applied client-side after a plain `SELECT`), not
real FTS5/BM25 — its `terms` table is a plain table, not a virtual FTS5 one. Only the `better-sqlite3`
backend gets real BM25. The plan's own "BM25 for the two SQLite backends" line was wrong the moment it
was checked against the real, installed `node:sqlite`, not a design choice — corrected here, in the
same spirit as this milestone's other "verify against the real tool before trusting the plan" findings
(Q45, Q48).

**7. `rebuildIndex`'s own doc line ("clears and repopulates every table") names a capability
`KbIndexBackend` has no method for.** With only `upsertEntry`/`upsertLinks`/`search`/`expand`/`close`,
nothing in the interface can actually clear a table `rebuildIndex` is handed an already-open backend
for. **Answer taken:** `KbIndexBackend` gains `clear(): void`, clearing every table (`entries`,
`links`, `terms`, and the two tables this piece's own interface never populates, `symbols`/`usage` —
clearing what it does not itself write is still correct, since a stale row from a *previous* rebuild,
written by a future piece that does populate them, must not survive a rebuild it wasn't part of any
more than a stale `entries` row would).

## Q54 — P9's `PinnedCore` is missing one of `05` §5.4's own seven pinned-core items, and three of its
remaining fields have no buildable data source as originally drafted

`05` §5.4 point 1 names pinned core as: "project identity, level, glossary, active constraints, ADR
index (one-line each), current stage goal, coding standards" — seven items. `PLAN-M3.md`'s own P9
draft named six, omitting "active constraints" entirely. Building the other six against `KbTree`
(P6)/`KbIndexBackend` (P8) alone — `buildContextPack`'s own drafted signature takes no `ProjectPaths`
and cannot read arbitrary files — found two more real gaps: `adrIndex`'s natural source, `08` §8.2's
`decisions/index.md`, is explicitly "generated" and out of scope for `parseKbTree` (`SPEC-QUESTIONS.md`
Q51) — no piece in this milestone produces it — and nothing else names where "active constraints" data
comes from either.

**Answer taken (proceeding):**
1. `PinnedCore` gains a `constraints: string` field, closing the omission.
2. `adrIndex` and `constraints` are both *computed* directly from `tree.entries`, not read from a
   generated file that does not exist: `adrIndex` is one line per `kind: 'adr'` entry
   (`{id}: {title} ({status})`, sorted by id — the identical "one-line each" `05` §5.4 itself asks
   for), and `constraints` is one line per `kind: 'kb-entry'` entry whose `section` is `'constraints'`
   and `status` is `'active'` (`{id}: {title}`, sorted by id) — this is the actual source data a
   future "regenerate `index.md`" piece would use anyway, computed fresh rather than depending on a
   stale or absent artifact.
3. `glossary` and `codingStandards` are each one real `kb-entry`'s own body text — `glossary.md`
   (`type: glossary`, per `SPEC-QUESTIONS.md` Q51) and `engineering/standards.md` respectively, found
   by path within `tree.entries`. `projectIdentity`/`level`/`stageGoal` remain override-only (config
   and run-state this package cannot depend on) exactly as `PLAN-M3.md` already specified.
4. The merge of lexical search hits (P8's `backend.search`) and 1-hop graph-expansion candidates
   (P8's `backend.expand`, called only on `declaredInputIds` — "not of every retrieved entry," per
   this piece's own Check) into one ranked `retrieved` list is not fully specified by either `05`
   §5.4 or `08` §8.5: a graph-expansion-only candidate (not already a lexical hit) is assigned score
   `0` — below every real lexical hit, since `08` §8.5 places lexical (step 2) before graph expansion
   (step 3) — and the combined list is sorted by score descending, ties broken by more-recent
   `updated` first (`08` §8.5's own "filtered by... recency" for graph expansion), then by `id` (byte
   order, never `localeCompare`) for full determinism. The budget cut is a simple sequential cutoff in
   this sorted order, not a knapsack optimisation: the first candidate that would exceed
   `budgetTokens` stops inclusion entirely, matching "drops the lowest-ranked retrieved entries first."
5. `manifest.ids`/`manifest.tokenCounts` cover `declaredInputs` and `retrieved` only — real,
   individually-addressable KB ids. `pinnedCore`'s own four KB-derived fields are aggregated summaries
   (an ADR index line, a filtered constraints list) with no single id of their own in the output
   shape, so they are not represented as manifest entries.

**Recommended resolution:** state all seven pinned-core items in one place (`05` §5.4 and `08` §8.2's
own layout table already imply `constraints/`'s four files are the "active constraints" source, but
neither says so explicitly), and give `decisions/index.md`'s own generation a real owner somewhere in
the build plan so a future piece does not rediscover the same "no such file exists yet" gap for the
one piece that actually needs to write it.

**Critic-round addendum: a duplicate-id budget bug, a `NaN`-budget bug, and a latent `NaN`-score sort
risk, fixed; the budget-drop policy itself confirmed, not changed.** A gauntlet critic found
`buildContextPack` never deduplicated `request.declaredInputIds` — passing the same id twice produced
two identical `declaredInputs` entries, double-charged the token budget for one document's content,
and left `manifest.ids` (length 2) disagreeing with `manifest.tokenCounts`'s own key count (1, since a
plain object cannot hold a duplicate key). **Fixed** by deduplicating `declaredInputIds` via
`[...new Set(...)]` (preserving first-occurrence order) before anything else in the function runs. The
critic also found `budgetTokens: NaN` silently disabled the entire budget: every comparison against
`NaN` is `false` in JS, so the retrieval loop's own `usedTokens + tokens > budgetTokens` check never
breaks and every candidate is admitted regardless of size — the one direction ("fails unsafe: unbounded
inclusion") worse than a negative budget's own already-safe "fails to empty." **Fixed** by rejecting a
`NaN` budget explicitly (new code `KB-013`'s sibling, `KB-014`) rather than letting it silently
misbehave — matching this piece's own existing stance that a caller mistake gets a named, actionable
error rather than quiet wrong output. Separately, the critic found `rankedCandidates`'s own sort
comparator has no guard against a `NaN` score, which no built-in `KbIndexBackend` produces today
(verified: `scoreByTermOverlap` only ever returns a positive integer count, and real BM25 is always a
finite number) but which the interface itself does not forbid from a future backend — **fixed**
defensively by normalizing a non-finite `search()` score to `0` (the same score already given to a
graph-expansion-only candidate) at the one place scores enter `scoreById`, so the sort's own three-way
tie-break stays a genuine, deterministic total order regardless of what a backend returns. Finally, the
critic separately flagged (as "major, but the classification hinges on which reading of the spec text
is intended") that a large, top-ranked candidate blocks every smaller, lower-ranked candidate that
would otherwise fit, since the retrieval loop `break`s on the first candidate that doesn't fit rather
than skipping it and trying smaller ones. This is not a new gap: it is exactly this Q's own point 4,
above, stated before any of this piece's code existed ("the first candidate that would exceed
`budgetTokens` stops inclusion entirely, matching 'drops the lowest-ranked retrieved entries first'").
Re-examined against the critic's own adversarial case and left **unchanged**: keeping the retrieved set
as a rank-ordered prefix of `candidates` is the literal reading of "drop the lowest-ranked entries
first," and the alternative (skip an oversized entry, keep trying smaller lower-ranked ones) can end up
keeping a lower-ranked entry while dropping a higher-ranked one — the opposite of what the spec text
asks for. `build-context-pack.ts`'s own comment at the loop was strengthened to name this reasoning
explicitly, and a new regression test (`build-context-pack.test.ts`) now locks in the exact scenario
the critic used to demonstrate it, so the behaviour reads as chosen, not overlooked.

**Verify-round addendum: all four critic-round fixes confirmed independently; one new gap found and
fixed, one remedy string corrected for accuracy.** A verify pass re-derived each of the four fixes
above from first principles (its own adversarial scripts, not just re-running the existing tests) and
confirmed all four hold: deduplication preserves first-occurrence order against a 15-element scrambled
list touching every fixture id; `KB-014` fires for both a literal `NaN` and an arithmetic-derived one
(`0/0`, `Infinity - Infinity`), and does *not* fire for a negative or `Infinity` budget (both still
"fail safe/fine," matching the earlier round's own finding); the prefix-drop regression test genuinely
exercises a real oversized-but-top-ranked candidate blocking a real smaller-but-lower-ranked one;
mixed `NaN`/`Infinity`/`-Infinity` backend scores all normalize to `0` and sort deterministically. It
also found one new gap: `pinnedCoreOverrides` is typed `Partial<PinnedCore>`, which — despite
`glossary`/`constraints`/`adrIndex`/`codingStandards` all being *required* `string` fields on
`PinnedCore` itself — still permits a caller to write e.g. `{ glossary: undefined }` explicitly (TS's
`Partial` makes a field optional, and an optional field always accepts `undefined`). `pinned-core.ts`'s
own `{ ...computed, ...overrides }` spread let that explicit `undefined` clobber the real computed
value, so `pinnedCore.glossary` could be genuinely `undefined` at runtime despite its required-`string`
type — which then threw a raw, un-actionable `TypeError` inside `estimateTokens` rather than this
package's own `ForgeError` discipline. **Fixed** by a small `definedOr` helper that keeps the computed
value whenever the override for that specific field is `undefined` (present-but-`undefined`, or simply
absent) — applied only to the four required-`string` fields; `projectIdentity`/`level`/`stageGoal`
need no such guard since `PinnedCore` already types those three optional, so `undefined` is a
legitimate value for them regardless of where it came from. Separately, the verify pass noted `KB-014`'s
own remedy said "non-negative token budget," which oversells what the check actually enforces (a
negative budget is accepted, not rejected) — **fixed** by rewording the remedy to name exactly the one
condition that is rejected (`NaN`).

## Q56 — P10's own plan draft has six real gaps: `components.md` has no on-disk shape anywhere in the
spec pack, ADRs have no field linking them to the components/entries they concern, `checkContradictions`'
own drafted signature cannot express the ADR-status rules it is asked to implement, `lintKb`'s drafted
`diagramsBackend` parameter cannot actually be satisfied by data `KbTree` carries, "referenced IDs
exist" does not scope cleanly to `applies_to`, and "glossary drift" has no mechanical definition

`08` §8.7's own rule table and `§8.2`'s directory layout describe every one of these checks, but building
`lintKb` against `KbTree` (P6) and `KbIndexBackend` (P8) alone — the only inputs this piece's own plan
draft names — found six real gaps, all discovered before writing the check they'd block, the same
"correct `PLAN-M3.md` before/while building rather than build against a known-wrong draft" discipline
already used throughout this milestone.

1. **`components.md`'s on-disk shape.** `08` §8.2's directory table describes it only in prose
   ("component inventory: responsibility, owner, deps, failure modes"); `18` §18.7's own 21-type
   registry never registers a `Component` type at all — this is the identical shape of gap `SPEC-
   QUESTIONS.md` Q29/Q50 already closed for `risks.md`/`assumptions.md`/`open-questions.md`/
   `environments.md`, just never surfaced until this piece needed to enumerate components
   deterministically. `@forge/diagrams`' own `components-to-c4` generator (`PLAN-M3.md` P3) already
   settled the minimal shape one real, load-bearing consumer needs: `ComponentsToC4Input.components`
   is `{ id: string; label: string; dependsOn: readonly string[] }[]`. `components.md` gets a real
   schema matching those exact field names, extended with the two directory-table words that
   generator doesn't need (`responsibility`, `owner`) and one more the ADR-coverage/failure-mode intent
   implies (`failureModes: readonly string[]`) — defined locally in `@forge/kb/schema` (not
   `@forge/schemas`), since `Component` is not one of the 21 registered types and `KbEntry` itself
   already sets this precedent (a KB-specific type living in `@forge/kb`, not `@forge/schemas`).
   `id` is `component:<slug>` (the same tag format `applies_to`/`depicts` already use everywhere in
   this fixture), not a new `CMP-###` numbering scheme, so a component id is directly usable
   everywhere else that space is already referenced — no second id system, no mapping layer.
2. **"Every component in `components.md` has ≥1 owning ADR" needs a link `adrSchema` (M1) has no field
   for.** ADRs carry no `applies_to`, no `components`, nothing that names which components a decision
   concerns — `blast_radius: string[]` is free text with no tag-namespace convention, and adding a new
   field to a battle-tested M1 schema for one P10 check is a much bigger change than this rule needs.
   The fixture already models the actual bridge in practice: `KB-ARCH-0001` (a `kb-entry`) has both
   `applies_to: [component:api, component:db]` *and* `sources: [{ kind: 'decision', ref: 'ADR-0001' }]`
   — a KB entry is what actually connects a component to the ADR that decided about it. **A component
   has an owning ADR** when some KB entry names that component in its own `applies_to` *and* cites that
   ADR in its own `sources` (`kind: 'decision'`) — reusing two fields that already exist and are
   already populated this way in the real fixture, rather than inventing a third.
3. **The same KB-entry-as-bridge mechanism resolves two more rules for free, once accepted:** "two
   `accepted` ADRs in the same `category` + `applies_to` scope" (an ADR's own derived "scope" is the
   union of `applies_to` across every KB entry whose `sources` cites it) and "`confidence: low` entries
   used as inputs to accepted ADRs" (an ADR's own `related: string[]` — already a generic, unconstrained
   id list — names ids the ADR draws upon; a `related` id that resolves to a real `kb-entry` with
   `confidence: 'low'` is exactly that rule, with `related`'s own existing "this decision relates to X"
   meaning, no new field).
4. **`checkContradictions(entries: readonly KbEntry[])`'s own drafted signature cannot express the
   ADR-status rules `08` §8.7's own contradiction-detection paragraph asks the same function to cover**
   ("conflicting ADR statuses"; "two ADRs both `accepted`... without a supersession link") — `ADR` is
   not a `KbEntry`. Widened to `checkContradictions(kbEntries: readonly KbEntry[], adrs: readonly
   ADR[]): readonly KbFinding[]`, taking the two typed slices the two halves of the same check actually
   need, matching how every other multi-kind piece in this milestone (`rebuildIndex`, `buildContextPack`)
   already takes specific typed slices rather than one generic union.
5. **`lintKb`'s drafted `diagramsBackend: { validateDiagrams: typeof validateDiagrams }` parameter
   cannot be satisfied by anything `KbTree` actually carries.** `validateDiagrams` needs each diagram's
   real `.mmd` source text (`DiagramToValidate.actualSource`); `KbParsedEntry`'s `diagram`-kind value is
   the sidecar YAML alone (`source: architecture/views/containers.mmd`, a *path*, never read into the
   tree by `parseKbTree`) — there is no source text anywhere in `lintKb`'s own drafted inputs to hand
   `validateDiagrams`, and requiring `lintKb`'s own caller to read every `.mmd` file from disk just to
   call a "pure function over an already-parsed tree" breaks the same purity every other piece this
   milestone has kept (`buildContextPack` takes a tree, never touches the filesystem itself). **Answer
   taken:** `lintKb` drops the `diagramsBackend` parameter and becomes fully synchronous — it implements
   only the two `diagram:*` checks `SPEC-QUESTIONS.md` Q44 already assigned to `@forge/kb`
   (`diagram:required`, `diagram:adr-coverage`), computed directly from `tree.entries`. A caller wanting
   `08` §8.7's *full* `diagram:*` battery composes `validateDiagrams`'s own separately-computed
   `findings` (mapped `DiagramFinding → KbFinding`) alongside `lintKb`'s return value — the identical
   composition shape `PLAN-M3.md` P10's own Checks already describe for the LLM-semantic-contradiction
   case ("a caller composes one extra warning-severity `KbFinding` alongside `checkContradictions`' own
   output").
6. **"Referenced IDs exist (`related`, `supersedes`, `applies_to`)" does not scope cleanly across all
   three fields the way the table row groups them.** `related`/`supersedes` are unambiguously KB-tree
   cross-references (a `kb-entry` or `ADR` id) and are checked as such. `applies_to` is a different tag
   namespace entirely — `08` §8.11.7's own `diagram:refs` describes it as resolving to "a real
   component, datastore, entity or actor," a wider space than `components.md` alone models (no
   `datastore:`/`entity:`/`actor:` registry exists anywhere in this milestone). `lintKb` does **not**
   treat `applies_to` as a hard "id must exist" gate under this rule — that would mean inventing
   registries this milestone has no other reason to build. Its only real check against `applies_to` is
   the narrower, already-modelled one in points 2–3 above (component coverage via the KB-entry bridge).
7. **"Glossary drift: terms used in specs but absent from glossary" has no mechanical definition
   anywhere in the spec pack** — free-text NLP term-extraction is out of scope for a deterministic
   linter, and `lintKb`'s own inputs (`tree`, `capabilities`, `epics`) don't carry the full prose of
   `docs/forge/specs/` regardless. Narrowed to the one mechanical, zero-heuristic reading available:
   every backtick-quoted `` `term` `` occurrence in a `Capability`'s `statement`/`acceptance_summary` or
   an `Epic`'s `goal` (`specArtifacts`' own free-text fields) that has no case-insensitive match among
   `glossary.md`'s own defined terms is flagged — reusing the spec pack's *own* convention throughout
   this document for marking a word as vocabulary (backticks), rather than inventing a term-detection
   heuristic with no textual signal behind it.
8. **`diagram:required` ("taxonomy coverage per `08` §8.11.3 for the current level and gate") needs the
   project's own `level`, which lives in `.forge/config.yaml` — a file `lintKb`'s own drafted inputs
   (`tree`, `specArtifacts`, `now`) have no path to, and `08` §8.11.3's own taxonomy table has 17 rows,
   most gated on conditions no KB schema captures at all** ("when DDD is adopted," "every entity with
   >2 states," "every cross-boundary flow ≥2 hops" — none of these are fields anywhere in this
   milestone's schemas). **Answer taken:** `lintKb` gains one more caller-supplied parameter, `level:
   string` (the same "caller already has this, package doesn't go get it itself" shape `now` already
   uses) and implements only the two rows the taxonomy table itself makes fully mechanical — "System
   context" and "Container / deployable decomposition," both gated `L2+` at `G-Design` and both naming
   an exact, canonical `Lives in` path (`architecture/views/context.mmd`, `architecture/views/
   containers.mmd`) the check can look for directly among `tree.entries`' own diagram `source` values.
   The other 15 rows are not implemented — each depends on project content no schema in this milestone
   models (a threat model's existence, an entity's state count, a flow's hop count), and inventing
   fields to make them checkable is a much larger change than this piece's own scope.

**Recommended resolution:** register `Component` as `18` §18.7's 22nd type with a real on-disk shape
(closing this the same way Q50 closed the other four registers); give `adrSchema` an explicit field for
"components/entries this decision concerns" rather than leaving every consumer to reconstruct it via a
KB-entry bridge; and state plainly, next to `08` §8.7's own rule table, which package implements each
rule and what data it actually has to work with — the same clarification Q44 already gave for the three
`diagram:*` rules, needed here for the KB-only rules too.

**Critic-round addendum: five real gaps found and fixed — a missing `status: active` filter on the
KB-entry bridge, an unchecked `component:` namespace, a cross-kind blind spot, a missed inbound-link
source, and a genuine R10 (determinism) violation.** A gauntlet critic found `adrScope` (`kb-links.ts`)
applied no `status` filter to the KB entries it scans, unlike `checkAntonymTagConflicts`'s own identical
`status === 'active'` filter in the same feature — a single `deprecated` or `draft` KB entry citing an
accepted ADR was enough to silently satisfy "has an owning ADR" for whatever component it named, and,
separately, to trigger a false-positive `kb:contradiction` between two genuinely-independent accepted
ADRs whose only "overlap" ran through a never-vetted entry. **Fixed** by adding the identical filter to
`adrScope` itself, closing both call sites (`checkComponentCoverage`, `checkAdrScopeConflicts`) in one
place. Separately, the critic found `component.dependsOn` — unlike `related`/`supersedes`, which
legitimately reference ids outside this package's own visibility — names only ever the *same*
self-contained register `components.md` itself defines, so a `dependsOn` id naming a component that does
not exist in that same file was never checked at all; the narrower but identical gap exists for a KB
entry's own `applies_to` `component:`-prefixed tags. **Fixed** by a new check (`checkComponentReferences`,
reusing the existing `kb:dangling-ref` rule id, since it is the identical "referenced id exists" rule,
just scoped to the one namespace `components.md` now makes fully closed and checkable) — skipped
entirely, not "everything is dangling," when no `components.md` exists in the tree at all, since there is
then no registry to call anything wrong against. Third, `checkSupersessionStatusConsistency` was called
twice, once per kind (`kbEntries`, then `adrs`, separately) — since `supersedes` is a generic id list on
both schemas, a KB entry legitimately naming an ADR id there (or vice versa) was silently never checked,
because the same-kind-only `byId` map never had the other kind's ids in it. **Fixed** by calling it once
over the combined `[...kbEntries, ...adrs]` set, matching `checkSupersessionCycles`'s own pre-existing
cross-kind union for the identical reason. Fourth, `inboundLinkedIds` (orphan detection) never consulted
a `Diagram`'s own `depicts`/`explains` fields, both unrestricted id lists that can legitimately name a
KB entry or ADR — an entry a diagram genuinely explains or depicts, with no other inbound reference, was
still flagged `kb:orphan` despite a real reference existing. **Fixed** by including both fields. Fifth,
and most significant: `checkAntonymTagConflicts` and `checkAdrScopeConflicts` both iterate unordered
pairs from an array, and used whichever element happened to come first in that array as `entryId` and
as the first name in the finding's own message — for a genuinely symmetric relationship (two entries in
conflict with each other, neither more "primary" than the other), this meant the exact same logical
conflict produced different finding *content*, not just different list order, depending on incidental
input-array position — a real R10 violation, since `KbTree.entries` carries no ordering guarantee for
any caller other than `parseKbTree`'s own lexically-sorted walk. **Fixed** two ways: a `canonicalPair`
helper reorders every such pair by `id` (never `localeCompare`) before it is used for reporting, and a
new `sortFindings` helper (`types.ts`) — sorting by `(ruleId, entryId, message)` — is now applied to the
return value of every exported check in this module (`checkContradictions`, `lintKb`, `verifyKb`),
closing the weaker, list-order half of the same class of gap everywhere at once, not only in the two
functions the critic's own repro happened to demonstrate it in. A sixth, minor finding — a repeated id
in the same `related`/`supersedes` field produced one duplicate `kb:dangling-ref` finding per repetition
— was also fixed, by deduplicating the id list before checking it. Two further observations (a
whitespace-padded near-match to a real id silently treated as out-of-tree rather than flagged broken; a
KB entry naming itself in its own `related` field going unflagged) were considered and deliberately left
unfixed — the critic's own report calls both "narrow" and "not obviously wrong per spec," and neither
has a clear rule-table home to attach a fix to without inventing scope beyond what `08` §8.7 actually
asks for.

**Verify-round addendum: all six critic-round fixes confirmed independently, including with a
three-entry (not just two) symmetric-conflict scenario across every permutation for the determinism
fix; one further real gap found and fixed.** A verify pass re-derived each of the six fixes above with
its own adversarial scripts — notably, for the determinism fix, a three-entry antonym-tag conflict and
a three-ADR scope-overlap conflict, each checked across all six permutations of the input array, byte-
identical every time — and confirmed all six hold exactly as described. It also found one further real
gap: `checkDanglingRefs` never validated a KB entry's own `sources[].ref` (`kind: 'decision'`) against
the tree's real ids, even though `adrScope`/`inboundLinkedIds` (this same critic round's own points 1
and 4) already treat that exact field as a genuine reference relationship. A typo'd or since-deleted ADR
id in `sources` silently produced no diagnostic of its own — only a downstream, unexplained "no owning
ADR" finding once `checkComponentCoverage` failed to find the (nonexistent) citation. **Fixed** by
checking every `kind: 'decision'` source's `ref` the same way `related`/`supersedes` already are, in the
same function, against the same known-id set. The verify pass separately raised, but explicitly declined
to require fixing, whether a `Diagram`'s own `explains`/`depicts` ids (used identically as a genuine
reference by the same critic round's point 4) should also be checked for existence — left **unfixed**:
`depicts` is `diagram:refs`' own namespace (component/datastore/entity/actor tags, `SPEC-QUESTIONS.md`
Q44), explicitly out of this package's scope, and `explains`' own real id-space is not stated precisely
enough anywhere in the spec pack to add a check against it without guessing at a rule the spec itself
does not give.
