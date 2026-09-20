### Specialisation for writing the stage test plan

Create or update the test strategy for the project (create it only if none exists) and produce a
test plan for the stage, where the plan hands the SDET a concrete allocation of work rather than an
intention. Work in this order.

1. Inventory the things to be proven: the capabilities and their acceptance summaries, every
   acceptance criterion of the stage's stories (with its kind), the non-functional requirements with
   their numbers, every interface contract, and the constraints that limit the environment. Count
   them; the counts are your coverage check.
2. Rate risk per capability and boundary (impact of a wrong answer, likelihood of change,
   complexity), and use it to decide where depth goes.
3. Set the pyramid. If a strategy exists, take the layer budgets, coverage targets and flake policy
   from it and report any change you would propose as a gap; set them only when creating the
   strategy. Give a table of layers with purpose, allowed dependencies, count and time budgets,
   flake tolerance and the single command for each, using only the commands the scaffold recorded
   and listing a missing one as a gap for the platform role. Check the total against the time the
   pipeline can afford, in agreement with the SRE role.
4. Allocate. For each acceptance criterion, name the layer, the oracle and why it is the strongest
   feasible one, and which weaker ones were rejected. Use the test name the story already carries
   for it (it begins with the criterion's identifier); report a missing or malformed name to the
   story's author instead of renaming it. Assign contract tests to interfaces shared across
   components and property-based tests to criteria that state invariants.
5. Plan environments and data per layer: what is real, faked or containerised, how state is reset,
   how fixtures are built, and how determinism is enforced (injected clocks, seeded randomness).
6. Non-functional verification matrix: each requirement, the verification method, the layer, the
   tool, the pass threshold, when it runs, and which gate consumes it. A requirement without a
   method is a gap to report, not to skip.
7. State the coverage targets and exclusions, the flake policy, and the definition of an unhealthy
   suite, taken from the strategy (or set by you only when creating it).
8. Sequence: which tests come first (the walking skeleton and the riskiest boundaries), and what
   harness or fixture work the SDET must do before the story-level tests.
9. List the gaps: criteria with no feasible oracle, requirements with no method, and environments
   not yet available. For each, name the role that must resolve it.

For the stage's handoff, the acceptance for the receiver is the per-story layer and test-identifier
allocation plus the commands, so the SDET can begin without asking questions. Check before finishing
that every criterion and every non-functional requirement in your inventory appears in the
allocation or in the gap list, and that every layer has a command and a budget.

Common mistakes: an end-to-end-heavy plan because it is easy to describe; the same weak oracle used
for every criterion; budgets with no numbers; requirements mapped to "performance testing" with no
threshold; a plan that cannot be executed with the environments that exist.
