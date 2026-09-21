<!-- forge:generated v=0.0.0 hash=815322eb8e5c5674ec6b1345956b9ddc9de5e13946b653ddb855679d37466989 — edits will be overwritten; use overrides/ -->
Write the test plan for this stage (`stageId`; if your context does not state it, ask the human, and
never infer it): for every acceptance criterion of every story, the test that will prove it, at what
layer, with what oracle, and run by what command. The plan feeds the run-plan derivation that
follows and the stage-plan review, and the test author will implement from it.

### Inputs

- The `Story` artifacts of this stage: `acceptance` criteria, the test names in `tests`,
  `files_expected`, and `dod_profile`.
- The `Epic` artifacts, the `NFR` artifacts in the stage's `nfr_subset`, and any `InterfaceContract`
  artifacts.
- The project test strategy (`engineering/testing.md`) if it exists, the architecture and stack ADRs
  (for the real dependencies the tests need), the UX spec, and the commands the scaffold recorded in
  `delivery/build.md`.

### What to produce

- The stage test plan in `docs/forge/specs/test-plan.md`, as one section headed with the stage id
  (for example `## Stage mvp`); keep the sections of earlier stages unchanged. Register it with one
  `HandoffRecord` entry (subtype `test-plan`; `from: test-architect`, `to: sdet`,
  `step: write-test-plan → derive-run-plan`). The entry has no `subtype` key, so the first string in
  `delivered` is `subtype: test-plan`, and the second names the plan. In the record,
  `constraints_for_receiver` lists environment and data requirements, and `acceptance_for_receiver`
  lists the checks the test author must meet, including the non-AC tests below as required
  additional tests.
- If the project has no test strategy yet, create the strategy document (`engineering/testing.md`, a
  KB entry): the pyramid shape and a budget for each layer, and which command runs each layer. Use
  the commands the scaffold provides (`test:unit`, `test:integration`, `test:contract`, `test:e2e`,
  `test:nfr`, `test:preflight`). If a layer the plan needs has no command, list it as a gap for the
  platform role instead of inventing one.

### Plan contents

A table with at least one row per acceptance criterion: AC id, story id, test id (no `TEST-###` ids
exist: the test name in the story's `tests`, which starts with the AC id, is the id), test file
path, layer, oracle, dependencies (real database, fake, contract), test data approach, and the
command that runs it. Then:

- **Oracles.** Choose the strongest oracle available for each criterion (specified value first, then
  inverse, metamorphic, property, differential, reference, golden file), and give the reason a
  weaker one was chosen. Smoke checks are never enough for a criterion.
- **Non-AC tests.** Contract, end-to-end and NFR tests that belong to no single criterion get their
  own rows below the table, named for what they prove (for example `CONTRACT INT-004 consumer`) and
  never starting with an AC id. Each `INT-###` consumer and provider pair has a contract test. Each
  capability has one end-to-end happy-path test and one for its top failure path. Each `must` NFR in
  the stage (one cited by a `must` capability) has an NFR test. These are not added to any story's
  `tests`. Assign each one to a named story that will carry it (the provider's story for a contract
  test, the last story of the capability for end-to-end tests, the story that verifies the NFR for
  an NFR test) and say so in the row. Contract tests for an interface that does not exist yet are
  marked "after contract freeze" and listed in `acceptance_for_receiver` as an addendum for the test
  author.
- **NFR links.** For each NFR test, state the NFR's id and the concrete test name, and request that
  the NFR's `verification.ref` be updated to it (you may not edit NFRs yourself), so the
  verification step can find it.
- **Layers.** Integration tests use real dependencies, not mocks of them; mocks only for third-party
  systems the project does not own, and those get a contract test.
- **Pyramid.** Show the count per layer and confirm it is inside the strategy's budget.
- **Isolation.** No test depends on another's side effects; each creates the data it needs.

### Acceptance criteria

- Every AC of every story in the stage has at least one row in the AC table, and every row's test
  name begins with that AC id and only that id. The binding is checked against each story's `tests`,
  so report a story whose names fail it.
- Every layer named has a command that exists, and `test:preflight` covers each layer used.
- Every stage NFR with a numeric target has a test or monitor that can fail at that number.
- Nothing in the plan requires an environment the scaffold and pipeline do not provide. Raise any
  gap with the platform role; if it must stop stories from becoming ready, record it as an
  `OpenQuestion`, knowing that any open one blocks readiness for every story until resolved.

### Do not

- Do not edit stories. If an AC has no test name or a malformed one, request the change from the
  story author.
- Do not write test code. The plan says what will be tested and how; the test author implements it.
- Do not plan tests that assert what the code does instead of what the criterion states.
- Do not use line coverage as the adequacy measure. Criterion coverage is the binding measure.
