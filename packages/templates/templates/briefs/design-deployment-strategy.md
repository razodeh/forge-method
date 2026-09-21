Decide how each deployable unit is rolled out and, more importantly, how it is rolled back
automatically. The steps after you deploy, run smoke tests and rehearse the rollback against your
design, and `G-Deliver` fails if the rollback was never exercised.

### Inputs

This step declares no inputs. Read the KB: the pipeline ADR written just before this step, the
architecture spec's deployable units and their statefulness, the environment strategy in
`delivery/`, the stage's NFRs (availability, latency, recovery time) and any migrations planned for
this stage.

### Produce

An `ADR` in category `delivery`, framework `deployment-strategy`, with the headings the ADR schema
requires, `## Context`, `## Options considered`, `## Decision`, `## Diagram`, `## Consequences` and
`## Reversal plan`, plus `## Score table` and `## Killer risk` from the framework. Artifact
validation fails an ADR missing a required heading. Per deployable unit, choose among recreate,
rolling, blue/green, canary and progressive or feature-flagged, and score the options on rollback
speed, infrastructure cost, risk appropriateness and operational complexity. The ADR must state, for
each unit:

- Rollout: the mechanism, its prerequisites (health checks, readiness probes, spare capacity,
  traffic splitting, a flag system) and whether each prerequisite exists today.
- Automated rollback trigger: the metric (error rate, p99 latency, saturation or a business metric),
  the threshold and the time window. "We would notice and roll back" is not a trigger.
- Rollback path: exactly what is executed to roll back, how long it takes, and what it cannot undo.
- Health checks: liveness (is this instance broken) and readiness (should it receive traffic) are
  separate, and the ADR says what each checks.
- Schema and code changes: they deploy separately under expand and contract. A migration that cannot
  be rolled back is not acceptable; the ADR names any migration in this stage and how it stays
  compatible with the previous code version.
- Deployment record: what is recorded for each deployment (artifact, SHA, config version, trigger,
  duration, outcome).
- Verification: the smoke test suite the later `forge test run --rule smoke` step will run, and what
  the rollback rehearsal (`forge deploy --rollback-check`, then the staging rehearsal `G-Deliver`
  requires) must show for this strategy's trigger and path to count as executed rather than assumed.

Diagram: draw the deployment topology in the project's notation as a `Diagram`, one per environment,
at `docs/forge/kb/delivery/views/deployment-<env>.mmd` (each with its `deployment-<env>.mmd.yaml`
sidecar and a caption), the location `08` §8.11.3 fixes and `G-Deliver` looks in. Reference it from
the ADR's `diagrams` and its `## Diagram` section. `G-Deliver` fails on a missing or stale topology
diagram.

### Acceptance

- Every deployable unit in the architecture spec is covered or explicitly out of scope with a
  reason.
- Every strategy has a numeric rollback trigger and a rehearsable rollback path.
- The strategy's prerequisites are either present or listed as follow-on work with an owner.
- Reversibility, blast radius and revisit trigger are filled in.

### Do not

- Do not pick blue/green or canary because it sounds safer; choose what the unit's traffic, cost and
  risk justify, and score it.
- Do not treat "rollback is possible in theory" as evidence. Design it so it can be rehearsed.
- Do not deploy anything. The deploy is the next step.
