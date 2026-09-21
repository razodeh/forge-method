<!-- forge:generated v=0.0.0 hash=4658039d766cd7c3d066c1b55d364cf60b7097cc61ff48dc43761bfa2e698696 — edits will be overwritten; use overrides/ -->
Turn a reported defect into a deterministic, minimal reproduction before anyone tries to fix it.
This is a hard gate: no fix may be attempted until a reproduction exists. The next step writes the
failing test from what you record here, so what you record is its specification.

### Inputs

- The `Defect` you were given: observed behaviour, expected behaviour, first seen, frequency,
  environment, severity, affected stories and evidence (stack traces, logs, trace ids, failing
  tests).
- The code and tests it names, and the acceptance criteria of any story listed in `affected`.

### Method

1. Restate the defect as "expected X, observed Y". If the Defect cannot be stated that way, stop and
   say exactly which fact is missing. Vagueness here becomes thrashing later.
2. Reproduce it in the cheapest reliable form, trying in this order: an existing failing test, a
   scratch check derived from the acceptance criterion (the permanent test is the next step's job),
   a replay from the logs or trace, a property-based search for the failing input, a bisect over
   inputs.
3. Reduce it to the smallest input, state and sequence that still shows the failure, and find the
   lowest layer (unit, integration, end to end) at which it fails. Remove everything that is not
   needed.
4. Run it more than once. A result that changes between runs is not a reproduction; record the rate.
5. Try at most five times. If you ran it and cannot reproduce it, stop. That outcome is
   NEEDS-MORE-EVIDENCE, and it is different from a reproduction you were not able to run (see
   below).

### Produce

Record the reproduction in the `Defect` itself, in a "Reproduction" section of its body, and list
any supporting file in its `evidence`. Record:

- the exact command or steps, and any seed, fixture, clock or configuration they need;
- the observed and expected result of that command, verbatim;
- the lowest layer at which it fails and the narrowest scope you found;
- whether it fails every time, and the environment it was run in.

If a command alone cannot express the reproduction, add a small script and list its path in
`evidence`; put it under `docs/forge/reports/defects/` beside the Defect records, named after the
defect id. Do not put a reproduction only in your final message; the next session cannot see it.

### Acceptance

- Someone who has only the Defect and the recorded command sees the recorded failure.
- The reproduction fails because of the reported defect, not because of setup you introduced.
- If you could not reproduce it, the Reproduction section says NEEDS-MORE-EVIDENCE (leave the
  Defect's `status` field as it is), lists what you tried and what each attempt showed, and names
  the logging, tracing or data that would make it reproducible.

### Do not

- Do not fix the defect, and do not change production code or existing tests to make it easier to
  reproduce.
- Do not report a reproduction you did not run as observed. If your grant does not let you run
  commands, still write the reproduction (the exact command or script and the output you expect),
  record it in the Reproduction section as "written, not run", and say so in your summary. That is
  not NEEDS-MORE-EVIDENCE: the next steps proceed on it, and the run's verification commands are
  what confirm it.
- Do not widen the defect. Note related problems you see, without expanding this one.
