---
# forge:generated v=0.0.0 hash=1a6d900cefd0a2ae8871d2976a5b3ae4f38af0a17ba6a0d975383b13c667d938 — edits will be overwritten; use overrides/
id: test-oracle-design
name: Test oracle design
version: 1.0.0
description: >
  How to pick the strongest available test oracle for an assertion, and why "the code did what the
  code does" is never an acceptable answer.
when_to_use: >
  Writing any test assertion, and especially when reviewing one for oracle strength (13 §13.1
  F-TEST-2).
applies_to:
  agents: [sdet, test-architect, reviewer]
activation: auto
budget_tokens: 1200
forge_version: '>=1.0 <2'
---

## The strength ladder, strongest first

1. **Specified value** -- the AC states a concrete expected result, computed by hand. Always prefer
   this when available.
2. **Inverse/round-trip** -- `parse(serialize(x)) === x`. Encoders, serialisers, migrations.
3. **Metamorphic relation** -- a property that must hold across a transformation (adding a line item
   never decreases the total).
4. **Property/invariant** -- generated inputs never violate a domain invariant.
5. **Differential** -- new implementation matches the old one on the same inputs. Refactors,
   migrations.
6. **Reference implementation** -- compare against a trusted library. Crypto, date maths, currency.
7. **Golden file** -- rendered output matches a reviewed snapshot. Only a real oracle if a human or
   spec actually reviewed the snapshot as correct.
8. **Smoke** -- returns 200, doesn't throw. Last resort, never sufficient for an AC on its own.

Use the strongest oracle actually available, and record why weaker ones were rejected.

## Banned patterns (fail `test:oracle-lint`)

Asserting on a value read from the same code path that produced it; `toBeDefined()`/`toBeTruthy()`
as the only assertion; an unreviewed snapshot; assertions derived from the implementation's own
constants rather than the AC's; `try { } catch { /* pass */ }`; unconditional `expect(true)`.

## Do not

- Do not accept a golden file with no header recording who approved it and against which AC.
- Do not regenerate a golden file with a silent `-u` run in CI -- it is a reviewable diff.
