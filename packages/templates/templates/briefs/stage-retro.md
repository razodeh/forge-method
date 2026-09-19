# Run the stage retrospective

The stage has just completed. Write the retrospective that feeds the next stage: what the data shows
happened, what to change, and who owns each change. This retro is mandatory because it is the only
mechanism by which the process improves itself.

## Inputs

This step declares no inputs, so gather evidence from what your context pack and read access give
you. Raw event logs are not packed and your command access is limited to reading and `git log`, so
work from the recorded summaries and reports rather than replaying the log: the stage plan and its
exit criteria, the cost ledger and whatever event summaries reach you, gate reports under
`docs/forge/reports/gates/`, review reports, `RCA` and `Defect` records, the flaky-test report, and
merge and revert history for the stage. Prefer recorded data over recollection.

## Method

Reconstruct the timeline from the records you have, then examine the numbers that describe how the
stage went:

- delivery: stories planned versus done, cycle time, blocked lanes and what blocked them;
- cost: spend per story against the stage budget, and the stories that overran;
- quality: gate failures and which check failed, rework ratio (stories that went back to
  implementation), review findings by perspective, and flaky or quarantined tests;
- test-change requests raised by implementers. A high rate points at poorly specified acceptance
  criteria, so name the stories where it happened;
- defects and `RCA` records opened during the stage, and their prevention actions.

Every figure you cite must come from a record you read. If a figure is not in your context, say it
is unavailable; do not estimate it.

## Produce

A `SessionRecord` with `sessionType: retro` (this is what the workflow calls the retrospective
subtype; it is not a separate front-matter field), with the `##` sections the record requires:
Frame, Diverge, Converge, Decisions, Non-decisions, Actions and KB write-back.

- Decisions and actions each have an owner role and a concrete change: a workflow tweak, a standards
  update, an overlay change, a new check, a story to add. An observation with no owner is not an
  action; either assign it or list it under non-decisions with the reason.
- Record the risks you saw that were never owned, as proposed `Risk` entries.
- KB write-back lists what should change in `engineering/ways-of-working.md` and any other KB page,
  and states these as proposals where you do not own the page.

## Acceptance

- The record is grounded: each conclusion cites the event, report or record that supports it.
- It includes what went well, so it is not only a list of faults.
- Every action names an owner and can be checked later as done or not done.

## Do not

- Do not soften a gate failure or an overrun because the stage ultimately passed.
- Do not assign blame to an agent or a person; describe the process condition that made the failure
  likely.
- Do not re-open decisions the stage already made and recorded as ADRs; if one should be revisited,
  say which ADR's revisit trigger has fired.
