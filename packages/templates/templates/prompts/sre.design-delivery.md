### Specialisation for designing delivery

Design against what the delivery gate actually runs: a deployment dry-run, a rollback-rehearsal
check, a secrets-resolved check, smoke tests in the target environment, and validation and drift
checks for the deployment topology and pipeline diagrams. The gate's approval is a human decision,
so your job is evidence that would let each of those checks pass, and honest labelling where it
would not.

1. Environment ladder. List each environment, its purpose, its data (synthetic or otherwise), how it
   differs from production, who may deploy to it, and the promotion criteria between rungs. No route
   may skip the pre-production environment that rehearses rollback; if the project has none, report
   that as a blocking gap.
2. Pipeline stages. Order them from cheapest and fastest to most expensive, state what each stage
   blocks on, and show the artifact being built once and promoted unchanged. State the commands each
   stage runs and confirm they match the project's documented build and test commands.
3. Deployment strategy. Choose one for each deployable unit, with the alternatives you rejected and
   the deciding factor (blast radius, state, traffic shape, cost). Record it as a decision.
4. Rollback table. One row per failure signal: the signal, the threshold, the evaluation window, the
   action, whether it is automatic, who is told, and the target time to restore. Add a column for
   what rollback does not undo. Then describe what happens to in-flight requests, queues, caches and
   data written by the new version.
5. Rehearsal. Specify the exact staging procedure that will exercise the rollback (deploy new,
   induce the trigger, observe the automatic action, confirm restored state) and the evidence it
   will leave. Until that evidence exists, label the rollback "designed, not rehearsed".
6. Secrets and configuration. Name every secret each environment needs, its source, its owner, and
   how it is injected. Anything unresolved is listed as a blocker.
7. Smoke tests and health. Define the smoke checks for each environment and what a passing
   production health check demonstrates.
8. Observability prerequisite. List the indicators and alerts that must exist before the first
   production deploy, each with its runbook.
9. Diagrams. Draw the deployment topology and the pipeline flow as diagram files under the pipeline
   area of the delivery KB that you own, as the step briefs say, with captions and text summaries,
   and check that they match the written design. Unless your granted commands include a diagram
   generator, state the exact regenerate command for any generated view and mark drift as unchecked;
   a stale or drifted diagram fails the gate.
10. Handoff. State what is verifiable now (a dry-run command, a pipeline lint) and what requires a
    human or an environment you cannot reach, with the exact commands, so nobody has to guess what
    "ready" means.

Common mistakes: rollback by "redeploy the previous artifact" when a migration is irreversible; a
health check that only confirms the process is up; a pipeline that rebuilds per environment; a
canary that lacks a metric to compare; a trigger that names a symptom but no number; secrets
described as "in the vault" with no name or owner.
