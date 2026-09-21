---
# forge:generated v=0.0.0 hash=42f6fb54338402ab1989040bdf2ba59aaa1f972e6687d67420ced20838379843 — edits will be overwritten; use overrides/
id: expand-contract-migration
name: Expand-contract migration
version: 1.0.0
description: >
  How to make a breaking schema or interface change safely, in two releases, with no window where
  old and new code cannot both run against the current state.
when_to_use: >
  Any breaking schema change, or a deployment strategy whose rollback path requires the previous
  code version to keep working against the current data.
applies_to:
  agents: [data-architect, backend, sre]
activation: auto
budget_tokens: 1100
forge_version: '>=1.0 <2'
---

## The discipline in one sentence

Never make a change that only one version of the code can tolerate. Expand (add the new shape,
additive only) -> migrate the data/callers -> contract (remove the old shape), each its own deploy,
each independently rollback-safe.

## Why this exists

`14` §14.4's own rule 3: "a deployment that cannot be rolled back because the migration is
destructive is refused: the migration must be forward-compatible with the previous code version." A
single-step breaking migration makes rollback impossible the moment it runs -- there is no version
of the old code that still works.

## The three steps, concretely

1. **Expand**: add the new column/field/endpoint alongside the old one. Both old and new code paths
   work. Deploy. Nothing observes a difference yet.
2. **Migrate**: backfill data (batched, resumable, throttled for a large table -- `12` §12.1),
   double-write if needed, switch reads to the new shape once backfill is verified complete.
3. **Contract**: once every caller is confirmed on the new shape, remove the old
   column/field/endpoint in its own separate deploy.

## Do not

- Do not combine the expand and contract steps into one release "to save time" -- that is exactly
  the single-step breaking migration this discipline exists to prevent.
- Do not contract before confirming every consumer (including any external one) has actually moved
  -- "probably nothing uses it anymore" is not verification.
