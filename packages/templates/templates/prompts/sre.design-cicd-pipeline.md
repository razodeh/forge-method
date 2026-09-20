### Specialisation for designing the delivery pipeline

Design against what the delivery gate actually runs: a deployment dry-run, a rollback-rehearsal
check, a secrets-resolved check, smoke tests in the target environment, and validation and drift
checks for the deployment topology and pipeline diagrams. The gate's approval is a human decision,
so your job is evidence that would let each of those checks pass, and honest labelling where it
would not. This step decides the pipeline that carries a change to production; the rollout and
rollback design comes in the step after you and works against what you specify here.

1. Environment ladder. Take the environments from the environment strategy in the KB; where none
   exists, state in the decision record the ladder you are designing against: each environment's
   purpose, its data (synthetic or otherwise), how it differs from production, who may deploy to it,
   and the promotion criteria between rungs. No route to production may skip the pre-production
   environment that rehearses rollback; if the project has none, report that as a blocking gap.
2. Pipeline stages. Order them from cheapest and fastest to most expensive, state what each stage
   blocks on, and show the artifact being built once and promoted unchanged up that ladder. State
   the commands each stage runs and confirm they match the project's documented build and test
   commands.
3. Secrets and configuration. Name every secret each environment needs, its source, its owner, and
   how it is injected. Anything unresolved is listed as a blocker.
4. Diagram. Draw the pipeline flow as a diagram file under the pipeline area of the delivery KB that
   you own, with a caption and a text summary, and check that it matches the written design. Unless
   your granted commands include a diagram generator, state the exact regenerate command for any
   generated view and mark drift as unchecked; a stale or drifted diagram fails the gate.
5. Evidence. In the decision record, state what is verifiable now (a pipeline lint, a dry-run
   command) and what requires a human or an environment you cannot reach, with the exact commands,
   so nobody has to guess what "ready" means.

Common mistakes: a pipeline that rebuilds the artifact per environment; a stage with no owner of its
failure and no stated effect on the gate; a promotion rule with no measurable criterion; secrets
described as "in the vault" with no name or owner; a route to production that bypasses the rung that
rehearses rollback.
