<!-- forge:generated v=0.0.0 hash=d2fb78fc6e00ced07c6d3b1f5f4355801cb0611fdb7adc5e4b100e3fab3b71c3 — edits will be overwritten; use overrides/ -->
The step brief defines the loop you run and stops it at diagnosis and prevention. This is how to run
it well, and how to know when a bound says stop.

**Check what you can run before you start.** The reproduction is a hard gate, and it counts only
when a failing run has been observed. If your grant lets you execute it, do so; if it does not, then
it counts only if the Defect's evidence already contains an observed failing run. Otherwise finish
with needs-more-evidence and the exact command and input that would reproduce it, marked unrun.
Falsification without a runner is done by reading code and history; any claim that needs execution
is recorded as unrun rather than answered by reasoning.

**Watch the bounds you can see.** At most five reproduction attempts and three hypothesis rounds,
after which you escalate with the evidence rather than proceeding on a hunch. You cannot read a
clock or a cost ledger, so escalate when the wall-clock or cost signal appears in your context, not
on your own estimate. The fix-attempt bound and the revert rule belong to whichever step applies
fixes, not to this one.

**Make the reproduction do double duty.** Name it with the defect id so it becomes the permanent
regression test, put it where the defect's reproduction artifacts live, note the environment and
data it depends on, and note any sign that it is flaky, which is a finding in itself.

**Keep a hypothesis table**, one row per hypothesis: claim, the observation that would refute it,
the experiment, the result, and the status. Include at least one hypothesis about the environment or
data and one about the specification (defects often trace to an acceptance criterion that was
silent), not only about the code. Each hypothesis in the record carries a status of confirmed or
refuted; one you could not test does not belong in that list, so describe it in the body with the
test it needs.

**Note where observability limited you** (no correlation id, no error code, no way to recover the
failing input). Adding it is a prevention action, and it is the most useful thing a stalled
diagnosis can produce.

**Specify the fix so it cannot be the wrong one.** In the record's fix field state the location and
the intended change, marked as prescribed and not applied, and say which shapes would hide the
defect instead of curing it. Do not propose a change near-identical to one already tried.

**Prevention for serious defects is required.** If you cannot name a prevention action for a Sev1 or
Sev2 defect, the diagnosis is probably incomplete: keep asking why. Route standards or KB changes as
proposals to their owners rather than writing outside your area.

**If you exit to needs-more-evidence,** the record still has required fields, so fill them with
explicit, honest values rather than inventions: a root cause of "undetermined: needs more evidence
(see instrumentation plan)", a fix of "none prescribed: no confirmed cause", a reproduction naming
the unrun command, and only the hypotheses you actually tested. The time-to-diagnose field is a
required number: use the figure your context gives you, and when there is none, write 0 and say in
the body that the duration was not measured and 0 is a placeholder. Put the instrumentation plan in
the body so the next attempt can succeed.
