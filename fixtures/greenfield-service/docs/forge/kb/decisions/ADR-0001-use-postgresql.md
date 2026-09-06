---
id: ADR-0001
type: ADR
schemaVersion: 1
title: Use PostgreSQL as the primary transactional store
status: accepted
created: 2026-01-05
updated: 2026-01-05
revision: 1
author: architect
changelog: []
category: data
deciders: [ architect ]
date: 2026-01-05
reversibility: medium
blast_radius: [ data, api ]
revisit_trigger: "write throughput > 5k tps sustained"
supersedes: []
superseded_by: null
related: []
diagrams: [ DIAG-001 ]
framework: data-store-selection
---

## Context
The service needs a durable transactional store from day one.

## Options considered
| Option | Pros | Cons | Fit score | Killer risk |
|---|---|---|---|---|
| PostgreSQL | mature, relational | ops overhead | 0.86 | none |
| DynamoDB | managed | no joins | 0.6 | modelling risk |

## Decision
Use PostgreSQL as the primary transactional store.

## Diagram
See `architecture/views/containers.mmd` (DIAG-001) for the resulting container topology.

## Consequences
### Positive
Well-understood operational model.

### Negative / accepted costs
Requires running and patching a database.

### Follow-on work
None yet.

## Reversal plan
Migrate to a different store if throughput requirements change; no data has been written yet.
