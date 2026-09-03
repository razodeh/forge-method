# 17 — Brownfield: Adopting an Existing Codebase

## 17.1 The problem

Most software is not greenfield. `forge adopt` must take a repository FORGE has never seen — possibly
large, possibly undocumented, possibly wrong about itself — and produce a Knowledge Body accurate
enough that agents can safely work in it.

**The core risk is confident fabrication.** An agent asked to "document this architecture" will
produce a plausible, well-formatted, partly-invented description, and once that lands in the KB every
downstream decision inherits the invention. Everything below is designed to make that failure mode
structurally difficult:

- Every KB entry produced by adoption carries **evidence** (file paths, line ranges, commit SHAs) and
  a **confidence** rating.
- Claims that cannot be evidenced are recorded as **open questions**, not as knowledge.
- **Deterministic analysis runs before LLM analysis**, and the LLM's job is to explain and organise
  facts already gathered, not to guess them.
- The human confirms high-impact claims before they become `active`.

## 17.2 Phases

```
SURVEY → INVENTORY → CARTOGRAPHY → INFERENCE → VERIFICATION → RECONSTRUCTION → GAP ANALYSIS → BASELINE
```

### 1. SURVEY (deterministic, cheap, read-only)

No LLM. Pure tooling, producing a factual profile:

| Signal | Source |
|---|---|
| Size, languages, file counts | `tokei`/`cloc` equivalent, or a built-in walker |
| Build/toolchain | manifest files (`package.json`, `pom.xml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, …) |
| Frameworks and major libraries | dependency manifests + lockfiles |
| Entry points | scripts, `main`, server bootstraps, `Dockerfile` CMD, serverless configs |
| Deployable units | Dockerfiles, compose files, IaC, CI deploy jobs, k8s manifests |
| Datastores | connection strings in config templates, ORM config, migration directories |
| Test setup | test dirs, frameworks, existing coverage config, CI test commands |
| CI/CD | pipeline files, stages, deploy targets |
| Git profile | age, commit count, contributor count, churn hotspots, files changed together |
| Existing docs | READMEs, `/docs`, ADRs, wikis referenced |
| Health signals | TODO/FIXME density, dependency age, lint config presence, type coverage |

Output: `reports/adoption/survey.json` — facts only, zero interpretation.

**Gate:** if the repo exceeds size thresholds, `adopt` proposes a scoped adoption (one service, one
module) rather than attempting the whole thing. Partial, accurate adoption beats total, shallow
adoption.

### 2. INVENTORY (deterministic)

Structural extraction, still without an LLM:

- **Module/dependency graph** from imports (language-appropriate: `madge`/`dependency-cruiser`,
  `import-linter`, `go list`, `jdeps`, `cargo tree`). Cycles and hotspots identified.
- **Public API surface**: HTTP routes, GraphQL schema, gRPC services, CLI commands, exported symbols,
  queue consumers, scheduled jobs, webhooks.
- **Data surface**: migration history, schema introspection where a dev database is reachable, ORM
  entity definitions, index inventory.
- **Configuration surface**: every env var read, every config key, every secret reference.
- **External dependencies**: outbound hosts, third-party SDKs, integration points.

Output: machine-readable inventories that later become `INT-###`, `DM-###` and component entries.

### 3. CARTOGRAPHY (LLM, evidence-bound)

Now agents enter, with a strict rule: **every claim cites evidence from phases 1–2 or from a file it
read.** The `architect` and `data-architect` roles work read-only, tainted (`20` §20.5), on:

- **Component identification** — cluster the module graph into components with a responsibility
  statement each, evidenced by paths.
- **Layering and boundaries** — what the de facto architecture is (which is often not the intended
  one; both get recorded).
- **Runtime topology** — deployables, how they communicate, synchronous vs asynchronous paths.
- **Data ownership** — which component writes which table/collection. Shared-write tables are flagged
  immediately; they are the highest-value finding in most brownfield systems.
- **Critical paths** — the flows that carry the business (identified from routes + churn + logs if
  available).

Each output carries `confidence` (`high` where structurally evidenced, `medium` where inferred from
naming/convention, `low` where guessed) and the evidence list.

### 4. INFERENCE (LLM, clearly separated)

The riskier claims, kept deliberately distinct from cartography so they can be trusted differently:

- Implicit conventions (error handling, logging, naming, testing style) inferred from repeated
  patterns, with counts: "17 of 21 handlers use X" is a convention; "3 of 21" is a mess.
- Apparent intent behind structural choices, from code, comments and git history.
- Probable NFRs implied by the code (timeouts, retries, caches, indexes, rate limits).
- Domain vocabulary → glossary candidates.

Everything from this phase starts at `confidence: low|medium` and `status: draft`.

### 5. VERIFICATION (deterministic, the phase that earns trust)

Claims are tested against reality wherever a test is possible:

| Claim type | Verification |
|---|---|
| "Component A calls component B" | Static call/import evidence, or a trace/log sample |
| "Entity X lives in table Y" | Schema introspection |
| "The build command is Z" | **Run it.** Clean clone → build → record the result |
| "Tests pass" | **Run them.** Record pass/fail/coverage as measured, not as claimed |
| "Deployment is via pipeline P" | Read the pipeline; check for last successful run |
| "Endpoint E exists" | Route table extraction; optionally a live probe against a dev instance |
| "Convention C is followed" | Lint rule or grep with a counted ratio |

**Running the build and the test suite is mandatory** and often the single most informative step in
adoption — a repository whose README build command does not work is a fact worth knowing before
anything else. Failures are recorded as findings, not as blockers.

Verified claims are promoted to `confidence: verified` with the verification command stored in the
entry (`08` §8.3), which is what makes future drift detection possible.

### 6. RECONSTRUCTION

The KB is written, matching the greenfield layout (`08` §8.2) so brownfield and greenfield projects
are indistinguishable afterwards:

- `architecture/` — components, interfaces, patterns, de facto views (all diagrams generated, not
  hand-drawn: `components-to-c4`, `deps-to-graph`, `schema-introspect-to-er`, `08` §8.11.6).
- `data/` — model, stores, access patterns where derivable, migration history.
- `delivery/` — repo strategy, build, environments, pipeline **as they actually are**.
- `engineering/standards.md` — observed conventions with adherence ratios.
- `product/` — usually sparse; capabilities are reverse-engineered from routes and UI and marked
  `confidence: low` pending human confirmation.
- `decisions/` — **retroactive ADRs** for the significant structural choices, with
  `status: accepted`, `date: unknown`, `framework: reconstructed`, and context inferred rather than
  recorded. These are explicitly labelled as reconstructions so nobody mistakes them for the original
  reasoning.

### 7. GAP ANALYSIS

The output that makes adoption immediately useful. Produced as
`reports/adoption/gaps.md` and as `RISK-###` / `OQ-###` artifacts:

| Gap class | Examples |
|---|---|
| Knowledge gaps | Unexplained components, dead code candidates, undocumented magic values, unknown data ownership |
| Verification gaps | No tests for critical paths, no e2e, unmeasured NFRs, no contract tests at integration points |
| Delivery gaps | No reproducible build, manual deploy steps, no rollback, missing environments |
| Operability gaps | No structured logging, no tracing, no alerts, no runbooks |
| Safety gaps | Secrets in the repo, shared-write tables, unbounded queries, missing authz on routes, destructive migrations |
| Consistency gaps | Convention violations, layering violations, cyclic dependencies |

Each gap is severity-rated and, where actionable, converted into a story so remediation can be
planned rather than admired.

### 8. BASELINE

- A `BASELINE` tag/commit recording the state at adoption.
- The measured facts: build time, test count and pass rate, coverage, dependency count, LOC, cycles,
  gap counts. This is the ratchet reference — FORGE can then show whether the system is improving.
- `G-Adopt` gate: KB lints clean, every `high`-impact claim is either verified or human-confirmed,
  the build and test verification results are recorded, and the gap report exists.

## 17.3 Human confirmation

Adoption is the one workflow where human confirmation is structurally required regardless of autonomy
level, because the cost of a fabricated foundational claim compounds through everything after it.

The confirmation flow is designed to be *fast*, since a 200-question interrogation gets abandoned:

- Claims are batched by section and presented **ranked by impact × uncertainty**, not exhaustively.
- The default cap is 20 questions; the rest are recorded as `OQ-###` for later.
- Each question shows the claim, its evidence, and the consequence of it being wrong.
- "I don't know" is always available and converts the claim to `confidence: low` with an open
  question rather than forcing a guess.

## 17.4 Working in an adopted codebase

Adjustments FORGE makes for brownfield work, all of which matter:

1. **Conventions are observed, not imposed.** Generated code follows the repository's existing
   patterns, even where FORGE's defaults differ. A convention change is a deliberate ADR plus a
   migration story, never a side-effect of an agent's preference.
2. **Blast-radius analysis before change.** Any story touching a component computes its dependents
   from the module graph and includes them in the test scope. This is the brownfield equivalent of
   contract-freeze.
3. **Characterisation tests before refactoring.** Untested code that must change gets tests capturing
   *current* behaviour first (differential oracle, `13` F-TEST-2 #5). Only then does it change.
4. **The strangler-fig default.** New capability in a legacy area is built alongside and switched
   over behind a flag, rather than modifying in place — recorded as an ADR each time.
5. **Narrower file claims.** Ownership globs are tighter than greenfield because unknown coupling is
   likely; out-of-claim writes default to `strict` even at `guided` autonomy.
6. **Drift detection from day one.** Because verified entries carry verification commands and
   generated diagrams carry generators, `forge kb verify` and `diagram:drift` immediately tell the
   user when reality and the KB diverge.

## 17.5 Continuous adoption

Adoption is not one-shot. `forge adopt --incremental` re-runs SURVEY through VERIFICATION on a
schedule or after significant merges and reports:

- New components/routes/tables not in the KB (someone built something undocumented).
- Entries whose verification commands now fail (drift).
- Conventions whose adherence ratio has moved.
- Gap closures and regressions against the baseline.

This makes the KB self-correcting rather than a snapshot that ages, which is the difference between
documentation that gets used and documentation that gets ignored.

## 17.6 Commands

```
forge adopt [dir] [--scope <path|module>] [--depth quick|standard|deep] [--no-verify]
forge adopt --incremental
forge adopt --report                 # re-print survey/gaps without re-running
forge kb verify                      # run stored verification commands
forge baseline show | diff
```

`--depth quick` runs phases 1–2 plus a minimal cartography (useful for deciding whether to adopt at
all); `standard` is the default; `deep` adds inference over git history and per-component
characterisation test generation.
