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
