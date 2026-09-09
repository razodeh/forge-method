---
# forge:generated v=1 hash=2faf2853980146d1035af063a2c64ed6ca97674b58686cfb0b17ba1c0afc2513 — edits will be overwritten; use overrides/
id: writing-testable-acceptance-criteria
name: Writing testable acceptance criteria
version: 1.0.0
description: >
  How to write acceptance criteria that bind to a real, strong test oracle instead of vague prose no
  one can verify.
when_to_use: >
  Writing or reviewing a Story's acceptance criteria, before any test is written against them.
applies_to:
  agents: [po, test-architect, sdet]
activation: auto
budget_tokens: 1000
forge_version: '>=1.0 <2'
---

## The rule

An acceptance criterion that cannot be bound to a passing test is not a criterion, it is a wish.
`09` §9.5's own binding rule: every AC of a `done` story must have at least one passing bound test,
checked by AC id, not by "the tests for this story pass."

## Shape

Prefer Given/When/Then or an explicit input -> output pair over adjective-heavy prose. "The invoice
total is correct" is not testable; "given a 3-item invoice at 10% tax, the total is 110.00" is.

## Pick the oracle while writing the AC, not after

See the `test-oracle-design` skill for the full strength ladder. The AC's own wording should already
imply which oracle applies -- a concrete expected value implies "specified value" (the strongest); a
vague "works correctly" implies nothing, which is the actual problem.

## Do not

- Do not write an AC as a restatement of the implementation ("calls the repository and returns the
  result") -- that binds a test to the code, not to the requirement.
- Do not write an AC no test could ever falsify ("the UI is intuitive").
- Do not bundle two independent behaviours into one AC -- split them, so one failing behaviour does
  not hide a passing one.
