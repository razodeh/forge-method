---
# forge:generated v=0.0.0 hash=d222542f258396c4af912f36a3f31bf5527222743eda0720d113670363facaec — edits will be overwritten; use overrides/
id: git-hygiene-for-lanes
name: Git hygiene for lanes
version: 1.0.0
description: >
  How an agent lane should use git so its own branch stays mergeable and its history stays honest --
  worktrees, rebase discipline, and what never to force.
when_to_use: >
  Any agent lane doing real work on its own branch/worktree, and especially before a merge-queue
  attempt.
applies_to:
  agents: [backend, frontend, mobile, data-engineer, platform, sre]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## One lane, one worktree, one branch

A lane operates in its own git worktree on its own branch -- never directly on the integration
branch, never sharing a worktree with another lane. This is what makes concurrent lanes safe at all.

## Rebase onto integration before attempting a merge

Keep the lane's branch current with the integration branch via rebase, not merge-into-lane -- a lane
branch with a tangled merge history is harder for the merge queue's own conflict resolver to reason
about than a clean, rebased, linear one.

## Never force-push over history someone else's tooling depends on

A lane force-pushing its own feature branch after a rebase is normal. Force-pushing the integration
branch, or any branch the merge queue or another lane has already built on, is not -- it silently
invalidates work in flight.

## Commit at real checkpoints, not arbitrarily

A commit should represent a real, working checkpoint (a red test, a green test, a completed refactor
step) -- per `10` §10.6's own inner loop, not an arbitrary save-point mid-thought. This is what
makes `git bisect` during an RCA actually useful later.

## Do not

- Do not commit directly to the integration branch from a lane -- every change goes through the
  merge queue.
- Do not amend or rebase-drop a commit that has already been referenced by an artifact (a
  Forge-Step/ Forge-Run trailer, an RCA record) -- that reference is now dangling.
