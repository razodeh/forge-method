# Verify the stage's non-functional requirements

Establish, from evidence, whether each non-functional requirement that applies to this stage is met.
The test and coverage steps before you check what the acceptance criteria say; you check what the
NFRs say, which those often do not. Then `G-Verify` and the traceability check follow.

## Inputs

This step declares no inputs, so find them: the stage plan's `nfr_subset` (the NFRs enforced at this
stage), each `NFR` artifact with its `category`, `metric`, `target` and `verification` reference,
the acceptance criteria of kind `nfr`, and the reports the earlier steps left under
`docs/forge/reports/` (test results, coverage, benchmark output).

## Method

For every NFR in the stage's subset, decide one of four outcomes and support it:

- verified: the verification named in the NFR's `verification` (a test, benchmark or monitor, or a
  review or audit where that is the declared kind) exists and was carried out, and its recorded
  result meets the target under the stated conditions;
- failed: it ran and the result misses the target;
- unverified: no verification exists, it did not run, or its conditions do not match the NFR
  (different load, data size or environment);
- deferred: the stage plan explicitly defers it to a later stage, and you cite that plan entry.

Read the result from a report. Never take a target as met because the code "looks fast enough".
Where a benchmark ran, check its method: the load, the data volume, warm-up, the percentile reported
and the environment. A p50 does not verify a p95 target.

## Produce

A `HandoffRecord` (the nfr-verification handoff) with `step` naming this step, and `to` set to the
role that decides what to do with failures, which is the human approving `G-Verify`. Use the fields:

- `delivered`: one entry per NFR: its id, target, outcome, and the report path and measured value
  that support the outcome.
- `open_questions`: every NFR that could not be verified in this environment and what would be
  needed to verify it, and every NFR whose target is not numeric and so cannot be verified as
  written.
- `acceptance_for_receiver`: the exact commands that reproduce each measurement.
- `constraints_for_receiver` and `assumptions`: measurement conditions others must keep or check.

## Acceptance

- Every NFR in the stage subset appears exactly once, with an outcome and its evidence.
- No outcome is "verified" without evidence from a real report: a measured value for a test,
  benchmark or monitor, or the review or audit report for those kinds. Every value or finding cites
  the report it came from.
- Every failed or unverified NFR is visible in `open_questions` or in `delivered` with that outcome,
  never left out.

## Do not

- Do not change an NFR, its target or its verification reference so that it passes.
- Do not run or invent a benchmark that is easier than the one the NFR describes.
- Do not fix the failures you find. Report them.
