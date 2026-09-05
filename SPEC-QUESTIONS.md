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
