# 23 — Open Decisions

Every `TODO(impl)` and deliberate degree of freedom in this pack, collected. Each has a
recommendation, so the implementer can proceed without blocking — but each is a real decision the
owner may reverse.

**Convention:** *Decide by* tells you the latest milestone at which the decision must be made without
causing rework.

---

## 1. Naming and npm availability — resolved: `forge-method` (unscoped), `@forge` scope dropped

**Question (as originally raised):** Are `forge-method` and the `@forge` scope available? `forge` is
already a well-known tool (Foundry), which could cause confusion even if the binary name is free.

**What M1 actually did:** nothing — this decision was never revisited before M1 ended, and every
`@forge/*` package name (`@forge/core`, `@forge/cli`, …) was built and shipped throughout M1-M11
without the availability check this section always called for. PLAN-M12.md P8 (the changesets
release pipeline) is the first point in the build where "can this actually be published" stopped
being deferrable, since it is the piece that has to make a real publish decision.

**What P8 found, checked directly against the live npm registry from the build sandbox (a real HTTP
GET to `registry.npmjs.org`, not a guess — confirmed reachable, see below):**

- **The `@forge` npm scope is not available and never was.** It is actively owned and maintained by
  Atlassian for their own, unrelated "Forge" platform (Atlassian's own app-development product,
  confusingly also named Forge) — `@forge/storage` is a real, currently-maintained package under it
  (`latest: 2.0.3`, published/maintained by `atlassian-cicd`/`eng-development-tooling-artifacts@
  atlassian.com`, confirmed via `GET https://registry.npmjs.org/@forge/storage`). npm scopes are
  registered once, globally, by whoever claims them first; there is no path to ever publishing
  anything under `@forge/*` on the public registry. This is a harder, more permanent blocker than
  this section's original "could cause confusion" framing suggested — it is not a branding risk, it is
  a registry-level impossibility.
- **`forge-method` (unscoped)** returned `404 Not Found` on a live registry check performed
  2026-09-14, which is the normal signal an unscoped name is unclaimed (npm has no separate
  "reservation" list — `404` on `GET /<name>` is the actual, standard way to check). This is real
  evidence, not a fabricated "confirmed available" claim, but it is also not a permanent guarantee:
  npm names are claimed at publish time on a first-come basis, not reserved in advance, so this must
  be re-checked (the same one-line `curl`) immediately before the real, first `npm publish` — not
  assumed to still hold whenever that day comes.
- The originally-proposed fallback (`forgekit-method` / `@forgekit/*`) was also checked and is
  likewise unclaimed as of the same date, kept on record as the real fallback if `forge-method` is
  claimed by the time a human with real npm publish rights attempts the first live publish.

**Decision:** `packages/cli`'s own `package.json` `name` is `forge-method` (unscoped), `private:
false` — the only package in this workspace that publishes. Every internal `@forge/*` package
(`@forge/core`, `@forge/engine`, …) **stays exactly as named and stays `"private": true`.** This is a
narrower publish surface than `02` §2.7's own text ("internal `@forge/*` packages are published too,
for module authors and `@forge/adapter-kit` consumers") describes, and that gap is real, not silently
dropped: the `@forge` scope collision means those packages could never be published under their
current names regardless — publishing them would first require renaming the entire internal scope
(e.g. to `@forgekit/*`), which is a real, separate, repo-wide piece of work `specs/22`'s own M12 P8
mandate did not size or schedule. Disclosed here as a genuine follow-on decision for whenever module-
author/adapter-kit external consumption is actually prioritized, not assumed resolved by this entry.

**A real, load-bearing gap this decision does not close: the published package is not yet functional
for a real end user, even once the naming/scope question above is settled.** `02` §2.7's own text
requires `forge-method` to publish "a single bundled CLI **plus data directories (`templates/`,
`modules/`, `catalog/`) as package files**" — `packages/cli/package.json`'s own `files` field is
`["dist"]` only; nothing ships those directories. This matters concretely, not just textually:
`resolvePackageRoot('@forge/templates')` (`packages/cli/src/init/content.ts`, `commands/template.ts`,
`commands/decide.ts`, `commands/shared.ts`) reads real template files from `@forge/templates`'s own
installed location at runtime, and `resolveModulesDir()` (`bin.ts`) walks two directories above this
package's own root to find a real `modules/` directory — both real, working today only because every
real invocation of this CLI happens inside this monorepo checkout, where `@forge/templates` and
`modules/` genuinely sit on disk beside it. Neither exists in the published `forge-method` tarball this
piece produces: `@forge/templates` stays `"private": true` and is never on the registry at all (nothing
this piece could fix without also resolving the internal-packages-stay-private question above), and
`modules/` is a repo-root directory with no publish/distribution mechanism (`SPEC-QUESTIONS.md` Q103,
pre-existing). **Concretely: `npm install -g forge-method && forge init` would fail today** — not tested
against a real registry install (no real publish happened), but traced directly through the real code
path above, which is the honest way to state it. This piece's own real scope (the changesets pipeline
and the publish *decision*, not a second data-packaging piece) did not extend to fixing this — building
a real template/module/catalog packaging step is separate, sizable work no `PLAN-M12.md` piece named.
Recorded here, in the canonical decision record, rather than left to a `SPEC-QUESTIONS.md` entry alone:
this is exactly the kind of fact a reader trusting only this file would otherwise miss, since nothing
else in this decision's own text names it.

**Two further, real, undisclosed-until-now side effects of the rename, found by this piece's own critic
round:** (1) `.changeset/config.json`'s `fixed: [["@forge/*"]]` group no longer matches `forge-method`
(it matched `@forge/cli`) — the CLI now versions independently of the 17 internal `@forge/*` packages
rather than in lockstep with them. Judged, not merely noticed: this is the *correct* outcome (the one
package real users install should carry its own real semver, not be forced to bump in lockstep with
internal packages no external consumer ever sees), but it was an unexamined side effect of the rename
until this critic round asked, not a decision this entry stated outright until now. (2)
`packages/cli/package.json`'s `exports` map shrank from six real subpaths (`./entry`, `./output`,
`./init`, `./commands`, `./doctor`, `./upgrade`, each pointing at real `src/` TypeScript) to one (`.` →
`./dist/forge.mjs`) — verified via a full-repo grep that nothing anywhere ever imports any of those
subpaths (only prose references in comments), so this is not a real break today, but it is a real
removal of previously-public internal API surface, worth stating plainly rather than leaving implicit in
a package.json diff.

**A third round-2 critic finding, since fixed:** §2.7's own further, separate requirement — "Node engine
check with a friendly message before any import that requires modern syntax (use a tiny CJS preflight
shim)" — was missed by the first pass entirely. `packages/cli`'s real `bin` target is now
`bin/preflight.cjs` (plain, ES5-only CommonJS, so it parses on the old runtimes it exists to catch): it
checks `process.version` against the real `>=20.19` floor before ever touching the modern-syntax bundle,
printing a real, actionable message and exiting 1 on an unsupported Node, or dynamically `import()`ing
`dist/forge.mjs` otherwise. See `SPEC-QUESTIONS.md` Q189 point 12 for the full account, including the one
real, disclosed test gap (the "too old" branch's own subprocess behavior has no automated end-to-end
test, since no pre-20.19 Node binary exists in this environment to actually exercise it against).

**How this was verified, and what still needs a human:** the check above was a real, live HTTP request
made from inside this build's own sandboxed environment during P8 — confirmed reachable by testing
directly (`curl`/`fetch` against `registry.npmjs.org`, cross-checked against a known-published package
returning `200`, before trusting a `404` on anything else as meaning "unclaimed"), not assumed either
way going in. That is real evidence for "unclaimed as of this specific date," not proof it will still be
unclaimed at actual publish time — npm names are claimed at publish time, not reserved — and it is not a
substitute for a human with real npm publish credentials performing the same check (and the actual `npm
publish`) themselves when v1.0 is really cut. It is also not a standing guarantee about every future
sandboxed run of this codebase: this was one real, live check from one real session on 2026-09-14, not a
claim that this environment always has outbound network access.

**Decide by:** ~~M1~~ M12 P8 (actually decided here, four milestones late). **Risk of deferring:** the
risk this section originally warned about was realized — not "low technically," a real, structural
scope collision that would have blocked every `@forge/*` publish attempt, caught only because P8
finally investigated it directly instead of continuing to defer it.

---

## 2. Should `@forge/core` ever call a model directly?

**Question:** `01` §1.5 says FORGE never implements its own agent loop, but permits "utility
completions" through an adapter's one-shot mode (classification, extraction, summarisation).

**Recommendation:** Keep the exception, but route it through `PlatformAdapter.structured()` only,
never a direct provider SDK. Any code path that builds an HTTP request to a model provider outside
`packages/adapter-*` should fail the boundary lint. The temptation to "just call the API quickly"
for a small task is exactly how platform-agnosticism dies.

**Decide by:** M4.

---

## 3. Embeddings in KB retrieval

**Question:** `08` §8.5 makes lexical + structural retrieval the default and embeddings an opt-in
flag. Which embedding provider, and is a local model acceptable?

**Recommendation:** Ship v1 with the flag present and the implementation absent (`config` accepts it,
`doctor` reports "not implemented"). Revisit after real usage: if structural retrieval proves
sufficient — which it may well, given most retrieval is by declared ID — the complexity is never
worth adding. If added, prefer a local model so the no-network default holds.

**Decide by:** post-v1. **Do not build it speculatively in M3.**

---

## 4. SQLite dependency strategy

**Question:** `better-sqlite3` is a native addon; it can fail to install in sandboxes and on unusual
platforms, which is hostile for an `npx` tool.

**Recommendation:** Implement the three-tier fallback exactly as `02` §2.1 says — `better-sqlite3`
(optional) → `node:sqlite` if present → JSON index with degraded search and a startup warning. Test
all three paths in CI; the JSON path is the one most likely to rot from disuse.

**Decide by:** M3.

---

## 5. CodeMachine's actual CLI surface — resolved: descoped, not built

**Question (as originally raised):** `07` §7.4 deliberately declined to pin CodeMachine's interface,
because it evolves independently and could not be verified.

**Decision:** `@forge/adapter-codemachine` is not being built. FORGE's own scope is a CLI tool/
framework that drives a real coding-agent runtime; the generic declarative adapter (`07` §7.5) already
covers "drive some other CLI coding tool" for any tool a user configures, without FORGE needing to
name and maintain a binding to one specific third-party tool whose own interface was never confirmed.
`07` §7.4 itself, `specs/22`'s own M11 Build line, and every other spec cross-reference have been
updated to reflect this — see `07` §7.4's own "descoped" text for the fuller reasoning.

**Decided:** M11 planning (before any implementation work began).

---

## 6. Are `reviewer` and `test-architect` truly non-disableable?

**Question:** `15` §15.3.3 refuses to disable them at any level. I flagged this when writing it: it is
defensible, and it is also the kind of rule that makes someone fork rather than adopt.

**Recommendation (revised from the original):** keep them non-disableable at L2+, but allow disabling
at L0/L1 with a loud warning, since a one-story bug fix genuinely may not need a separate test
architect. The separation-of-duties invariant (I1/I2 — the author never reviews or tests their own
work) stays absolute at every level; what becomes optional is the *dedicated role*, not the
*separation*. This preserves the guarantee while removing the fork incentive.

**Decide by:** M2 (it is an invariant implementation).

---

## 7. Test-result → AC binding across ecosystems

**Question:** `09` §9.5 specifies annotation mechanisms for JS/TS, Python, Java and Go, with a regex
fallback. Which ship in v1?

**Recommendation:** JS/TS and Python natively in M8; everything else through the name-convention
regex fallback. Extend per module (`fm-service` adds JVM) based on demand. The regex fallback must be
solid, because it is what most ecosystems will actually use.

**Decide by:** M8.

---

## 8. Diagram rendering: bundle Mermaid or require a local install?

**Question:** `08` §8.11.8 makes client-side HTML the default fallback. Bundling Mermaid adds
meaningful weight to the CLI package.

**Recommendation:** Do not bundle it in the CLI. Emit HTML that references a **version-pinned,
integrity-checked** script, and provide `forge diagram render --offline` which requires the optional
local renderer. Document that the HTML fallback needs network *at view time* (not at render time,
and never for validation). If that trade-off proves annoying, bundling is a one-line change later.

**Decide by:** M3.

---

## 9. Cost figures: how prominently to label estimates

**Question:** Adapter-reported costs are client-side estimates (`07` §7.3), yet the ledger drives
budget enforcement and the "cost per merged story" metric.

**Recommendation:** Label every displayed figure as estimated unless the adapter reports
`costReporting: 'per-turn'` with authoritative data, and say so in `forge cost` output. Enforce
budgets on estimates anyway — an approximate cap is vastly better than none — but never present a
figure that could be mistaken for an invoice.

**Decide by:** M5.

---

## 10. Autonomy default

**Question:** `03` §3.6 defaults to `guided`. Is that right for a first-run experience?

**Recommendation:** Keep `guided` as the default. `autonomous` on a first run, before the user trusts
the gates, produces either a scary experience or an expensive one. The `solo-fast` preset exists for
users who want more rope and have chosen it deliberately.

**Decide by:** M6. **Revisit after the M7 checkpoint with real usage data.**

---

## 11. Default concurrency

**Question:** `min(4, cpus/2)` is specified, but the real constraint is usually provider rate limits,
not CPU.

**Recommendation:** Start at 3 and let backpressure adapt downward. Have the M7 checkpoint measure
what real rate limits allow, then set the default from evidence. Over-parallelising produces retry
storms that are slower *and* more expensive than lower concurrency.

**Decide by:** M7.

---

## 12. Walking-skeleton enforcement

**Question:** `10` §10.4 fails `G-Ready` for stage 1 if no story is tagged `walking-skeleton`. Is
that too rigid for L1/L2 work in an existing system?

**Recommendation:** Enforce for greenfield L3/L4 only. For brownfield and L1/L2, the equivalent
guarantee already exists — the system builds and deploys — so require *evidence of an existing
end-to-end path* instead of a new story.

**Decide by:** M6.

---

## 13. Export targets

**Question:** `03` §3.2.7 lists Jira, Linear and GitHub Issues as export targets, with only
markdown-bundle and html shipping in v1.

**Recommendation:** Ship the two document exporters plus the `KbExporter`/`SpecExporter` interfaces
in M12. Build issue-tracker exporters only when a user asks, and build them as overlay-bundle
extensions rather than core — they are integration surface that will need per-org customisation
anyway, which is exactly what the extension system is for.

**Decide by:** M12.

---

## 14. Retention of run state

**Question:** `20` §20.7 proposes a 30-day default for `forge state prune`.

**Recommendation:** 30 days is reasonable, but make the *summary* permanent: when a run is pruned,
its gate reports, cost totals and RCA records remain in `docs/forge/reports/` (committed). Only
transcripts and worktree remnants are removed. Nothing durable should live only in gitignored space.

**Decide by:** M12.

---

## 15. How much of the method should be prompt vs. runtime?

**Question:** The pack's stated anti-goal (`01` §1.6) is becoming "BMAD with extra files". The
boundary — "if it can be a better prompt, it's a template; if it needs state, scheduling,
verification or memory, it's runtime" — will be tested constantly during M6 content authoring.

**Recommendation:** When in doubt during M6, write it as a template first and promote it to runtime
only when a template demonstrably cannot enforce it. Promotion is easy; demotion means deleting code
someone already relies on. Track promotions in `SPEC-QUESTIONS.md` — if many things get promoted, the
boundary is drawn in the wrong place and the architecture should be revisited rather than patched.

**Decide by:** ongoing through M6. **This is the decision most likely to determine whether the
product achieves its stated differentiation.**

---

## 16. Modelling language for a future non-Mermaid default

**Question:** `08` §8.11.9 allows PlantUML/D2/Structurizr, but only Mermaid is implemented in v1.

**Recommendation:** Implement the notation abstraction (generators declare output per notation) in M3
even though only Mermaid is wired, so adding one later is data plus a parser rather than a
refactor. Do not implement the others until someone asks — and if nobody asks within two releases,
consider removing the abstraction rather than maintaining an unused seam.

**Decide by:** M3 for the seam; post-v1 for implementations.
