---
id: KB-ARCH-0001
type: knowledge
section: architecture
title: Asynchronous work execution strategy
status: active
confidence: verified
owner: architect
sources:
  - kind: decision
    ref: ADR-0001
  - kind: human
    ref: "elicitation 2026-01-05, stage MVP"
created: 2026-01-05
updated: 2026-01-05
verified: 2026-01-05
review_by: 2026-04-05
supersedes: []
superseded_by: null
related: [ RUN-001 ]
diagrams: [ DIAG-001 ]
tags: [ architecture, data ]
applies_to: [ component:api, component:db ]
---

## Statement
The service stores its transactional state in a single relational database.

## Rationale
See ADR-0001 for the full options analysis.

## Implications
Every component that needs durable state talks to the database directly or via the API.

## Verification
Run `forge kb lint -C fixtures/greenfield-service` and confirm no KB-ARCH-0001 findings.
