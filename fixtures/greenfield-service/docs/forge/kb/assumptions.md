---
type: Assumption
schemaVersion: 1
title: Assumption register
status: active
created: 2026-01-05
updated: 2026-01-05
revision: 1
author: architect
changelog: []
assumptions:
  - id: ASM-001
    text: Single deployable at MVP; a second service arrives at M2
    confidence: high
    validate_by: stage plan review at M2 kickoff
  - id: ASM-002
    text: Traffic stays under 100 requests per second through MVP
    confidence: medium
    validate_by: first production load test
---

Open assumptions for the greenfield service.
