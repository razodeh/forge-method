The step brief lists what to produce. This is how to do the modelling well.

**Model in the order that keeps you honest.** Entities and invariants first, from capabilities and
the glossary, not from screens. Then the access-pattern table. Only then the storage category, and
that last, because every earlier step is evidence for it. If you catch yourself naming a database
while the access-pattern table is still empty, stop and finish the table.

**Entities.** For each, decide identity deliberately (a natural key you can defend, or a surrogate
with the natural key kept unique), write the invariant in a sentence a test could check, and name
the single owning component. Look for the modelling smells that produce later pain: an entity with a
status column and no lifecycle definition; a "type" column that hides two different entities; a
generic key-value or JSON attribute bag standing in for a decision not made; a many-to-many without
its join entity; a soft delete with no query policy; money or quantities without a unit and exact
type; timestamps without a stated zone.

**Access patterns.** Cover the operations the capabilities imply, including the unglamorous ones
(list with filter and sort, bulk import, deletion for a data-subject request, the report someone
will ask for in month three). Where an NFR gives no number, write the assumption and its validation
instead of leaving a blank. The table is what the technology step will hold your storage choice to,
so ambiguity here is expensive.

**Storage category.** If a constraint already mandates a store, record that as the decision and do
not re-score. Otherwise score against the access patterns and consistency needs, and stay with one
relational store until a specific pattern demonstrably does not fit. If you propose a second store
or a derived index (search, cache), say what it is a copy of, the hazard of writing to both and how
that is avoided, and how it is rebuilt.

**Consistency and lifecycle are part of this deliverable, not afterthoughts.** For each operation
that writes shared state, state the consistency a user can observe in plain terms, the isolation
level and the anomalies you accept, the concurrency control (optimistic versioning by default), and
the idempotency key, its storage and lifetime for every externally triggered mutation; a transaction
that would span aggregates is designed as a saga with its compensations now. Cover any cache with
the event that invalidates it and a hit-rate target stated as a labelled assumption. For personal
data, classify each attribute, set retention, and say how deletion and subject-access export work
across every store, derived index and cache. Where an input is truly unknown, ask the human or
record a labelled assumption with its validation; do not leave a blank.

**Check before you finish** that the diagram entities are all modelled entities and that every
classification you made is one you can defend. Route questions about what a regulation requires of a
field to security or compliance to confirm; you propose the classification and retention, they
confirm the obligation.
