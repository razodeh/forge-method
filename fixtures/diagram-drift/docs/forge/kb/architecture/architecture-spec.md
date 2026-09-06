---
id: KB-ARCH-0001
type: knowledge
section: architecture
title: System architecture overview
status: active
confidence: high
owner: architect
sources:
  - kind: decision
    ref: ADR-0001
created: 2026-03-05
updated: 2026-03-05
verified: 2026-03-05
review_by: 2026-06-05
supersedes: []
superseded_by: null
related: []
diagrams: [DIAG-001]
tags: [architecture]
applies_to: [component:api, component:db]
---

## Statement

The billing service is decomposed into an API container and a Database container.

<!-- forge:diagram id=DIAG-001 src=docs/forge/kb/architecture/views/containers.mmd -->
```mermaid
%% forge:generated-from docs/forge/kb/architecture/views/containers.mmd — do not edit here
flowchart TB
  component_api["API"]
  component_db["Database"]
  component_api --> component_db
```
<!-- /forge:diagram -->

## Rationale

See ADR-0001 for the container split.

## Implications

Any new container must be reflected in `components.yaml` and regenerated here.

## Verification

Run `forge diagram validate -C fixtures/diagram-drift`.
