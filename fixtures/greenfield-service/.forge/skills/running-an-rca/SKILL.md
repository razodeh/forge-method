---
# forge:generated v=0.0.0 hash=5fe06582444f385f7d2cd0352c78f87e45d2e0f34d0056927da08667d2826e1a — edits will be overwritten; use overrides/
id: running-an-rca
name: Running an RCA
version: 1.0.0
description: >
  How to run the ten-state RCA loop (INTAKE -> REPRODUCE -> ISOLATE -> HYPOTHESISE -> FALSIFY ->
  DIAGNOSE -> FIX -> PROVE -> PREVENT -> RECORD) without thrashing.
when_to_use: >
  Any defect investigation, whether run through `forge debug` or manually by a diagnostician.
applies_to:
  agents: [diagnostician]
activation: auto
budget_tokens: 1400
forge_version: '>=1.0 <2'
---

## The one rule that prevents thrashing

No fix may be attempted before a deterministic, minimal reproduction exists (`13` §13.2's own hard
gate). Skipping straight to a fix attempt because the cause "seems obvious" is exactly how an agent
burns its fix-attempt budget changing things until the symptom disappears, without ever knowing why.

## Three hypotheses, not one

State at least three falsifiable candidate causes before testing any of them. A single hypothesis
becomes a conclusion the moment evidence starts arriving, and the agent starts fitting evidence to
it instead of testing it honestly.

## Five-whys stop rule

Keep asking why until the answer is a decision, a missing check, or a wrong assumption -- not "the
code was wrong." For a Sev1/Sev2 defect, bottoming out at "a typo" is an incomplete diagnosis: the
real question is why nothing caught it.

## Fix the root cause, never the symptom

Forbidden by construction: broadening a `catch`, adding a retry to mask a race, loosening an
assertion, adding a sleep, adding a null-check that hides invalid state upstream. Each of these is
checked for in the fix diff.

## Prove it against the old code, not just the new one

For a race condition specifically, the proof is incomplete until the regression test is shown
failing against the pre-fix code (revert in a scratch worktree, confirm red) -- a test that merely
passes against the new code proves nothing about whether it would have caught the original bug.

## Do not

- Do not close a Sev1/Sev2 defect without a real prevention action -- a lint rule, a type
  constraint, a contract test, a monitor, or a standards update.
- Do not repeat a near-identical fix diff after it failed once -- that is the loop's own anti-thrash
  signal that the hypothesis space is exhausted; go back to ISOLATE.
