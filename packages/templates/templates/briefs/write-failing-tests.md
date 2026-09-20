Write the tests that define "done" for one story before any of its implementation exists. You are a
separate session from whoever implements it, and that separation is the point: the implementer will
be forbidden to edit what you write here, so a weak or wrong test you leave behind is not fixed
later, it is built against.

### Inputs

- The `Story`: read every acceptance criterion (id, given/when/then, kind, and `nfr` where present),
  `files_expected`, `interfaces` and the test ids in `tests`.
- The `HandoffRecord` from the preceding planning step: the implementation plan (`step` names the
  plan step) in the single-story loop, or the stage's test plan (a table of acceptance criterion,
  story, test name, layer, oracle, data and command) in a stage run. The input is a bare
  `HandoffRecord` reference. Handoffs are registered in `docs/forge/reports/handoffs.md`; choose the
  record that concerns this story by its `step` and content, and the latest if several do. Stories
  are under `docs/forge/specs/stories/`, and contracts under `docs/forge/specs/interfaces/`. Take
  the allocated test ids, chosen oracles and planned test file paths from it rather than choosing
  your own. If no path is named anywhere, use the test globs in the story's `files_expected` and the
  project's existing test layout, and list the paths you chose.
- The frozen `InterfaceContract`s the story lists. Names, signatures, error codes and shapes in your
  tests come from the contract, never from guesswork.
- On a defect fix (the `quick-fix` workflow) there are no acceptance criteria, and this step is
  given no inputs or paths, so find them: defects are under `docs/forge/reports/defects/`. If more
  than one Defect exists, use the one whose Reproduction section was written last, and ask with
  `FORGE_ASK:` if that is still unclear. If the recorded reproduction ends in NEEDS-MORE-EVIDENCE
  (it was run and did not reproduce), stop and report that; there is nothing to write a red test
  from. A reproduction recorded as "written, not run" is usable. The spec is the `Defect` (observed
  versus expected) and the "Reproduction" section the `reproduce` step recorded on it. Write the
  test that fails today because of that defect, and name it with the defect id. Put it where the
  project's existing test layout puts tests for that code, in the layer the reproduction says the
  defect fails at.

### Produce

Test files at the test paths the plan or the story names (on a defect fix, the location described
above), and nowhere else.

- Name each test with the id of the acceptance criterion it proves, for example
  `AC-014-2 returns 422 for an empty invoice`, and add the framework's machine-readable annotation
  where one exists, so the harness can map results back. One test proves exactly one criterion; a
  criterion may have several tests. Carry the allocated `TEST-###` id as well (in the annotation or
  the test's own description) so the traceability matrix can bind the test to its criterion. Cover
  the failure and edge criteria as thoroughly as the happy path.
- Use the strongest oracle available for each criterion: a specified value worked out by hand from
  the criterion, then round-trip, metamorphic, property or differential checks. A smoke assertion is
  never enough for an acceptance criterion.
- A criterion of kind `nfr` (a percentile under load, say) is tested with the benchmark or load
  harness the plan names, with a fixed seed and stated load, not with a wall-clock assertion. A
  stage test plan may also list contract, end-to-end or NFR rows with no single criterion; write
  those as the plan specifies and bind them to the row's own id.
- Make tests deterministic: seeded randomness, an injected clock, no reliance on wall time or
  network, and one command that runs them.

### Acceptance

- Every criterion has at least one bound test, and no test is unbound. On a defect fix the defect
  has one test, named with its id.
- Each test fails today, and fails for the right reason: the behaviour under test is absent, shown
  by an assertion failure or an explicit not-implemented signal at the seam. A syntax error, wrong
  import path, missing fixture or misconfigured runner is not a red.
- If you can run the tests, run them and record each failure message. If your grant does not allow
  running, give the exact command and the exact failure message you expect from each test. Do not
  report red on the strength of "obviously fails".
- If a criterion cannot be tested as written (ambiguous, or not observable), say which and why. Do
  not invent behaviour to make it testable.

### Do not

- Do not write or edit production code, and do not add stubs to make imports resolve.
- Do not write a test that passes today. If one does, the behaviour already exists or the test is
  vacuous; report it and do not weaken the test to change the outcome.
- Do not assert on values read from the code path that produced them, use `toBeDefined` or
  `toBeTruthy` as the only assertion, record a snapshot of current behaviour, or swallow errors in a
  `try`/`catch`.
- Do not skip, `.only`, or mark a test expected-to-fail.
- Do not test behaviour no criterion asks for.
