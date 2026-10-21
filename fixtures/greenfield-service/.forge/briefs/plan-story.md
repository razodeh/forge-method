<!-- forge:generated v=0.0.0 hash=00c6d86a74f00d7aa5482287fb9e98b092b2ea2c64160dc46a2cac29e19f2858 — edits will be overwritten; use overrides/ -->
Write the implementation plan for one story before any test or code exists. The plan is a handoff to
the test author and then to you as implementer, so it must be specific enough that the tests can be
written against it and the code can be checked against it. It is also validated against the story's
file claim.

### Inputs

- The `Story`: acceptance criteria, `files_expected`, `interfaces`, `data`, `depends_on` and
  `context_refs`. Every acceptance criterion must be accounted for in the plan.
- Every `InterfaceContract`. The story's listed contracts are frozen; your plan builds on them and
  never redefines them. A story whose `interfaces` is empty may still consume one: each
  `Needs interface:` line in its body names an operation, and the contract that covers it is one the
  freezing step wrote under `docs/forge/specs/interfaces/`.
- `kb:engineering/standards`: layout, naming, error-handling and testing conventions.
- Relevant prior art in the repository. Read the code the story will touch or sit beside before
  deciding where new code goes; follow existing patterns over inventing new ones.

### Produce

A `HandoffRecord` (subtype `implementation-plan`) for this story, registered in
`reports/handoffs.md`. Its `step` names this planning step. The entry has no `subtype` key, so the
first string in `delivered` is `subtype: implementation-plan` (the output check reads the subtype from
that line). It has no free-form body, so carry the plan in the fields: the file starts with the `---`
line of this entry's own front matter — no heading, no title, no comment, nothing at all before it,
even if `reports/handoffs.md` does not exist yet and you are creating it for the first time. Close the
front matter too: after the very last field you write, add a final `---` line of its own, and nothing
after it — there is no free-form body for this type, so the file ends there. A front matter block with
no closing `---` is as invalid as one with no opening `---`, and fails the same way.

- `delivered`: after the `subtype:` line, each production file to create or change, one entry per file, with the approach in a
  sentence and the acceptance criteria it serves, and then each test file to create, one entry per
  file, starting `test:`, with the criteria it will cover. Every path must fall inside
  `files_expected`. The test author reads the `test:` paths and the implementer never edits them, so
  the implementer's own claim is the production paths only.
- `constraints_for_receiver`: the rules the tests and the implementation must respect. Include the
  contract names and error codes to use, the standards that apply, and the risks (concurrency,
  ordering, migration, performance) with how each is contained.
- `acceptance_for_receiver`: a plain array of strings, ONE SENTENCE per acceptance criterion — pack
  the test that will prove it (use the test names the story already binds to the criterion in its
  `tests` field, each beginning with its AC id, and say which planned test file holds it), the
  strongest oracle available, and the command that runs it, all into that ONE string, the identical
  "one entry per X, with Y in a sentence" shape `delivered` above already uses. NOT an object with
  its own `criterion`/`test`/`file`/`oracle`/`command` keys — that shape reads naturally from this
  section's own prose, but is wrong; e.g. write `'AC-001-1: src/foo.test.js asserts foo(5) === 10
  (exact-match); run with the project's configured unit command.'` as ONE string, not four or five
  separate fields.
- `open_questions`: a plain array of strings — anything a human must answer before implementation.
- `assumptions`: NOT plain strings — each entry is an object with its own `id` (`ASM-###`), `text`
  (the assumption itself), `confidence` (`low`/`medium`/`high`), and `validate_by` (how/when to
  confirm it), e.g. `{id: 'ASM-001', text: 'the order object shape is...', confidence: 'medium',
  validate_by: 'confirm with the architect before a second story consumes this function'}`. This is
  the only field in this handoff shaped as an object instead of a plain string — every other field
  above and below it, including `acceptance_for_receiver`, is a plain array of strings.

Address the receiver by role: `to` is the role that writes the tests next.

### Acceptance

- Every acceptance criterion maps to at least one planned test and at least one planned code change.
- No planned path is outside the story's file claim. If the work needs a file outside it, say which
  and raise `FORGE_REQUEST_CHANGE:` rather than planning the edit.
- Every interface, data element and error code the plan uses exists in a contract or the data model.
  If one does not, that is an open question, not a detail you invent.
- The approach names its riskiest step and how you would find out early that it is wrong.

### Do not

- Do not write tests or production code in this step.
- Do not plan work the criteria do not ask for, or a refactor of code the story does not need to
  touch.
- Do not restate the story. State decisions the story leaves open.
