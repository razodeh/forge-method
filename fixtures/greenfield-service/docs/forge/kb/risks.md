---
type: Risk
schemaVersion: 1
title: Risk register
status: active
created: 2026-01-05
updated: 2026-01-05
revision: 1
author: architect
changelog: []
risks:
  - id: RISK-001
    statement: Quick invoice path bypasses tax validation
    likelihood: medium
    impact: high
    mitigation: Route the quick path through the same validator as the full form
    owner: architect
  - id: RISK-002
    statement: Single database instance is a single point of failure
    likelihood: low
    impact: high
    mitigation: Add a read replica before the first production release
    owner: platform
---

Risk register for the greenfield service.
