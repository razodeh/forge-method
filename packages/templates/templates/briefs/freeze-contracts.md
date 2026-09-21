Every story in this stage is about to be built in its own lane, in parallel, and no lane can see
another lane's in-flight work. Your job is to write down, before any of that starts, every seam the
lanes share, so each implementer imports a contract instead of inventing one. After this step and
the `G-Design` gate that follows it, those contracts are frozen for the stage.

### Inputs

- `Epic(*)` and `Story(*)` for this stage. For each story read `interfaces`, `data`,
  `files_expected`, `depends_on`, every acceptance criterion, and the
  `Needs interface: (operation), consumer (component)` lines in its body (`write-stories` writes one
  for each interface the story consumes before any contract exists, and leaves `interfaces` empty).
  Two stories whose file claims or acceptance criteria touch the same function, endpoint, event,
  table or config key share a seam, and every `Needs interface:` line is a seam.
- `kb:architecture/**`: the architecture spec. Component boundaries, patterns and integration styles
  are already decided there and in the ADRs; you record their concrete shape, you do not reopen
  them. Only the ADR index reaches your context by default, so request the full text of any ADR a
  contract depends on with `FORGE_REQUEST_CONTEXT:`.
- `docs/forge/specs/interfaces/` (not a declared input; read it for context): contracts that already
  exist, including ones frozen in an earlier stage. Read it before allocating any `INT-###` id, so
  yours are unused, and before writing a contract that overlaps one.
- `kb:data/**`: the data model. Entities, keys and migration ids come from here.

### Produce

`InterfaceContract` artifacts, one per contract, under `docs/forge/specs/interfaces/`. Each carries
an `INT-###` id that is not already taken and the standard front matter. The contract file is YAML
(OpenAPI, AsyncAPI, JSON Schema) with the record's front matter keys at its top level. If the
stack's notation is not YAML (protobuf, GraphQL SDL, TypeScript types), put that source beside it in
its own notation, and have the YAML record carry the id, title and a reference to it. Cover all four
kinds a stage can share:

- Interface contracts: API operations, internal module interfaces, event and queue message shapes.
  Every operation states request, response and every documented failure.
- Data contracts: entity and table shapes, keys, and migration ids, consistent with the data model.
- Error contracts: error codes, which are retryable, and the idempotency key for every operation a
  caller may retry.
- Config contracts: environment variable names, defaults and secret names (names only, never
  values).

Where the stack can generate code from a contract, name the generator and its output location in the
contract, so implementers import the generated types and never re-declare them.

### Acceptance

`G-Design` runs `forge spec interfaces --check-frozen` and fails on any `undefined_refs`. So:

- Every `INT-###` listed in any story's `interfaces` resolves to a contract, either one you wrote or
  one that already exists from an earlier stage. Do not rewrite a contract from an earlier stage; if
  this stage needs it changed, raise `FORGE_REQUEST_CHANGE:`.
- Every `Needs interface:` line of every story is covered by a contract whose title or operations
  name it, so that an implementer who reads `docs/forge/specs/interfaces/` finds it (the implement,
  plan and test steps do exactly that for a story whose `interfaces` is empty). Your closing message
  lists, one line per story, the `INT-###` ids that cover its lines. You do not edit stories:
  `interfaces` stays as `write-stories` left it.
- Every seam you found is either covered by a contract or shown to be private to one story.
- If a story consumes an interface it does not list and has no `Needs interface:` line for, do not
  edit the story; raise `FORGE_REQUEST_CHANGE:` naming the story and the missing `INT-###`.
- Each contract is complete enough that two implementers working only from it would build compatible
  halves: no field, error case or ordering rule is left to be "decided during implementation".
- Contracts agree with the ADRs and data model they cite. Where they cannot, stop and report the
  conflict.

### Do not

- Do not write implementation code, tests or stories; you own contracts only.
- Do not add contracts for seams no story in this stage uses.
- Do not leave a gap for a later lane to close. A lane that needs a change after the freeze must go
  through `FORGE_REQUEST_CHANGE:` to you, so an incomplete contract only moves the cost later.
