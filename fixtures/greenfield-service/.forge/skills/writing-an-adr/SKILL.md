---
# forge:generated v=0.0.0 hash=349909467abf9e12c0704d4ff2e5d3f552338a8ea317a6b7aa122610fa295bbd — edits will be overwritten; use overrides/
id: writing-an-adr
name: Writing an ADR
version: 1.0.0
description: >
  How to write an Architecture Decision Record FORGE can actually use: the required fields, the
  score-table obligation, and the difference between a decision record and a design essay.
when_to_use: >
  Any time a decision framework's own output_template asks for an ADR, or a real decision was made
  outside a framework and still needs one recorded.
applies_to:
  agents: [architect, data-architect, platform, sre]
activation: auto
budget_tokens: 1200
forge_version: '>=1.0 <2'
---

## What an ADR is for

An ADR is a decision record, not a design essay. Its job is to let a future reader (human or agent)
understand what was decided, why, and what would make it wrong -- fast, without re-deriving the
analysis.

## Required shape

Every ADR (`08` §8.4) carries: `status`, `category`, `deciders`, `date`, `reversibility`,
`blast_radius`, `revisit_trigger`, `supersedes`/`superseded_by`, `related`, `diagrams`, `framework`.
None of these are decoration -- `revisit_trigger` in particular is what stops a bad decision
surviving by inertia: state the concrete condition that means "come back and re-decide," not "if it
stops working."

## The score table is not optional

`11` §11.0's own execution contract: "Frameworks MUST show the score table in the ADR. A
recommendation without a comparison table is a validation failure." One row per surviving option
(after elimination rules run), one column per the framework's own declared `criteria`, with evidence
in each cell -- not just a number. A score with no evidence is an opinion wearing a table.

## Do not

- Do not write the ADR before the decision is made -- an ADR documents a real decision, not a plan
  to decide later.
- Do not omit the killer risk of the chosen option. Every option has one; naming it is what makes
  the ADR honest.
- Do not leave `revisit_trigger` as "if requirements change" -- that is true of every decision ever
  made and therefore says nothing.
