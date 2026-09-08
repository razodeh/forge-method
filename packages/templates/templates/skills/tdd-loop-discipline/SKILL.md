---
id: tdd-loop-discipline
name: TDD loop discipline
version: 1.0.0
description: >
  How to actually run red-green-refactor in FORGE's own story loop, instead of writing the
  implementation first and a confirming test after.
when_to_use: >
  Every step of `implement-story`'s own red/green/refactor sequence (10 §10.6).
applies_to:
  agents: [backend, frontend, mobile, data-engineer, sdet]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Red must actually fail for the right reason

A "red" step that fails because of a typo or a missing import is not a real red -- run it and read
the failure message before writing any implementation. A test that was never seen failing for the
reason it claims to test is a test no one has verified is testing anything.

## Green is the smallest change that passes

Resist implementing the whole feature during green. The smallest correct change that makes the test
pass is what green means; the rest belongs to the next red.

## Refactor only under green

Never refactor while a test is failing -- that conflates "make it work" and "make it clean" into one
unreviewable diff. Refactor happens only once the suite is green, and the suite must still be green
when refactor ends.

## Do not

- Do not write the test after the implementation "to save time" -- that produces a test confirming
  what the code does, not what it should do, which is exactly the weak oracle `test-oracle-design`
  forbids.
- Do not skip red because "the test is obviously going to fail" -- obviousness is not verification.
