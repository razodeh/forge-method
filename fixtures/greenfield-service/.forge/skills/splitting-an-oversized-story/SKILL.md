---
# forge:generated v=0.0.0 hash=36a0e7d4126d683b1ef584d44d79d9c46b40d563c4176dbcfc836adda136bb97 — edits will be overwritten; use overrides/
id: splitting-an-oversized-story
name: Splitting an oversized story
version: 1.0.0
description: >
  How to split a story that fails G-Ready for being oversized into smaller stories that are each
  still independently valuable and independently testable.
when_to_use: >
  A story is flagged oversized at planning time, or a story in flight is revealed to be bigger than
  estimated.
applies_to:
  agents: [po, pm, em]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Split by value, not by layer

The most common bad split is "backend story" + "frontend story" -- neither is independently
demonstrable, and the first one sits undeployed until the second lands. Prefer splitting along a
real seam: by workflow step, by data variation, by rule variant, or by
happy-path-first-then-edge-cases.

## Every resulting story keeps its own acceptance criteria

A split that leaves one child story with no ACs of its own (because "the parent story's ACs still
cover it") has not actually split the story -- it has just renamed a task. Each child must be
independently `done`-able against its own bound tests.

## Check for hidden coupling before finalising

If two candidate child stories both need to touch the same file in the same commit to be
individually correct, the split is wrong -- that is the exact shape `G-Ready`'s own "story overlap
in file claims" check exists to catch.

## Do not

- Do not split purely by estimated hours with no regard for independent value.
- Do not leave a "glue" story with no user-visible behaviour of its own unless it is explicitly a
  walking-skeleton or infrastructure story, and say so.
