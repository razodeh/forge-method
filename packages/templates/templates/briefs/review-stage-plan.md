Review the stage plan from the delivery side: is the sequencing realistic against the capacity of
the team and agent lanes, and are the dependencies and risks accounted for? You are the second
reader of the plan, and you own sequencing, so a plan that cannot be delivered in the order it
states must not pass through you unnoticed.

### Inputs

- The stage plan (`docs/forge/plans/stages.md`) and the `stage-plan` handoff from
  `decompose-stages`, with its assumptions and open questions.
- The `Capability` artifacts (dependencies, priorities), the `NFR` artifacts, and the architecture
  ADRs.
- The `Risk` entries so far, and the constraints on budget, deadline and team (`constraints/**`).

### What to check

1. **Independence.** Each stage is deployable and demonstrable by itself, with no late integration
   stage.
2. **First slice.** The first stage contains a thin end-to-end slice on top of the scaffold's smoke
   path, or cites the existing end-to-end path for a brownfield project.
3. **Dependencies.** Follow every `depends_on` edge: no capability is scheduled before something it
   needs, including infrastructure, data migrations and third-party access that the plan does not
   list.
4. **Capacity.** Compare each stage's estimated stories, cost and wall-clock with the team size,
   concurrency, budget and deadline in the constraints. Say plainly which stage is over capacity and
   by how much.
5. **NFRs.** Every NFR is enforced in a stage or listed under `deferred_nfrs`; none is dropped
   between stages.
6. **Exit criteria.** Each is observable, and a person could tell whether it was met.
7. **Risk.** Look for risks the plan implies but does not name: a critical path through one
   component, a single external dependency, an unvalidated assumption on which a stage depends.

### What to produce

- A `Risk` entry (in `kb/risks.md`) for each sequencing, capacity or dependency risk you found, with
  likelihood, impact, mitigation and owner.
- One `HandoffRecord` entry (`from: em`, `to: pm`, `step: review-stages → plan-stage`) that records
  the verdict. The first string in `delivered` is `verdict: pass` or `verdict: changes-required`,
  followed by one line per check with its result and evidence. Each required change goes in
  `constraints_for_receiver`, ordered by severity, and unresolved questions go in `open_questions`.
- Your closing message repeats the verdict and the required changes. Nothing after this step reads
  the verdict automatically, so on `changes-required` say so plainly and ask the human to send the
  plan back to `decompose-stages` before stage planning starts.

### Acceptance criteria

- All seven checks have a result and a piece of evidence; "looks fine" is not evidence.
- Each required change names the stage and capability it applies to, what is wrong, and the smallest
  change that would fix it.
- Each risk you record cites the stage or dependency that causes it.
- If the plan needs no change, the verdict says so and lists the checks that support it.

### Do not

- Do not edit the stage plan or move capabilities between stages. You may say that a capability sits
  in the wrong stage for sequencing reasons; the change is the product manager's, who owns stage
  boundaries.
- Do not approve a plan you could not check because inputs were missing. Report what is missing.
- Do not pad the review with style comments.
