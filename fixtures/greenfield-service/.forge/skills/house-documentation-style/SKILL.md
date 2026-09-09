---
# forge:generated v=1 hash=b685474c8789605f828f8d937a65657a30b5a8aa4b6274f51a823dce57b51102 — edits will be overwritten; use overrides/
id: house-documentation-style
name: House documentation style
version: 1.0.0
description: >
  Baseline prose conventions for FORGE-generated documentation -- plain, specific, and structured
  for scanning, not for reading start to finish.
when_to_use: >
  Writing any KB entry, README section, or prose documentation not already covered by a more
  specific writing skill (changelog-writing, api-reference-writing).
applies_to:
  agents: [techwriter, analyst, pm]
activation: auto
budget_tokens: 700
forge_version: '>=1.0 <2'
---

## Write for scanning, not narration

Lead each section with the conclusion, then the supporting detail -- a reader (human or agent)
deciding whether a document is relevant should be able to tell from the first sentence of each
section, not the last.

## Concrete over abstract

"The system handles errors gracefully" says nothing verifiable. "A failed payment returns a 402 with
a `PaymentFailed` error code and does not retry automatically" says something a reader can act on.
Prefer the second shape everywhere.

## State what is not true, not just what is

Documentation that only states positive claims lets a reader assume anything unstated. Explicitly
naming what a feature does _not_ do, or what a component is _not_ responsible for, prevents the
misunderstanding a purely positive description invites.

## Do not

- Do not bury the actual answer in a wall of context before stating it -- lead with it.
- Do not use hedge words ("generally", "usually", "in most cases") without stating the actual
  exception -- if there's an exception worth naming, name it; if there isn't, drop the hedge.
