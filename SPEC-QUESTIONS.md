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
