# 12 — Decision Frameworks II: Data Modeling & Technology Selection

## 12.1 Data modeling frameworks

Owner: `data-architect`. Outputs land in `kb/data/**` and `docs/forge/specs/data/`.

### F-DATA-1 · Conceptual & logical modelling
Procedure:
1. Extract candidate entities from capabilities, the domain model and the glossary.
2. For each entity: identity (natural vs surrogate key), attributes with types and nullability,
   invariants, lifecycle (created/updated/archived/deleted), ownership (which component writes it).
3. Relationships with cardinality and optionality; identify aggregates (transactional boundaries).
4. Produce an ER diagram via the `datamodel-to-er` generator + `DM-###` artifacts, plus a
   `stateDiagram-v2` for every entity with more than two lifecycle states (`08` §8.11.3).
   The `schema-introspect-to-er` generator later compares this designed model against the *actual*
   database schema — a deterministic answer to "did we build what we designed?"
5. Validate: every capability's data needs are satisfiable; no entity without an owner; no
   many-to-many without an explicit join entity and its own invariants; every soft-delete has a
   query policy.

**Aggregate rule:** a transaction must not span aggregates. If it must, that's a saga — and the
saga's compensation must be designed before the story is `ready`.

### F-DATA-2 · Access-pattern analysis (before choosing a store)
For each operation: read/write, frequency, latency budget (from NFRs), selectivity, result size,
consistency requirement, and growth. Produces `data/access-patterns.md` as a table.
**This runs before F-DATA-3.** Choosing a database before knowing the access patterns is an
anti-pattern the framework refuses: `F-DATA-3` has `requires: [ access-patterns ]`.

### F-DATA-3 · Storage selection
Per data set (not per project — polyglot persistence is allowed but each store needs an ADR).

Rule-based elimination first:

| Signal | Implication |
|---|---|
| Multi-entity transactional invariants | relational (or a store with real multi-doc ACID) |
| Rich ad-hoc queries / reporting | relational or analytical store |
| Well-known access paths, extreme scale, single-key lookups | key-value / wide-column |
| Hierarchical/variable documents, aggregate-per-document | document store |
| Relationship traversal is the query | graph |
| Time-ordered append + range scans + downsampling | time-series |
| Full-text/relevance/facets | search engine (as a *derived* index, never the source of truth) |
| Ephemeral, low-latency, expendable | cache/in-memory |
| Analytical scans over columns | columnar / warehouse |
| Immutable event log as source of truth | event store / log |

Then score candidates on: fit-to-access-patterns, consistency model match, operational burden,
team familiarity, cost at projected scale, ecosystem/driver maturity, migration/exit cost,
managed-service availability in the target cloud, and licence.

**Normative defaults & guardrails:**
- Default to **one relational store (PostgreSQL-class)** until an access pattern *demonstrably*
  doesn't fit. Postgres also covers JSON documents, full-text (to a point), geospatial, queues
  (`SKIP LOCKED`) and time-series (with partitioning) — the ADR must state why a second store beats
  a Postgres feature.
- Adding a second store requires an ADR covering: dual-write hazard and how it's avoided (outbox,
  CDC, or single-writer), backup/restore for both, and the consistency window users will observe.
- A search index or cache is never a source of truth; the ADR must name the rebuild procedure.

### F-DATA-4 · Consistency, CAP and transaction design
Per operation, decide and record:
- **Consistency requirement**: strong / read-your-writes / monotonic / eventual — with the *user-
  visible* consequence stated in plain language ("the invoice list may lag by up to 2 s").
- **CAP posture** for each distributed store: under partition, do we choose availability or
  consistency, and what does the client see? (Plus PACELC: latency-vs-consistency in the normal case.)
- **Isolation level** per transaction class, with the anomalies accepted (write skew, phantom, lost
  update) and how they're prevented (constraints, `SELECT … FOR UPDATE`, serializable, versioning).
- **Idempotency** for every externally-triggered mutation: key source, storage, TTL.
- **Concurrency control**: optimistic (version column, ETag/If-Match) vs pessimistic; default is
  optimistic with a version column on every mutable aggregate root.
- **Distributed transactions**: forbidden by default. Use outbox + at-least-once + idempotent
  consumers, or a saga with explicit compensations. 2PC requires an ADR and a human approval.

Output: `data/consistency.md` with a per-operation table, plus concrete test obligations (e.g. a
concurrent-update test for every optimistic-locking path).

### F-DATA-5 · Caching strategy
Per read path: what, where (client/CDN/edge/app/query), pattern (cache-aside/read-through/
write-through/write-behind), key design, TTL, invalidation trigger, stampede protection
(single-flight, jitter), negative caching, and the correctness consequence of a stale entry.
Rule: **no cache without a named invalidation event and a measured hit-rate target.**

### F-DATA-6 · Schema evolution & migrations
Decides: migration tool, forward-only vs reversible, how migrations run (CI step, init container,
app startup — with a decision on the multi-instance race), the **expand-contract** discipline for
breaking changes, backfill strategy for large tables (batched, resumable, throttled), zero-downtime
rules (no destructive change in the same release as the code that stops using it), and rollback.
Outputs: `data/migrations.md`, migration directory conventions, a CI check that every migration is
(a) reversible or explicitly flagged, (b) tested against a seeded copy, (c) idempotent.

### F-DATA-7 · Data lifecycle, privacy and retention
PII classification per field (none/personal/sensitive/regulated), lawful basis where relevant,
retention period, deletion mechanism (hard delete, crypto-shred, anonymise), export path for subject
access, audit logging of access, and a **data map** artifact linking every PII field to its stores,
backups, logs and third parties. Deletion must be testable: a test that creates, deletes and asserts
absence across all stores (including derived indexes and caches) is required when PII exists.

### F-DATA-8 · Analytical / pipeline design (module `fm-data`)
When the product has analytics: source systems, ingestion (batch/CDC/stream), landing/staging/
curated layering, transformation engine, orchestration, scheduling and SLAs, data quality tests,
lineage, schema registry and evolution, partitioning strategy, late/duplicate/out-of-order handling,
backfill/replay, and cost per TB scanned. Stream/event processing choices (see catalog) get their own
ADR covering delivery semantics (at-most/at-least/effectively-once), windowing, watermarks and state
store durability.

---

## 12.2 The Technology Catalog

`@forge/catalog` ships curated, versioned entries. **Design constraint: the catalog encodes
*selection criteria and trade-offs*, not benchmarks or version numbers that rot.**

```yaml
# canonical: catalog/<kind>/<id>.entry.yaml
id: postgresql
kind: datastore            # language | framework | datastore | queue | stream | cache | search |
                           # ci | observability | infra | auth | payments | testing | frontend |
                           # mobile | orm | api-style | cloud | container | iac
name: PostgreSQL
category: relational
maturity: mature           # emerging | growing | mature | legacy | declining
licence: PostgreSQL (permissive)
managed_options: [ aws-rds, aws-aurora, gcp-cloudsql, azure-flexible, neon, supabase, crunchy ]
strengths:
  - "ACID with strong isolation options, including serializable"
  - "Extremely broad feature surface: JSONB, full-text, GIS, partitioning, LISTEN/NOTIFY, SKIP LOCKED"
  - "Operational knowledge is commodity; every cloud has a managed offering"
weaknesses:
  - "Horizontal write scaling requires extra machinery (Citus, sharding at app level)"
  - "Connection-heavy workloads need a pooler (pgbouncer/pgcat)"
  - "Long-running transactions and bloat require vacuum awareness"
fits_when:
  - "transactional invariants across entities"
  - "ad-hoc and reporting queries expected"
  - "team familiarity is a priority"
avoid_when:
  - "single-key access at millions of ops/sec with no relational needs"
  - "petabyte-scale analytical scans (use a columnar store instead)"
pairs_with: [ pgbouncer, flyway, prisma, sqlc, debezium, timescaledb ]
alternatives: [ mysql, cockroachdb, yugabyte, dynamodb, mongodb, sqlite ]
operational_burden: medium
team_familiarity_weight: high
exit_cost: medium
agent_friendliness: high   # how well an AI agent can work with it: tooling, deterministic CLI, local dev
notes_for_agents:
  - "Use a migration tool; never ALTER by hand in code"
  - "Local dev via docker compose; tests via a template database or testcontainers"
```

### Catalog scope (v1 minimum coverage)

| Kind | Must include |
|---|---|
| Languages | TypeScript/JS, Python, Java, Kotlin, Go, Rust, C#, Ruby, PHP, Elixir, Swift, Scala, C++ |
| Backend frameworks | Spring Boot, Quarkus, Micronaut, ASP.NET Core, Django, FastAPI, Flask, Rails, Laravel, Express, Fastify, NestJS, Gin/Echo/Fiber, Axum/Actix, Phoenix, Ktor |
| Frontend | React, Next.js, Remix, Vue/Nuxt, Angular, Svelte/SvelteKit, Solid, Astro, HTMX+server-rendered, Qwik |
| Mobile/cross-platform | Swift/SwiftUI, Kotlin/Compose, React Native/Expo, Flutter, Ionic/Capacitor, .NET MAUI, Tauri, Electron |
| Stacks (as compositions) | MERN/MEAN, T3, .NET stack, JVM+React, Django+HTMX, Rails+Hotwire, LAMP, Serverless-first, Phoenix LiveView |
| Datastores | PostgreSQL, MySQL/MariaDB, SQLite, CockroachDB, YugabyteDB, MongoDB, DynamoDB, Cassandra/ScyllaDB, Redis/Valkey, Neo4j, ClickHouse, DuckDB, Snowflake, BigQuery, Redshift, InfluxDB/Timescale, Elasticsearch/OpenSearch, Meilisearch/Typesense, S3-class object stores, EventStoreDB |
| Messaging/stream | Kafka, Redpanda, RabbitMQ, NATS/JetStream, AWS SQS/SNS/EventBridge/Kinesis, GCP Pub/Sub, Azure Service Bus, Pulsar, Temporal (durable execution) |
| Stream/batch processing | Flink, Spark, Kafka Streams, Beam, dbt, Airflow, Dagster, Prefect, Airbyte, Debezium |
| API styles | REST, GraphQL, gRPC, tRPC, WebSocket/SSE, webhooks, GraphQL Federation, AsyncAPI |
| ORM/data access | Prisma, Drizzle, TypeORM, SQLAlchemy, Django ORM, Hibernate/JPA, jOOQ, sqlc, Ecto, ActiveRecord, raw SQL + query builder |
| Auth | OAuth2/OIDC, SAML, JWT vs sessions, Auth0/Okta/Entra, Keycloak, Ory, Clerk, Supabase Auth, Cognito, WebAuthn/passkeys |
| CI/CD | GitHub Actions, GitLab CI, Jenkins, CircleCI, Buildkite, Argo CD, Flux, Spinnaker |
| Containers/orchestration | Docker, Podman, Kubernetes, ECS/Fargate, Nomad, Cloud Run, App Runner, Fly.io, Render, Railway, Vercel, Netlify |
| IaC | Terraform/OpenTofu, Pulumi, CDK, CloudFormation, Ansible, Helm, Kustomize, Crossplane |
| Observability | OpenTelemetry, Prometheus, Grafana+Loki+Tempo+Mimir (LGTM), Datadog, New Relic, Honeycomb, Sentry, Elastic, Jaeger, Pyroscope |
| Testing | Vitest/Jest, Playwright, Cypress, pytest, JUnit5, testcontainers, k6/Gatling/Locust, Pact (contract), Schemathesis, Hypothesis/fast-check, Stryker (mutation) |
| Feature flags & config | OpenFeature, Unleash, LaunchDarkly, Flagsmith, env+config service |
| Secrets | Vault, AWS/GCP/Azure secret managers, SOPS+age, Doppler, 1Password/Infisical |

### Catalog hygiene rules
- Entries never claim "fastest", "best", or performance numbers. They claim *fit conditions*.
- Every entry carries `agent_friendliness` and `notes_for_agents` — a first-class concern here,
  because a stack an agent can't run locally or test deterministically will fail in FORGE regardless
  of its merits.
- Entries are versioned with the catalog; `forge module update` refreshes them.
- Users can add/override entries in `<project>/.forge/overrides/catalog/` (project-specific approved
  and forbidden technology lists — critical for enterprises with a mandated stack). This is surface
  C10 in `15` §15.1 and follows the same layering, provenance and upgrade-safety rules as every other
  customization.

## 12.3 Technology selection engine

`F-TECH-1 · Stack selection` is the framework that consumes the catalog.

Inputs: constraints (mandated/forbidden tech, team skills, cloud, licence policy, compliance),
architecture style, access patterns, NFRs, deployment targets, and the *scale/level*.

Procedure:
1. **Constraint filter** — remove anything violating a hard constraint. Print what was removed and
   why (this transparency is required; silent elimination is a bug).
2. **Coherence grouping** — technologies are selected as a *coherent stack*, not independently.
   The engine prefers combinations with existing `pairs_with` edges and penalises combinations that
   introduce a new runtime, a new package manager, or a new deployment mechanism without cause.
3. **Score** on weighted criteria: fit-to-requirements, team familiarity, ecosystem maturity,
   operational burden, hiring/AI-support (how well-represented in training data — a real factor for
   agent-driven development), cost, exit cost, `agent_friendliness`.
4. **Runtime-count penalty** — every additional language runtime, datastore, or infra primitive costs
   points. Complexity must be paid for by a named requirement.
5. **Output** — a `TechStack` artifact + an ADR per significant choice + a `pairs_with`-derived list
   of the actual libraries to install + the `notes_for_agents` merged into
   `engineering/standards.md`.

**Hard rules:**
- The number of primary languages defaults to 1 (2 max at L3) unless an ADR justifies more.
- Any technology with `maturity: emerging` requires human approval and a documented fallback.
- If `constraints/technical.md` mandates a stack, the engine does not re-litigate it; it records the
  mandate as the decision with `framework: mandated` and moves on.

## 12.4 Worked example of the output shape

```
ADR-0009  Primary language and backend framework      → TypeScript + Fastify
ADR-0010  Frontend framework                          → Next.js (App Router)
ADR-0011  Primary datastore                           → PostgreSQL 16 (managed: Neon at MVP)
ADR-0012  Data access                                 → Drizzle + raw SQL for reports
ADR-0013  Async work execution                        → Postgres-backed queue (pgboss) at MVP;
                                                         extraction trigger: >200 jobs/s or >2 consumers
ADR-0014  Observability                               → OpenTelemetry SDK → Grafana Cloud (LGTM)
ADR-0015  CI/CD                                       → GitHub Actions; deploy via Fly.io
ADR-0016  Auth                                        → OIDC via Clerk; exit plan documented
```
Note ADR-0013: the *cheap* option chosen with an explicit, measurable extraction trigger. That
pattern — pick the boring thing, record the trigger that would change the answer — is the house
style FORGE should produce everywhere.
