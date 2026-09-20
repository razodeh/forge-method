A refactor changes structure and nothing else. Before anyone touches code, write down what "nothing
else" means for this goal, so the refactoring step can be held to it and the test run afterward can
prove it.

### Inputs

The run's `goal` input, which this step does not declare as an input, so if it is not in your
context ask for it with `FORGE_ASK:` rather than inferring one. Also the code and tests it concerns,
the architecture spec and ADRs that constrain the area, and the frozen `InterfaceContract`s the area
exposes or consumes. Read the code in scope before writing anything.

### Produce

A `HandoffRecord` (the refactor-invariants handoff) to the engineer who will do the refactor, with
`step: state-invariants`, the id of this workflow step, which is how the next step finds it. Carry
the content in its fields:

- `delivered`: the goal in one testable sentence (what will be different in the structure afterward
  and how someone can tell), the scope as an explicit list of the files and modules that may change,
  and a list of what is out of scope even though it is nearby.
- `constraints_for_receiver`: the invariants, each stated so it can be checked. Cover, where they
  apply, the public signatures and contracts that must not change; observable behaviour, including
  error cases and side effects; data formats and persisted state; and performance bounds the code is
  known to meet. Add any architectural rule the result must keep, citing the ADR.
- `acceptance_for_receiver`: the exact commands that prove the invariants, and what each result must
  be. Prefer the existing suite. Where behaviour is critical, name a differential check that runs
  the old and new code on the same inputs.
- `open_questions` and `assumptions`: anything about intent you could not establish.

### Acceptance

- Each invariant is testable by a named command or test, or is flagged as unguarded.
- Unguarded behaviour inside the scope is listed. If a critical path has no test that would catch a
  behaviour change, say that the receiver must add characterisation tests before changing that path,
  and name which paths.
- The scope is small enough to review as one change. If the goal needs more, split it and say how.
- The goal contains no behaviour change. If it does, say so and stop: that is a feature or a fix,
  not a refactor.

### Do not

- Do not propose the refactor's design or edit code. You state the boundaries, not the route.
- Do not list invariants that no command or test could ever check.
- Do not widen the scope to make the goal easier.
