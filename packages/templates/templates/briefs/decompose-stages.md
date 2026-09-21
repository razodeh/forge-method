Decompose the product into stages: an ordered set of increments, each independently deployable and
demonstrable, that together deliver the Capabilities. Each later planning step works inside one
stage, so the boundaries you draw here are the ones the whole delivery follows.

### Inputs

- All `Capability` artifacts: `priority`, `stage`, `depends_on`, `nfrs`, `metrics`,
  `acceptance_summary`.
- The `NFR` artifacts, the Vision (horizon and success metrics), the `Risk` entries, and the
  architecture ADRs for what must exist before what.
- The KB constraints (`constraints/**`): budget, deadline, team size and lane concurrency, which
  bound the estimates.
- On a re-run, the `HandoffRecord` from `review-stages` (`step: review-stages → plan-stage`):
  address each required change in it.

### What to produce

- The stage plan at `docs/forge/plans/stages.md`: a YAML document with a top-level `stages:` list.
  Each stage has `id`, `name`, `goal` (one observable sentence), `capabilities` (ids), `excluded`
  (capability ids deliberately left to another stage), `exit_criteria`, `nfr_subset` (the NFR ids
  enforced in this stage), `risks` (ids), and an `estimated` block with `stories`, `cost_usd` and
  `wall_clock`, each a rough estimate. Stages after the first carry `depends_on`. Add a
  `deferred_nfrs` list to a stage for each NFR it postpones, with the stage it moves to and the
  reason.
- A Mermaid view of the stages and their dependencies at `docs/forge/plans/views/stages.mmd` (a
  `gantt` or `flowchart`), with caption and alt text.
- One `HandoffRecord` entry (subtype `stage-plan`; `from: pm`, `to: em`,
  `step: decompose-stages → review-stages`) that registers the plan. The entry has no `subtype` key,
  so the first string in `delivered` is `subtype: stage-plan` (`step` names the next node and does
  not carry the subtype) and the second is the stage plan path. Put your open questions in
  `open_questions`, and the sizing assumptions in `assumptions`.
- Update each non-`wont` capability's `stage` field to the id of the stage that includes it, bump
  its `revision` and add a `changelog` entry. Leave `wont` capabilities as they are
  (`stage: deferred`).

### Rules

- Every stage is independently deployable and demonstrable. No stage exists only to integrate the
  earlier ones.
- The scaffold built in project initialization already contains a trivial smoke path. The first
  stage must add the first real thin vertical slice through every architectural layer on top of it
  (the walking skeleton of the method), proving the architecture, the pipeline and the test harness
  before volume work begins. Name the capability it rides on in that stage's `goal`. For a
  brownfield project, cite the evidence of an existing end-to-end path instead.
- A stage never includes a capability whose `depends_on` is placed in a later stage.
- An NFR is deferred to a later stage explicitly, in `deferred_nfrs`, and never by omission. An
  NFR's scope is the set of capabilities whose `nfrs` list names it. A `must` NFR is one cited by a
  `must` capability. An NFR that no capability lists is system-wide and goes in the first stage's
  `nfr_subset` unless it is deferred.
- Each stage has its own exit criteria that a person could check, and its own cost estimate.

### Acceptance criteria

- Every capability that is not `wont` appears in exactly one stage's `capabilities`. `wont`
  capabilities appear in no stage.
- Stage order is consistent with `depends_on` (no cycles, no forward references).
- Every `must` NFR is in the `nfr_subset` of the stage where its capability first ships, or is
  listed in `deferred_nfrs` with a reason.
- Every stage `goal` and `exit_criteria` entry names something observable.

### Do not

- Do not create epics or stories; the next planning phase does that per stage.
- Do not present estimates as commitments. If the inputs give no basis for a figure, mark it a rough
  estimate and record the assumption.
- Do not reorder to make the plan look balanced. If a dependency forces a heavy first stage, say so.
