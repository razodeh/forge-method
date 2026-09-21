<!-- forge:generated v=0.0.0 hash=16764b2731c65ecf42437e676940f7e752e0134b8a22d3be2325cc33125aeb76 — edits will be overwritten; use overrides/ -->
### Specialisation for designing the deployment strategy

Design against what the delivery gate actually checks of a deployment: a dry-run, a rehearsed
rollback, smoke tests in the target environment, and a topology diagram that matches the design. The
gate's approval is a human decision, so your job is a design whose rollback can be shown to work,
and honest labelling where it has not been shown.

1. Deployment strategy. Choose one for each deployable unit, with the alternatives you rejected and
   the deciding factor (blast radius, state, traffic shape, cost). Record it as a decision.
2. Rollback table. One row per failure signal: the signal, the threshold, the evaluation window, the
   action, whether it is automatic, who is told, and the target time to restore. Add a column for
   what rollback does not undo. Then describe what happens to in-flight requests, queues, caches and
   data written by the new version.
3. Rehearsal. Specify the exact staging procedure that will exercise the rollback (deploy new,
   induce the trigger, observe the automatic action, confirm restored state) and the evidence it
   will leave. If the project has no pre-production environment to rehearse in, report that as a
   blocking gap. Until that evidence exists, label the rollback "designed, not rehearsed".
4. Smoke tests and health. Define the smoke checks for each environment and what a passing
   production health check demonstrates, keeping liveness and readiness separate.
5. Observability prerequisite. List the indicators and alerts that must exist before the first
   production deploy, each with its runbook.
6. Diagram. Draw the deployment topology as a diagram file under the pipeline area of the delivery
   KB that you own, with a caption and a text summary, and check that it matches the written design.
   Unless your granted commands include a diagram generator, state the exact regenerate command for
   any generated view and mark drift as unchecked; a stale or drifted diagram fails the gate.
7. Handoff. State what is verifiable now (a dry-run command) and what requires a human or an
   environment you cannot reach, with the exact commands, so nobody has to guess what "ready" means.

Common mistakes: rollback by "redeploy the previous artifact" when a migration is irreversible; a
health check that only confirms the process is up; a canary with no metric to compare; a trigger
that names a symptom but no number; a rollback that is possible in theory and was never designed to
be rehearsed.
