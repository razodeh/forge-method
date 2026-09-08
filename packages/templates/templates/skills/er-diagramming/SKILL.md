---
id: er-diagramming
name: ER diagramming
version: 1.0.0
description: >
  How to draw an erDiagram that matches the designed data model, and how the schema-introspect-to-er
  generator later checks it against the real database.
when_to_use: >
  F-DATA-1's own conceptual/logical modelling output, or any entity with more than two lifecycle
  states (which also needs a stateDiagram-v2 -- see state-diagramming).
applies_to:
  agents: [data-architect]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Cardinality and optionality are not decoration

Every relationship line states its cardinality (one-to-one, one-to-many, many-to-many) and whether
the relationship is optional on each side. "Invoice has LineItems" with no cardinality shown answers
nothing a reviewer actually needs.

## No many-to-many without a real join entity

`12` §12.1's own validation rule: no many-to-many relationship without an explicit join entity, and
that join entity needs its own invariants stated (not just "it joins the two tables").

## This diagram gets checked against reality

`schema-introspect-to-er` compares the _designed_ model (this diagram) against the _actual_ database
schema -- a deterministic answer to "did we build what we designed?" A diagram that was never kept
in sync with real migrations will show real, actionable drift the first time this generator runs,
not a false alarm.

## Do not

- Do not omit the owning component for an entity -- `12` §12.1's own validation rule requires every
  entity have an owner (which component writes it), and the diagram should make that visible, not
  just the accompanying prose.
- Do not draw an entity with no identity strategy shown (natural vs surrogate key) -- that decision
  is part of the model, not an implementation detail to defer.
