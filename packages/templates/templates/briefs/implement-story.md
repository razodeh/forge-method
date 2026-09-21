Make the story's failing tests pass with the smallest correct implementation. The tests were written
by a different session against the acceptance criteria; they are the specification you are held to,
not something you tune to fit your code.

### Inputs

- The `Story`: its acceptance criteria, `files_expected` (the paths you may write, less any test
  files: the tests were written by another session and are not yours to edit), `interfaces`, `data`
  and `context_refs`.
- Every `InterfaceContract`. The ones the story lists are frozen: implement to them exactly, and
  import generated types where the contract names a generator rather than re-declaring shapes. A
  story whose `interfaces` is empty may still consume a contract: each `Needs interface:` line in
  its body names an operation, and the contract that covers it is one the freezing step wrote under
  `docs/forge/specs/interfaces/`.
- `kb:engineering/standards`: the coding standards, layout conventions and error-handling rules for
  this project.
- The failing tests in the story's test paths, and the implementation plan from the earlier planning
  step if one is in your context. Read the tests first; they say what each criterion means.

### Produce

Production code inside the paths in `files_expected`, and only there, that makes every test for this
story pass without breaking any other test. Work criterion by criterion: take one failing test, make
it pass, then the next. Follow the plan's approach unless the code proves it wrong; if so, say what
changed and why.

### Acceptance

- Every test bound to this story's acceptance criteria passes, and the rest of the suite still does.
- Every changed file is a production file inside `files_expected`. Anything else, including every
  test file written in the red step, needs a request, not an edit.
- The code uses the contracts as written: same names, shapes, error codes, and retry and idempotency
  behaviour.
- The code meets the project's standards, including its lint and typecheck rules, and is complete:
  no stubbed paths or mocked business logic.
- Name the commands that prove the story ready, so the verification step can run them. If your grant
  does not let you run the tests, say so and give the command and the outcome you expect; never
  report a result you did not observe.

### If a test or contract looks wrong

Test files and frozen contracts are outside your claim, even where a test glob appears in
`files_expected`: the red step wrote them, and the separation between test author and implementer is
the point. Editing them is a policy violation, and "fixing" a test to make it pass is the failure
this loop exists to prevent.

- If you believe a test is wrong, do not touch it. Emit `FORGE_REQUEST_CHANGE:` against the test
  with a specific justification (which assertion, which criterion it contradicts, and what the
  criterion actually requires). The test author adjudicates, and the request is counted in the
  retro.
- If you need a contract changed, emit `FORGE_REQUEST_CHANGE:` against it and continue with the
  parts that do not depend on the change.
- If a criterion is ambiguous, ask rather than choosing the reading that is easiest to satisfy.

### Do not

- Do not edit, delete, skip or loosen any test, snapshot or fixture. Do not add a test-only code
  path to production code to satisfy a test.
- Do not write code that special-cases the test inputs. Implement the behaviour the criterion
  states.
- Do not build beyond the criteria "while you are here"; extra behaviour is unverified behaviour.
- If a previous attempt failed, do not resubmit the same change. Read the failure message, change
  the approach, and say what you learned.
