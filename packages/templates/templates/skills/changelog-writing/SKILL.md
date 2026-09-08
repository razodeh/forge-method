---
id: changelog-writing
name: Changelog writing
version: 1.0.0
description: >
  How to write a changelog entry for the release-management framework's own consumer-facing output
  -- what changed for the reader, not what commits landed.
when_to_use: >
  Producing release notes as part of release-management.framework.yaml's own output, generated from
  conventional-commit history.
applies_to:
  agents: [release, techwriter]
activation: auto
budget_tokens: 700
forge_version: '>=1.0 <2'
---

## Audience-first, not commit-first

A changelog entry answers "what does this mean for someone using the software," not "what commit
landed." Ten small commits implementing one feature become one changelog line describing the
feature, not ten lines describing the commits.

## Group by what the reader cares about

Breaking changes first (with the migration action stated), then new features, then fixes, then
internal/chore changes -- often omitted from a user-facing changelog entirely. A reader scanning for
"do I need to change anything" should find the answer in the first section.

## Every breaking change states the migration action

Not just "the `foo` parameter was removed" -- "the `foo` parameter was removed; pass `bar` instead."
`14` §14.6's own API-versioning rule (announce -> deprecate -> sunset) means a breaking change in
the changelog should already have been signalled in an earlier release's own deprecation notice, not
appear as a surprise.

## Do not

- Do not paste raw conventional-commit subjects verbatim into the changelog -- they're written for
  `git log`, not for the reader deciding whether to upgrade.
- Do not omit a breaking change from the changelog because it "shouldn't affect most users" -- state
  it and let the reader judge.
