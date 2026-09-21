---
# forge:generated v=0.0.0 hash=c17a7c6462e94820bf87939fd48ab131b55e77e5cd46e504a34fdf576ac72b3f — edits will be overwritten; use overrides/
id: conventional-commits
name: Conventional commits
version: 1.0.0
description: >
  How to write a commit message FORGE's own changelog generation and F-INIT-4's own commit
  convention can actually parse -- type, optional scope, and a description that states what changed
  and why.
when_to_use: >
  Every commit, when the project's own vcs-conventions decision selected Conventional Commits (11
  §11.1's own stated default).
applies_to:
  agents: [backend, frontend, mobile, data-engineer, platform]
activation: auto
budget_tokens: 700
forge_version: '>=1.0 <2'
---

## The shape

`<type>(<optional scope>): <description>` -- `feat`, `fix`, `docs`, `refactor`, `test`, `chore` are
the core types. `BREAKING CHANGE:` in the footer (or a `!` after the type/scope) for anything that
requires a major version bump under the project's own versioning scheme.

## The description answers "why," not just "what"

The diff already shows what changed. A commit message that just restates the diff in prose ("update
user.ts") adds nothing; one that states the reason ("fix: stop double-charging on retried webhook
delivery") is what makes `git log`/changelog generation actually useful later.

## One logical change per commit

A commit mixing an unrelated refactor with the actual fix makes both `git bisect` and code review
harder -- split them, even if it means more commits.

## Do not

- Do not use `feat` for a change that isn't user- or API-visible -- that inflates the generated
  changelog with noise.
- Do not write a commit message in the imperative-then-past-tense mix ("Added feature that fixes
  bug") -- pick imperative present ("add", "fix") and stay consistent.
