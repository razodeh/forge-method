Design the logical data model that the chosen architecture and the capabilities require, and analyse
how the data will be read and written, so that the technology step can select a product against real
access patterns instead of guesses.

### Inputs

- The `Capability` and `NFR` artifacts, and the glossary in the KB (`glossary.md`).
- The architecture from `select-architecture`: its ADRs, the architecture spec (which says which
  component owns which data), `architecture/components.md` (component ids), and the context and
  container views.
- The KB constraints (`constraints/**`), especially any mandated store and any regulatory or privacy
  constraint.

### What to produce

1. The `DataModel` artifact, at `docs/forge/specs/data/DM-001-<slug>.md`: one logical-model document
   with its own `DM-###` id, the id later artifacts cite in their `data` field. Per entity: identity
   (natural or surrogate key), attributes with type and nullability, invariants, lifecycle (created,
   updated, archived, deleted), and the owning component id. Then the relationships with cardinality
   and optionality, and the aggregates (the transactional boundaries). Also write a KB entry
   `data/data-model.md` that summarises the model and cites the artifact.
2. `data/access-patterns.md` (a KB entry): a table with one row per operation: read or write,
   frequency, latency budget (cite the NFR id), selectivity, result size, consistency requirement,
   and growth. The `select-tech-stack` step reads this file as a required input.
3. `data/consistency.md` (a KB entry): for each write operation, the consistency the user can
   observe (stated in plain words), the isolation and concurrency approach (optimistic versioning by
   default), and the idempotency key for every externally triggered mutation. Distributed
   transactions are not allowed by default: use an outbox with idempotent consumers or a saga with
   explicit compensations.
4. Diagrams, each a `Diagram` with caption and alt text and at most about 20 nodes and 30 edges: an
   `erDiagram` for each bounded context that has persistent state (`data/views/er-<context>.mmd`),
   and a `stateDiagram-v2` for every entity with more than two lifecycle states.
5. `data/migrations.md` (a KB entry): the migration strategy that does not depend on a tool:
   forward-only or reversible, expand-contract for any breaking change, how migrations run (and how
   a multi-instance start-up race is avoided), and the backfill approach for large tables (batched,
   resumable, throttled).
6. `data/lifecycle.md` (a KB entry): a privacy classification for each attribute (none, personal,
   sensitive, regulated), and the retention and deletion need that any personal or regulated
   attribute implies, including a test that deletion removes the data from every store, index and
   cache. Every soft-delete states its query policy.
7. An `ADR` (category `data`) for the storage category (for example relational, document, key-value,
   graph, time-series, search), chosen from the access patterns and consistency needs, with the
   score table. Choose a category, not a product; `select-tech-stack` picks the product inside it.
   If a constraint already mandates a store, record it as the decision and do not re-score.

### Declarations the gate reads

Write `docs/forge/kb/data/migrations.yaml`: a separate, machine-readable file from the prose
`data/migrations.md` strategy above. `G-Integration`'s `migration:order` check
(`forge spec validate --rule migration-order-violations`) reads it, not the prose. It is a `migrations`
list, in apply order, each entry `{id, phase, release, after?, expands?}`: `phase` is `expand`,
`migrate` or `contract`; `release` the release that ships it; `after` (optional) the ids it must
follow; `expands` (required on a `migrate` or `contract`) the id of the `expand` migration it belongs
to, whose `contract` entry must ship in a later release than that `expand` and than every `migrate` of
it (the destructive change is always a separate, later release, `12` F-DATA-6, `14` §14.4 rule 3). No
migration is planned at this step, so write it empty with a reason:

```yaml
migrations: []
none_reason: no migrations planned yet; migrate:plan-migration appends them against an ADR
```

A later `migrate` run appends its own ADR's phases to this same file (`plan-migration.md`); this step
only establishes it.

### Acceptance criteria

- Every capability's data needs are satisfiable from the model: name, for each capability, the
  entities it uses.
- Every entity has exactly one owning component that exists in `components.md`.
- No many-to-many relationship without an explicit join entity and its invariants.
- No transaction spans more than one aggregate. If one must, design the saga and its compensation
  now.
- Every access pattern that carries a latency figure cites the NFR it comes from; an operation with
  no NFR is flagged.
- The ADR's `diagrams` field references the ER diagram.

### Do not

- Do not choose a database product, ORM, or migration tool; the stack step picks them.
- Do not create entities for capabilities that are not in the inputs, or model tables for screens.
- Do not invent volumes or growth rates. Use the NFRs and constraints, or state an assumption with
  `validate_by`.
- Do not leave lifecycle, ownership or invariants blank because they are hard to decide; ask the
  human.
