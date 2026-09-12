# 23 — Open Decisions

Every `TODO(impl)` and deliberate degree of freedom in this pack, collected. Each has a
recommendation, so the implementer can proceed without blocking — but each is a real decision the
owner may reverse.

**Convention:** *Decide by* tells you the latest milestone at which the decision must be made without
causing rework.

---

## 1. Naming and npm availability

**Question:** Are `forge-method` and the `@forge` scope available? `forge` is already a well-known
tool (Foundry), which could cause confusion even if the binary name is free.

**Recommendation:** Verify availability before M1 ends. If taken, fall back to `forgekit-method` /
`@forgekit/*` with binary `forge` retained if possible. Keep every name reference in
`packages/*/package.json`, the `bin` map, and a single `constants.ts` so a rename is a one-file
change.

**Decide by:** M1. **Risk of deferring:** low technically, high for published-artifact churn.

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
