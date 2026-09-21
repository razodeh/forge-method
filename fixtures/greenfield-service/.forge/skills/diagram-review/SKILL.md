---
# forge:generated v=0.0.0 hash=802e295111171751b7d30393b3ba5c9667ba9c9b76e34bf7cd1b583c03569112 — edits will be overwritten; use overrides/
id: diagram-review
name: Diagram review
version: 1.0.0
description: >
  What to actually check when reviewing a diagram -- the same checks @forge/diagrams' own lint rules
  run mechanically, plus the judgement calls a linter cannot make.
when_to_use: >
  Reviewing any diagram before it lands, or as part of the "Documentation" review perspective (13
  §13.3's own F-REVIEW-1 table: "diagram updated if structure changed").
applies_to:
  agents: [reviewer, architect]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## What the linter already checks -- verify it ran, don't re-derive it by eye

`diagram:refs` (every `depicts` id resolves), `diagram:orphan-nodes` (no disconnected node),
`diagram:complexity` (within the node/edge budget), `diagram:label-quality` (no placeholder labels),
`diagram:caption` (caption and alt_text both real sentences), `diagram:staleness` (not past its
`review_by` date). A diagram that hasn't been run through `forge diagram validate` has not actually
been checked.

## What only a human or reviewing agent catches

Does the diagram actually match the structure it claims to depict, or has the code moved on since it
was drawn (drift a `generated: true` diagram's own generator would catch, but a hand-authored one
would not)? Does the level of detail match the audience (a component diagram shown to someone who
only needed context)? Is a genuinely important boundary or failure path missing, not just poorly
labelled?

## Structure changed, diagram didn't -- that's a finding

`13` §13.3's own Documentation perspective names this directly: a diagram not updated when the
structure it depicts changed is a real review finding, not a nice-to-have.

## Do not

- Do not approve a diagram on the strength of "it looks fine" without checking it actually passed
  `forge diagram validate` -- a linter finding is objective; a vibe is not.
- Do not treat diagram review as separate from code review for the same change -- if the change
  altered structure, the diagram is part of the diff under review.
