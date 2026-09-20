Take one defect from a reported symptom to a proven root cause and a recorded diagnosis. The fix is
the next step's job, made by a different agent. Yours is the part that decides whether that agent
fixes the right thing: the RCA loop, in strict order, from intake through diagnosis and the
prevention analysis.

### Inputs

- The `Defect`: observed and expected behaviour, first seen, frequency, environment, severity,
  affected stories and evidence.
- The KB's `constraints/**`, and `engineering/debugging/**` where it exists. Read the tests and code
  the Defect names.

### The loop

Do each phase in order and record its result as you go. Do not start a phase because the previous
one seems obvious.

1. Intake: state the defect as "expected X, observed Y". If you cannot, list the missing facts and
   stop.
2. Reproduce: produce a deterministic, minimal reproduction as an executable artifact, preferably a
   failing test named with the defect id, otherwise a script or command. This is a hard gate;
   without one you may not diagnose. Make at most five attempts. If your grant does not let you run
   commands, write the reproduction anyway (the exact command or test and the output you expect),
   mark it "written, not run", and continue by inspection of the code, logs and traces, marking
   every result you reached that way as by inspection. Never write an unrun result as observed. If
   you ran it and it still does not reproduce, finish with the outcome NEEDS-MORE-EVIDENCE and a
   precise list of the instrumentation that would make it reproducible. That is a valid result, not
   a failure. In that case the `RCA` output cannot honestly be produced, because its root cause is
   required; say so, and record the outcome in the Defect's "Reproduction" section so the next steps
   see it. In every case, also record the reproduction, or its absence, in that section.
3. Isolate: narrow to the smallest scope that still fails, using bisect with the reproduction as the
   test, targeted instrumentation, delta debugging of the input, or layer isolation.
4. Hypothesise: state at least three candidate causes, each a falsifiable claim with the observation
   that would refute it.
5. Falsify: run the cheapest experiment that could disprove each one and record the result. If all
   survive or all die, return to isolate. Allow three hypothesis rounds, then report what you have
   and escalate rather than proceeding on a hunch.
6. Diagnose: state the cause as a causal chain from condition to code path to incorrect state to the
   symptom. Apply the five-whys stop rule: keep asking why until the answer is a decision, a missing
   check or a wrong assumption. A Sev1 or Sev2 defect that ends at "a typo" is not diagnosed; ask
   why nothing caught it.
7. Prevent: state what class of defect this is and what would catch the next one: a lint rule, a
   type-level constraint, a contract test, a monitor, a KB entry or a standards change. A Sev1 or
   Sev2 defect needs at least one. If the defect was hard to diagnose for lack of logs, traces or an
   error code, the prevention action is to add that observability.

### Produce

An `RCA` record carrying the defect id, severity, symptom, reproduction (the command or test path),
timeline, every hypothesis with `refuted_by` and status, root cause, causal chain, prevention, blast
radius, KB writes and time to diagnose. Because the fix is applied after you, state in `fix` the
intended change and its location, marked as prescribed and not yet applied.

### Do not

- Do not change production code. The only files you add are the reproduction and the RCA record.
- Do not stop at the first hypothesis that fits, and do not keep a hypothesis you have not tried to
  refute.
- Do not repeat an experiment that already failed; change something between attempts.
- Do not present a guess as a root cause. If the cause is undetermined, do not write an RCA that
  claims one: end with NEEDS-MORE-EVIDENCE and the evidence gathered.
- Do not pad `prevention` to make the record look complete; `G-Stable` treats an RCA with a
  prevention action as resolving a closed severe defect.
