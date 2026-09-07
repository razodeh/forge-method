---
id: KB-CON-0001
type: knowledge
section: constraints
title: No new language runtimes without an ADR
status: active
confidence: high
owner: architect
sources:
  - kind: human
    ref: "elicitation 2026-01-05, stage MVP"
created: 2026-01-05
updated: 2026-01-05
review_by: 2026-04-05
supersedes: []
superseded_by: null
related: [ KB-ARCH-0001, KB-ENG-0001 ]
diagrams: []
tags: [ constraints ]
applies_to: []
---

## Statement
The service stays on Node.js and TypeScript; no other language runtime may be introduced without an ADR.

## Rationale
A single runtime keeps the operational surface small for a two-person team.

## Implications
A dependency requiring a different runtime (e.g. a Python ML library) needs an ADR first.
