---
# forge:generated v=1 hash=8f664c8e81fbcb57d87c77a0fbd075f4d60c1d5622377ce192609a9b74c458a9 — edits will be overwritten; use overrides/
id: property-based-testing
name: Property-based testing
version: 1.0.0
description: >
  How to write a property test that checks an invariant across generated inputs, and how to make a
  failing case actually reproducible.
when_to_use: >
  A domain invariant exists that should hold for every valid input, not just the handful of examples
  that come to mind (test-oracle-design's own "property/invariant" oracle tier).
applies_to:
  agents: [sdet, backend]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## State the property, not an example

"A generated invoice never has a negative balance" is a property. "Invoice #3 has balance 40.00" is
an example. Property tests earn their keep by exploring the input space an example-based test never
would.

## Reproducibility is not optional

`13` §13.1 F-TEST-7's own requirement: a failing property-based test's output must include the seed
that produced the failing input, so the exact failure reproduces deterministically on re-run. A
property test that reports "some input failed" with no way to reproduce it is worse than no test --
it is unactionable noise.

## Shrinking matters

A good property-testing library shrinks a failing input to its minimal form before reporting it. Do
not disable shrinking for speed -- a 200-field failing input is much harder to diagnose than the
3-field minimal case it shrinks to.

## Do not

- Do not use property-based testing as a replacement for the "specified value" oracle when the AC
  already states a concrete expected result -- use the strongest oracle available, per
  `test-oracle-design`.
- Do not write a property so loose it can never fail ("output is not null") -- that provides no
  signal.
