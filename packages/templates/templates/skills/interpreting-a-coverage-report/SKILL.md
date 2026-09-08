---
id: interpreting-a-coverage-report
name: Interpreting a coverage report
version: 1.0.0
description: >
  What line/branch coverage actually tells you (a floor, not a quality signal), what AC coverage
  tells you that line coverage cannot, and how to read a coverage-ratchet failure correctly.
when_to_use: >
  Reviewing a coverage report at G-Verify, or deciding whether a coverage-ratchet failure represents
  a real regression.
applies_to:
  agents: [test-architect, reviewer, sdet]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Coverage is a floor detector, not a quality measure

`13` §13.1 F-TEST-5's own framing: high line coverage proves code _ran_ during tests, not that its
behaviour was actually checked. A test with `expect(result).toBeDefined()` as its only assertion
covers every line the code under test executes and proves almost nothing.

## AC coverage is the metric that actually binds

A story at 95% line coverage with one unbound acceptance criterion still fails. Check AC coverage
(every AC of every done story has at least one passing bound test) before treating a high
line-coverage number as sufficient evidence the story is actually verified.

## A ratchet failure is a real regression, read it as one

`coverage:ratchet` fails only when coverage _drops_ below where it already was -- there is no
"coverage was always kind of low here" excuse available once a ratchet exists. Find which file's
coverage actually dropped and why, rather than raising the tolerance to make the failure go away.

## Mutation testing is the real adequacy signal

A surviving mutant in domain logic (a line coverage would call "covered" but whose behaviour a
mutation wasn't actually caught by any test) is a missing test an agent can act on directly -- treat
a mutation report's findings as more actionable than a coverage percentage.

## Do not

- Do not treat 100% line coverage as "done" -- check AC binding and mutation survival before
  declaring a story adequately tested.
- Do not lower a coverage-ratchet threshold to unblock a merge without a documented reason -- that
  is exactly the silent regression the ratchet exists to prevent.
