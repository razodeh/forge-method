# 14 — Decision Frameworks IV: Delivery, Deployment and Operations

Owner: `sre` (with `platform` for build, `release` for release management, `security` for supply
chain). Outputs land in `kb/delivery/**`, `kb/ops/**`, and real pipeline/IaC files.

**Framing principle:** deployment is not a phase at the end. It is designed in P3, scaffolded in P4
(the walking skeleton deploys), and exercised on every stage. A system that has never been deployed
is not "nearly done" — it is unvalidated.

---

## 14.1 F-DELIVER-1 · Environment strategy

Decides the environment matrix and, crucially, what each one is *for*. Environments that exist
without a stated purpose become expensive and untrusted.

| Environment | Purpose | Data | Who/what deploys | Parity requirement |
|---|---|---|---|---|
| `local` | Inner loop for humans and agent lanes | Seeded synthetic | Developer/agent | Same runtime versions; may substitute managed services |
| `ci` | Ephemeral, per-pipeline-run verification | Fresh per run | Pipeline | Same containers as prod where feasible |
| `preview` (optional) | Per-branch/PR review | Seeded synthetic | Pipeline on PR | Prod-like topology, small scale |
| `staging` | Pre-production verification, smoke, migration rehearsal | Masked or synthetic prod-shaped | Pipeline on merge | **Structurally identical to prod** |
| `production` | Real users | Real | Pipeline, gated | — |

**Rules:**

1. **Staging must be structurally identical to production** — same deployment mechanism, same
   migration path, same config *shape*, same networking model. Differing only in scale and data. A
   staging environment that deploys differently from production tests nothing that matters.
2. **The minimum viable matrix is `local` + `ci` + `production`.** Staging is added when a migration
   or an integration makes rehearsal necessary. Do not build five environments for an MVP; do record
   the decision.
3. **No production data in non-production environments.** Ever. If prod-shaped data is needed, it is
   synthesised or masked, and the masking is tested.
4. Every environment is described as an `ENV-###` artifact: purpose, URL, deploy trigger, data
   policy, secrets source, owner, and how to get access.

### Configuration strategy

Decided here, and it is a correctness concern rather than a convenience one:

- **Config comes from the environment; secrets come from a secret manager.** No secrets in config
  files, images, or repos.
- **Config is validated at startup against a schema, and the process refuses to start on invalid or
  missing config** — failing loudly at boot beats failing mysteriously at 3am on an uncommon path.
- One `.env.example` enumerating every variable with a description and whether it is required.
- Config that changes behaviour meaningfully is a feature flag, not an env var, so it can change
  without a deploy (see §14.6).
- A `config:doctor` command prints resolved config with secrets redacted — the operational sibling of
  `forge config explain`.

---

## 14.2 F-DELIVER-2 · Build and artifact strategy

Extends F-INIT-3 (`11`) from "it builds locally" to "it produces a deployable artifact".

Decides: artifact type (container image, zip/lambda bundle, native binary, package, static bundle),
base image and hardening, build reproducibility, layer caching, multi-arch needs, artifact registry,
tagging scheme, retention, and signing.

**Normative:**

1. **Build once, promote the same artifact.** The bytes deployed to staging are the bytes deployed to
   production. Rebuilding per environment reintroduces the class of bug the pipeline exists to
   eliminate. Environment differences come from config, never from a rebuild.
2. Artifacts are tagged immutably with the git SHA (plus a human-friendly semver tag). `latest` is
   never deployed.
3. The build emits an **SBOM** and the artifact is **signed**; the deploy step verifies the signature
   and refuses unsigned artifacts. At L2 this can be a two-line addition to the pipeline, so the
   usual "we'll add supply chain later" is not accepted without an ADR.
4. Base images are pinned by digest, minimal, non-root, and refreshed on a schedule by an automated
   dependency PR — not by a human remembering.
5. Build must be reproducible enough that two runs on the same SHA produce functionally identical
   artifacts; where full bit-reproducibility is impractical, that's recorded rather than assumed.

---

## 14.3 F-DELIVER-3 · CI/CD pipeline design

Decides the platform (from the catalog) and, more importantly, the **stage graph and what each stage
is allowed to block**.

### Canonical pipeline stages

```
 on PR                                    on merge to trunk
 ├─ 1 setup + cache restore               ├─ 1 setup
 ├─ 2 static: format, lint, typecheck     ├─ 2 full verify (all PR stages)
 ├─ 3 test:unit            ─┐ parallel    ├─ 3 build artifact + SBOM + sign
 ├─ 4 test:integration      │             ├─ 4 publish to registry
 ├─ 5 test:contract         │             ├─ 5 deploy → staging
 ├─ 6 security: deps, SAST, secrets ─┘    ├─ 6 migrate (staging) + smoke + e2e
 ├─ 7 build (no publish)                  ├─ 7 [gate] G-Deliver approval
 ├─ 8 test:e2e (preview env)              ├─ 8 deploy → production (progressive)
 └─ 9 forge gate check --json             ├─ 9 post-deploy verification + soak
                                          └─ 10 auto-rollback on SLO breach
```

**Rules:**

1. **The pipeline is the only path to production.** No manual deploys, no laptop `kubectl`, no
   console clicks. If an emergency path exists, it is a documented, audited break-glass procedure
   that still produces a record.
2. **The pipeline runs the same commands as the local gate suite** (`make verify` / `forge gate
   check`). Divergence between "works locally" and "works in CI" is a design defect: one command,
   two contexts.
3. Fast feedback first: static analysis and unit tests before anything slow. Fail fast, but run
   independent stages in parallel.
4. Pipeline definitions are in the repo, reviewed like code, and pinned (actions/plugins by SHA, not
   by floating tag — a floating tag is remote code execution with extra steps).
5. **Pipeline credentials use short-lived, federated identity** (OIDC to the cloud provider) rather
   than long-lived static keys wherever the platform supports it.
6. Total PR pipeline wall-clock target: **under 10 minutes**. Beyond 20 minutes, developers and
   agents start batching and working around it, and the pipeline stops being a gate. If it exceeds
   the target, that's a tracked defect against the pipeline, not an accepted fact.
7. Every stage emits machine-readable results into `docs/forge/reports/` so FORGE gates can consume
   the pipeline's verdict rather than re-running everything.

---

## 14.4 F-DELIVER-4 · Deployment strategy

Per deployable unit, decide the rollout mechanism and — the part usually skipped — the **automated
rollback trigger**.

| Strategy | Choose when | Requires |
|---|---|---|
| **Recreate** | Non-critical, downtime acceptable, single instance | A maintenance window |
| **Rolling** | Default for stateless services | Health checks, readiness probes, N+1 capacity, backward-compatible migrations |
| **Blue/green** | Fast rollback needed, capacity to run two full stacks | Traffic switch, dual-stack cost, session/state handling |
| **Canary** | High-risk changes, meaningful traffic volume | Metrics-based promotion, traffic splitting, per-cohort dashboards |
| **Progressive/feature-flagged** | Continuous delivery with decoupled release | Flag system, flag cleanup discipline |

**Normative:**

1. **Every deployment strategy must specify its rollback path and its automated rollback trigger**
   (error rate, latency p99, saturation, or a business metric) with a threshold and a time window.
   "We'd notice and roll back" is not a rollback plan.
2. **Rollback is rehearsed, not assumed.** `G-Deliver` requires evidence that a rollback was executed
   successfully in staging for this stage's changes — the single most commonly skipped and most
   consequential practice in this file.
3. **Schema changes and code changes deploy separately** under expand-contract (`12` F-DATA-6). A
   deployment that cannot be rolled back because the migration is destructive is refused: the
   migration must be forward-compatible with the previous code version.
4. Health checks distinguish **liveness** (am I broken?) from **readiness** (should I get traffic?).
   Conflating them causes cascading restarts under load.
5. Deployments are recorded: what artifact, what SHA, what config version, who/what triggered,
   duration, outcome. This record is what makes "what changed?" answerable during an incident, and
   it is the first thing `forge debug` reaches for.

---

## 14.5 F-OPS-1 · Observability design

The three signals, decided together with their conventions — not bolted on afterwards. Note that this
framework also satisfies the debugging preconditions in `13` §13.2 F-DEBUG-3.

### Decisions

| Aspect | Decision content |
|---|---|
| Instrumentation | **OpenTelemetry** as the default vendor-neutral SDK; backend chosen separately so it can change without touching code |
| Backend | From the catalog: LGTM stack, Datadog, New Relic, Honeycomb, Sentry, cloud-native. Chosen on cost, ops burden, retention, and query ergonomics |
| Logs | Structured JSON; mandatory fields: `timestamp`, `level`, `service`, `env`, `version`, `trace_id`, `span_id`, `event`, plus domain ids. Message text is a stable `event` name, not an interpolated sentence — interpolated messages are ungroupable |
| Levels | `error` = needs a human eventually; `warn` = degraded but handled; `info` = business-meaningful transitions; `debug` = off in prod. Anything logged at `error` must be actionable, or it trains everyone to ignore errors |
| Metrics | **RED** for services (Rate, Errors, Duration), **USE** for resources (Utilisation, Saturation, Errors); business metrics from the `MET-###` tree in the KB |
| Traces | Context propagated across every boundary **including queue messages and scheduled jobs**; sampling strategy recorded (head vs tail, rate, always-sample-errors) |
| Correlation | One id flows request → logs → traces → downstream calls → background jobs spawned by the request |
| PII | A redaction policy applied at the logging boundary, tested; log fields are allowlisted, not denylisted |
| Cardinality | Explicit limits on label/tag cardinality; no user ids or raw URLs as metric labels — this is the standard way to make an observability bill explode |

### SLOs and alerting

- Define SLIs from the user's perspective (successful request rate, latency at p95/p99, freshness),
  derived from the `NFR-###` set so the KB and the monitors agree by construction.
- SLOs with error budgets; alerts fire on **budget burn rate**, not on raw thresholds.
- **Every alert must be actionable and must link to a runbook.** An alert with no runbook is deleted
  or downgraded — this is enforced at `G-Operate`.
- Paging alerts are limited to user-impacting conditions; everything else is a ticket or a dashboard.

### Runbooks

For each Sev1 failure mode identified in the threat/failure analysis, a `RUN-###` artifact:
symptoms, immediate mitigation, diagnosis steps (with the exact commands), escalation, and
post-incident actions. Runbooks are written to be executable by an agent as well as a human, which
means concrete commands rather than "investigate the database".

---

## 14.6 F-DELIVER-5 · Release management

Decides: versioning scheme (SemVer for libraries/APIs, CalVer or SHA-based for services), release
cadence, changelog generation (from conventional commits), release notes audience, API deprecation
policy (announce → deprecate → sunset, with minimum windows), and feature-flag lifecycle.

**Feature flags** are a decision with a debt attached, so the framework requires:
- Every flag has an owner, a purpose, a type (release / experiment / ops kill-switch / permission),
  and — for release flags — a **removal date**.
- Stale release flags past their removal date fail a check. Unbounded flag accumulation turns one
  codebase into 2ⁿ untested codebases.
- Kill-switches are exempt from removal but are tested periodically.

**API versioning** (when a public or cross-team API exists): strategy chosen and recorded, with
backward-compatibility rules enforced by contract tests in the pipeline, so a breaking change fails
CI rather than a customer's integration.

---

## 14.7 F-OPS-2 · Operational readiness

The checklist that `G-Operate` enforces. Each item is either satisfied or has a recorded, expiring
waiver:

| # | Requirement |
|---|---|
| 1 | Deploy and rollback both executed successfully against staging for this stage |
| 2 | Dashboards exist for the stage's RED/USE metrics and its business metrics |
| 3 | Alerts exist for every stage SLO, tied to burn rate, each linking a runbook |
| 4 | A runbook exists for every identified Sev1 failure mode |
| 5 | Backups configured **and a restore has been tested** — an untested backup is a hope |
| 6 | Secrets rotation procedure documented; no static long-lived credentials in the deploy path |
| 7 | Log retention, PII redaction and access controls configured and verified |
| 8 | Capacity/cost model recorded, with a budget alarm |
| 9 | On-call/support expectations recorded honestly (including "there is no on-call; failures are handled next business day" — a legitimate answer that must be *stated*) |
| 10 | An incident process exists: severity definitions, who to notify, where the timeline is recorded |
| 11 | Deployment topology and pipeline diagrams present and not drifted (`08` §8.11.3) |
| 12 | The debugging preconditions in `13` F-DEBUG-3 are satisfied for all new paths |

---

## 14.8 F-OPS-3 · Cost model

Often deferred until it becomes a crisis, so FORGE requires a lightweight version early:

- Estimated monthly infrastructure cost per environment at the stage's expected scale, with the top
  three cost drivers named.
- The scaling relationship: what does cost do at 10× traffic? A model that is linear in requests but
  quadratic in storage is worth knowing about before it happens.
- Budget alarms configured at the cloud provider.
- Cost implications recorded in ADRs for any choice that materially moves the number (managed vs
  self-hosted, retention periods, egress-heavy designs, always-on vs scale-to-zero).
- For agent-driven development specifically, the token/cost ledger (`20`) is the second half of this
  picture: FORGE reports cost per merged story so the development method itself has a unit economics
  view.

---

## 14.9 Gate integration summary

| Gate | Delivery/ops checks |
|---|---|
| `G-Foundation` | Walking skeleton deploys to a real environment via the pipeline; one-command build/test/run; artifact produced and signed |
| `G-Design` | Deployment strategy, environment matrix and rollback approach recorded as ADRs; deployment topology diagram present |
| `G-Verify` | Pipeline green on the integration branch; artifact built, SBOM produced, signature verified |
| `G-Deliver` | Deploy dry-run passes; **rollback rehearsed in staging**; migrations forward-compatible; smoke and e2e green in the target environment; secrets resolved; approval obtained (`alwaysHuman` for production) |
| `G-Operate` | The §14.7 operational readiness checklist, all twelve items |
