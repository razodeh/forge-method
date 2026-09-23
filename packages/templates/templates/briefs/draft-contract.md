Design and write the contract for one cross-boundary interaction, the one named by this run's
`interfaceName` input. That input is not one of this step's declared inputs, so if the interface's
name is not in your context, ask with `FORGE_ASK:` rather than choosing one. Once it merges it is
the frozen source that consumer and provider both build against and that the next step turns into
contract tests, so it has to be complete and testable.

### Inputs

- The `ArchitectureSpec`: which components sit on each side of the interaction, the pattern chosen
  (request/response, event, queue, stream) and the constraints on it.
- `kb:architecture/integration/**`: existing protocols, conventions, versioning rules and other
  contracts this one must stay consistent with.

### Produce

One `InterfaceContract` at `docs/forge/specs/interfaces/<interfaceName>.yaml`, with an unused
`INT-###` id and the standard front matter. The contract file is YAML (OpenAPI, AsyncAPI, JSON
Schema) with the record's front matter keys at its top level. If the stack's notation is not YAML
(protobuf, GraphQL SDL, TypeScript types), put that source beside it in its own notation, and have
the YAML record carry the id, title and a reference to it. The contract states:

- Operations or messages: for each, the full request or payload schema, the response schema,
  required and optional fields, formats and limits.
- Errors: every failure the provider can report, with a stable code, the conditions that produce it
  and whether the caller may retry.
- Delivery guarantee: at-most-once, at-least-once or exactly-once in effect, and the idempotency key
  that makes a repeated call safe. Every async path declares its retry policy and dead-letter
  handling.
- Timeouts and ordering: the timeout a caller must apply, any ordering guarantee, and rate or size
  limits.
- Failure path: what each side does when the other is slow, unavailable or returns an error, not
  only the successful sequence.
- Versioning: how the contract versions and what counts as a breaking change, following the
  project's API versioning decision. State the version of this contract.
- Security: authentication, authorisation and any sensitive fields.
- Examples: at least one valid example per operation and one per documented error, which the tests
  can validate.

### Declarations the gate reads

Write or update `docs/forge/kb/architecture/version-skew.yaml` so this contract's id is declared there
too, alongside every other id already declared. `G-Integration`'s `version:skew` check
(`forge spec validate --rule version-skew`) reads that file, not this contract. Add or update this
id's entry under `contracts`: `current` (this contract's version) and one `consumers` entry per
consumer this run adds or moves, `{name, version}`. Only raise `policy.max_skew` when the versioning
decision above needs a wider window, with the ADR that justifies it. `freeze-contracts.md` shows the
full shape, including the `none_reason` a still-empty `contracts` needs.

### Acceptance

`G-Integration` runs on the merged contract before this interaction's tests are written. It checks
version skew and migration order, and its cross-service contract check runs any contract tests that
already exist for other interactions. The step after that gate writes the tests from this file
alone, so:

- A reader with only this contract can implement either side without asking a question.
- Every error case and every guarantee above is stated as something a test could assert.
- The contract agrees with the architecture spec and the existing integration contracts, and any
  difference is stated as a deliberate change with its impact on existing consumers.
- If it changes an existing contract, the change is classified breaking or not, with the migration
  path for each consumer.

### Do not

- Do not describe only the happy path.
- Do not write implementation code or the tests; those are separate roles and steps.
- Do not leave a field, error or guarantee open for later. Ask a question if the architecture does
  not decide it.
