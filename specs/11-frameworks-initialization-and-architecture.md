# 11 — Decision Frameworks I: Project Initialization & System Design

## 11.0 What a "framework" is in FORGE

A framework is a **structured decision procedure**, shipped as data, that an agent executes:

```yaml
# canonical: modules/<m>/frameworks/<id>.framework.yaml
id: repo-strategy
name: Repository strategy selection
owner_agent: platform
produces: { adr_category: delivery, kb_section: delivery/repo-strategy.md }
inputs:
  required: [ kb:constraints/**, artifact:ArchitectureSpec ]
  derived:
    - id: deployable_units
      from: "architecture.components[?deployable].length"
    - id: language_count
      from: "distinct(architecture.components[].runtime).length"
questions:                       # asked only when not derivable from the KB
  - id: team_size
    text: "How many people (human or agent-lane) will change this codebase concurrently?"
    type: number
    default_from: "config.concurrency"
  - id: release_coupling
    text: "Must all deployables ship together?"
    type: choice
    options: [ always, usually, independent ]
options:                          # candidate answers
  - id: monorepo-single-package
  - id: monorepo-workspaces
  - id: polyrepo
  - id: meta-repo
criteria:                         # weighted rubric
  - id: atomic-cross-cutting-change
    weight: 0.25
  - id: independent-release-cadence
    weight: 0.20
  - id: build-tooling-cost
    weight: 0.15
  - id: access-control-granularity
    weight: 0.10
  - id: ci-scale
    weight: 0.15
  - id: onboarding-simplicity
    weight: 0.15
scoring: rubric                   # rubric | rules | hybrid
rules:                            # hard constraints applied before scoring
  - if: "deployable_units == 1"
    then: { eliminate: [ polyrepo, meta-repo ], prefer: monorepo-single-package }
  - if: "regulatory.code_isolation_required"
    then: { eliminate: [ monorepo-single-package, monorepo-workspaces ] }
output_template: templates/adr-repo-strategy.md.hbs
follow_on:
  - create_stories_from: templates/stories/repo-bootstrap.yaml
```

**Execution contract:** run rules → eliminate → score remaining against criteria with evidence per
cell → produce a ranked recommendation with the top option's *killer risk* stated → ask the human to
confirm (per autonomy) → write an ADR → write the KB entry → **emit or regenerate the diagrams the
taxonomy requires for that decision** (`08` §8.11.3) → emit follow-on stories.

Frameworks MUST show the score table in the ADR. A recommendation without a comparison table is a
validation failure.

---

## 11.1 Project Initialization frameworks

These answer: *how is this project laid out, built, versioned and worked in?* They run in phase P4
and produce a **scaffold** — real files, not advice.

### F-INIT-1 · Repository strategy
Options: single-package repo · monorepo with workspaces · polyrepo · meta-repo (repo of repos with a
sync tool) · hybrid (mono for product, poly for shared libs).
Decision inputs: number of deployable units, release coupling, team/lane concurrency, language
heterogeneity, access-control needs, CI cost, dependency-graph shape.
Outputs: ADR + `delivery/repo-strategy.md` + the actual directory skeleton + CODEOWNERS.

### F-INIT-2 · Directory & module layout
Chooses and applies a layout convention appropriate to the stack and architecture:
- Layer-first (`controllers/ services/ repositories/`) — only for small CRUD apps; flagged as a
  scaling risk above ~15 modules.
- **Feature/domain-first** (`src/billing/{api,domain,data,tests}`) — default for L2+.
- Hexagonal/ports-and-adapters (`domain/ application/ adapters/`) — when domain complexity is high
  or multiple delivery mechanisms exist.
- Package-by-bounded-context — when DDD is adopted.
Outputs: ADR, a written layout convention in `engineering/standards.md`, an enforcement lint
(dependency-cruiser / import-linter / ArchUnit / eslint boundaries) wired into CI, and the skeleton.

**Normative:** the layout convention MUST be machine-enforced. A convention nobody checks is a
convention agents will violate by turn 40.

### F-INIT-3 · Build system & toolchain
Decides: package manager, build orchestration, task runner, compilation targets, artifact format,
caching, reproducibility, dependency pinning, monorepo task graph.
Candidates by ecosystem: (JS) pnpm+turbo/nx, npm+scripts; (Python) uv/poetry+hatch, tox;
(JVM) Gradle/Maven; (Go) go tooling+make/mage; (Rust) cargo+just; (polyglot) Bazel/Pants/Earthly/Nix.
Hard requirements the framework must satisfy in its output:
- **One command to install, one to build, one to test, one to run.** (`make`/`just`/`task` wrapper
  if the native tooling needs more.) These commands are recorded in the KB and used by every gate.
- Reproducible from a clean clone on a clean machine (lockfiles committed; versions pinned;
  toolchain version declared via `.tool-versions`/`.nvmrc`/`rust-toolchain.toml`/`.python-version`).
- Deterministic artifact naming and a version stamp derived from git.
- Build must be runnable inside CI and inside an agent lane identically.
Outputs: ADR, `delivery/build.md`, working build files, a `make verify` (or equivalent) meta-target
that runs the full local gate suite.

### F-INIT-4 · Version control conventions
Decides: branching model (trunk-based default; git-flow only with justification), branch naming,
commit convention (Conventional Commits default), commit signing, merge strategy (squash/rebase/
merge), protected branches, required checks, PR template, CODEOWNERS, changelog generation, tagging
and release strategy (SemVer/CalVer), monorepo versioning (fixed vs independent, changesets).
Also decides **the agent's git rights**: may it commit? push? open PRs? merge?
Outputs: ADR, `engineering/ways-of-working.md`, `.gitmessage`, hooks (via lefthook/husky or plain
`core.hooksPath`), branch protection config as code where the host supports it.

### F-INIT-5 · Development environment
Decides: local runtime provisioning (native + version manager, devcontainer, Nix, Docker Compose),
service dependencies for local dev (real vs containerised vs faked), seed data, secrets for local,
port conventions, hot reload, and **the agent-lane environment** (what a lane can run offline).
Outputs: ADR, `docker-compose.dev.yml` / `devcontainer.json` / `flake.nix` as chosen, `.env.example`,
`scripts/dev-setup`, and a documented "cold start in N minutes" path that CI verifies periodically.

### F-INIT-6 · Coding standards & quality tooling
Decides: formatter, linter + rule severity, type checking strictness, complexity budgets, naming
conventions, error-handling convention, logging convention (structured, field names, levels),
null/optional policy, dependency policy (allowlist, license policy, max transitive depth,
renovate/dependabot), and pre-commit hooks.
Outputs: config files, `engineering/standards.md`, CI wiring.

**Why this matters for agents specifically:** every one of these becomes a deterministic check an
agent can run and a rule an agent can be measured against. Standards that exist only as prose are
invisible to a coding agent 200k tokens later.

### F-INIT-7 · Project scaffold generation
Not a decision — an execution step. Produces:
```
README.md (how to run/build/test/deploy)     .editorconfig
LICENSE                                       .gitignore / .gitattributes
CONTRIBUTING.md                               Makefile|justfile with: install build test lint verify run
FORGE.md (how this project is run by agents)  CI workflow skeleton
src/… per layout                              tests/… per test strategy
config/ (per environment)                     scripts/ (dev-setup, ci-*, db-*)
docs/ (arch views, ADR index link)            observability bootstrap (logger, tracer init)
```
Plus the **walking skeleton**: one trivial end-to-end path (HTTP request → handler → repository →
store → response) with a passing unit, integration and e2e test, deployed by the pipeline to a dev
environment. `G-Foundation` verifies exactly this.

---

## 11.2 System Design frameworks

### F-ARCH-1 · Architecture style selection
Options and their trigger conditions (the framework encodes these as rules, and MUST state the
disqualifying condition for the chosen style):

| Style | Choose when | Disqualified when |
|---|---|---|
| **Modular monolith** *(default for L2/L3)* | One team/lane-set, one deployable, unclear domain boundaries, need velocity | Independent scaling of parts is a hard NFR; polyglot runtimes mandated; org boundaries require isolation |
| Layered monolith | Simple CRUD, small scope, short life | Domain complexity, >15 modules |
| Microservices | Independent scaling/deploy/ownership per bounded context, established platform ops | Team < ~8 engineers-equivalent, no CI/CD maturity, unclear boundaries, single datastore mindset |
| Service-based (a few coarse services) | Some independent scaling, but not full microservices overhead | — |
| Event-driven | Async workflows, temporal decoupling, fan-out, integration-heavy | Strong end-to-end consistency needs without saga tolerance; no ops maturity for a broker |
| Serverless/FaaS | Spiky/low traffic, event glue, minimal ops appetite | Long-running work, tight latency floors, heavy local state, vendor-lock aversion |
| Pipeline/dataflow | Data transformation is the product | Interactive request/response is primary |
| Client-heavy / offline-first | Mobile/desktop, connectivity constraints, local-first UX | Server-authoritative multi-user consistency |
| Plugin/microkernel | Extensibility by third parties is a product requirement | — |

**Normative bias:** FORGE defaults to a **modular monolith with explicit internal boundaries and
extraction seams**, and requires an ADR that names the concrete trigger for extracting a service.
Choosing microservices at L2/L3 requires the human to confirm and the ADR to record the operational
cost accepted.

### F-ARCH-2 · Decomposition & boundaries
Procedure: identify capabilities → identify nouns/aggregates → cluster by change reason and data
ownership → propose components with (name, responsibility, owned data, dependencies, interface,
failure mode, scaling axis) → validate with these tests:
- **Change test**: does a typical feature touch ≤2 components?
- **Data ownership test**: does each piece of state have exactly one owning component?
- **Failure test**: can each component fail independently, and what's the degraded behaviour?
- **Team/lane test**: can components be worked on in parallel without constant coordination?
Output: `architecture/components.md` + C4 context/container/component views as Mermaid, produced by
the `components-to-c4` generator so the views cannot drift from the component inventory
(`08` §8.11.6).

### F-ARCH-3 · Communication & integration patterns
Decides per interaction, not globally. The framework produces an **interaction matrix**:

| Caller → Callee | Style | Protocol | Sync/Async | Delivery guarantee | Idempotency | Timeout/Retry | Failure behaviour |
|---|---|---|---|---|---|---|---|

Each row of the interaction matrix with two or more hops, and every async path, also produces a
sequence diagram covering the failure path — timeouts, retries, DLQ — not just the happy path.

Options covered: REST(+HATEOAS when a real hypermedia client exists), GraphQL, gRPC, tRPC, SOAP
(legacy integration only), WebSocket/SSE, webhooks, message queue (point-to-point), pub/sub,
event streaming (log), batch file transfer, shared database (explicitly discouraged; requires ADR
with an exit plan).
Rules encoded: cross-boundary synchronous chains > 2 deep require an ADR; any async path requires a
declared retry/DLQ/idempotency design; any public API requires versioning strategy + deprecation
policy; any webhook requires signature verification + replay protection.

### F-ARCH-4 · Architectural & design pattern selection
The catalog below is data (`catalog/patterns/*.entry.yaml`), each entry carrying: what it is, the
problem it solves, preconditions, costs, when *not* to use it, and an agent-checkable adoption test.

**Application/domain patterns:** DDD (strategic + tactical), CQRS, Event Sourcing, Hexagonal/Ports &
Adapters, Clean/Onion, Transaction Script, Active Record vs Data Mapper, Repository, Unit of Work,
Specification, Domain Events, Saga/Process Manager, Outbox/Inbox, Anti-Corruption Layer,
Strangler Fig, Backends-for-Frontends, API Gateway, Sidecar, Ambassador, Circuit Breaker, Bulkhead,
Retry with jitter, Rate limiting/throttling, Idempotency keys, Cache-aside/read-through/write-behind,
Materialized view, Leader election, Sharding, Partitioning, Feature toggles, Blue/green & canary,
Expand-contract migration.

**Programming paradigm patterns:** MVC/MVP/MVVM/MVI, Flux/Redux, Reactive programming (streams,
backpressure), Aspect-Oriented Programming (cross-cutting via decorators/interceptors),
Dependency Injection, Functional core / imperative shell, Actor model, State machines.

**Data & analytics patterns:** ETL vs ELT, Data Warehouse, Data Lake, Lakehouse, Medallion
(bronze/silver/gold), CDC, Star/Snowflake schema, Slowly Changing Dimensions, Data Mesh
(only at L4 with org preconditions), Streaming vs micro-batch, Lambda/Kappa architecture.

**Observability patterns:** Distributed tracing (context propagation), correlation IDs, structured
logging, RED/USE metrics, SLO-based alerting, exemplars, synthetic monitoring.

**Normative rule — pattern justification:** every adopted pattern gets an ADR containing:
the specific problem instance, the precondition it satisfies, the concrete cost accepted, the
simpler alternative rejected, and *where it must not be applied*. CQRS and Event Sourcing in
particular MUST record their read-model rebuild story, their eventual-consistency window, and the
debugging cost; adopting Event Sourcing without an ADR that answers "how do we fix bad events?" is a
gate failure.

### F-ARCH-5 · NFR strategy
For each NFR category, decide the *mechanism* and the *verification*:

| Category | Mechanism decisions | Verification |
|---|---|---|
| Performance | caching layers, N+1 prevention, pagination, indexes, async offload, payload budgets | benchmark test with the NFR's numbers |
| Scalability | scaling axis (vertical/horizontal), statelessness, sharding key, connection pooling, queue depth | load test profile |
| Availability | redundancy, health checks, graceful degradation, timeouts everywhere, circuit breakers | chaos/fault-injection test or a documented failure drill |
| Security | authn/authz model, secret handling, input validation, output encoding, transport, supply chain | SAST/dependency scan/authz test suite |
| Privacy | PII classification, minimisation, retention, subject-access & deletion paths | data-map audit + deletion test |
| Maintainability | module boundaries + enforcement, complexity budgets, test pyramid, docs | architecture lint + coverage |
| Operability | logs/metrics/traces, runbooks, feature flags, config-without-deploy | dashboard existence check + runbook per Sev1 mode |
| Cost | infra sizing, storage class, egress, cache hit targets | cost model + budget alarm |
| Accessibility | WCAG level target, semantic markup, keyboard paths, contrast | automated a11y tests + manual checklist |

Each mechanism produces stories; each verification produces a test/monitor artifact. An NFR with no
mechanism and no verification is rejected at `G-Design`.

### F-ARCH-6 · Threat modelling
STRIDE per component boundary + data-flow diagram + trust boundaries. Produces `ThreatModel` with,
per threat: asset, threat, likelihood, impact, mitigation (as a story), residual risk, and the test
that proves the mitigation. Mandatory at L3/L4 and whenever `regulatory` constraints exist.

### F-ARCH-7 · Buy vs build vs borrow
For each capability: is there a mature service/library? Evaluate on: fit, total cost (incl. egress
and lock-in), operational burden, data residency, licence compatibility, maturity/maintenance
signals, exit cost, and how much of the core value proposition it represents.
Rule encoded: **never build undifferentiated heavy lifting** (auth, email delivery, payments, search
infra, observability backends) at L2/L3 without an ADR that justifies it against a named alternative.

---

## 11.3 How frameworks appear to the user

- `forge decide <framework>` runs one interactively.
- Phase workflows run the relevant set automatically and only ask questions that can't be derived.
- Every framework run produces: an ADR, a KB entry, follow-on stories, and (where applicable) real
  files. A framework that produces only prose is mis-specified.
- `forge kb show ADR-0011` renders the score table so the user can audit the reasoning.
