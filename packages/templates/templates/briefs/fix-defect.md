Fix the defect or defects assigned to this step with the smallest change that removes the cause. A
reproduction (a failing test or command) and, where one exists, an `RCA` record come before you.
They are your specification; the reproduction's job is to go from failing to passing.

### Inputs

- The `Defect` records in scope (under `docs/forge/reports/defects/`; if this step names none and
  several exist, ask with `FORGE_ASK:` which one). On a hardening pass this is every finding, and
  you work through them one at a time in severity order. On a single-defect run it is the one defect
  you were dispatched for.
- The `RCA` record if one exists: read its root cause, causal chain and recommended fix before
  reading the code. Otherwise use the reproduction recorded on the Defect or the failing regression
  test.
- The project standards and the code the Defect names, in your context.

A reproduction is any of: a failing test, a command or script, or, for a hardening finding, the
command, request or code location recorded in the Defect's `evidence`. If a defect has none of
these, or its recorded reproduction ends in NEEDS-MORE-EVIDENCE (it was run and did not reproduce),
stop on that defect and say so. Do not guess from the description. A reproduction recorded as
"written, not run" is usable: work from it. Your constraints list the exact test commands you may
run (the project's own): run one exactly as written, because a command with anything added or
changed is refused, and a layer they report as having no runnable command cannot be run from here.
If your grant does not let you run commands, you cannot confirm it fails or that it now passes: give
the command and the expected output, mark it not run, and never write an unrun result as observed.

### Produce

A change per defect, confined to the code the diagnosis names, that fixes its cause.

- Read the diagnosis, then confirm the reproduction fails now. Only then change code.
- Keep the diff minimal and limited to the cause. Where a hardening finding is a missing check or
  control, add exactly that.
- Keep the reproduction as the permanent regression test, named with the defect id, and do not edit
  it. If it is wrong, say so with a specific justification through `FORGE_REQUEST_CHANGE:`. Where
  the reproduction is a command or a hardening finding's evidence rather than a test, add a
  regression test named with the defect id that fails without your change.
- For a defect that was a race or ordering bug, the proof must include a test that fails reliably
  against the old code.
- Carry out the prevention actions the RCA named that are part of the code change, such as a type
  constraint or a lint rule. List the rest for follow-up.

### Acceptance

- The reproduction (or the regression test you added) passes, and the affected test layer still
  passes.
- The fix addresses the recorded root cause, not just the reported symptom.
- Each defect's fix is traceable: which change fixes which defect, and the command that proves it.
- List every Sev1 or Sev2 defect you fixed that still has no `RCA` with a non-empty `prevention`.
  `G-Stable` fails on an open severe defect and on a closed one without such an RCA, so an RCA must
  be requested (`FORGE_HANDOFF: diagnostician`) or a human must resolve it before the gate. Do not
  set a Defect's status yourself; whoever verifies the fix closes it, and nothing in this workflow
  does so automatically.
- State the exact commands that should prove the fix, and mark each defect ready for verification,
  not closed.

### Do not

- Do not mask the symptom. These are refused in review: widening a `catch`, adding a retry to hide a
  race, loosening or deleting an assertion, adding a sleep, or adding a null check that hides an
  invalid state that arises upstream.
- Do not touch unrelated code, and do not refactor while fixing.
- Do not resubmit a fix you already tried. If a fix attempt fails, read why, change the hypothesis,
  and after three failed attempts stop and report what you learned, leaving no partial fix behind.
- Do not downgrade a defect's severity or close it to make a gate pass.
