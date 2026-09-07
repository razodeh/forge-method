---
id: KB-ENG-0001
type: knowledge
section: engineering
title: Coding standards
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
related: [ KB-CON-0001 ]
diagrams: []
tags: [ standards ]
applies_to: []
---

## Statement
All TypeScript code follows the repository's own ESLint configuration with no disabled rules.

## Rationale
Consistency across the codebase reduces review overhead and onboarding time.

## Implications
A pull request that fails lint is not mergeable.
