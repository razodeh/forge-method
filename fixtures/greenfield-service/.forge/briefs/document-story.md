<!-- forge:generated v=0.0.0 hash=5981f8567dd4bb70a700b481876f8a8294bd79afba2d76fc0deafedb2d13dc6d — edits will be overwritten; use overrides/ -->
The story has passed review. Leave the project's documentation and knowledge in the state a newcomer
would need to understand and safely change what this story added. Do this from the change that was
actually reviewed, not from the plan.

### Inputs

- `diff:lane`: the reviewed change. Everything you document must be traceable to it.
- The story's acceptance criteria and the contracts it implements, in your context. They are the
  source of truth for behaviour; the documentation must agree with them.

### Produce

Update only what this change made stale or missing:

- Public API documentation: for every public function, endpoint, event, command or configuration key
  the story added or changed, document what it does, its inputs and outputs, its errors, and one
  usage example that actually matches the code. Write documentation files where the project's
  standards put them, and doc comments only on the code this story added; otherwise leave production
  code alone, and never edit a frozen contract. If docs are generated from a contract or from
  comments, edit the comments you own, never the generated output, and give the command that
  regenerates them if your grant does not let you run it. If the right home for a document is
  outside the story's `files_expected`, raise `FORGE_REQUEST_CHANGE:`.
- Diagrams: if the change altered a structure, sequence, state machine or data model a generated
  diagram depicts, regenerate it with the project's generator. `G-Design` and `G-Deliver` fail on
  drifted diagrams, so a stale one is a defect. If no generator exists, or your grant does not let
  you run it, say which diagram is stale and the exact command that regenerates it.
- Decisions: any choice made during implementation that had alternatives worth naming (a data
  structure, a library, an error strategy) becomes a KB proposal for `engineering/standards.md`
  where it is a standard, or, if it is hard to reverse, is handed to the architect to record as an
  ADR with `FORGE_HANDOFF: architect`. Include the context, the alternatives, the decision and the
  consequence.
- Notes for operators or users only where the change alters how the system is run, configured or
  observed.

### Acceptance

- No public symbol added or changed by the diff is undocumented.
- Every example and command in the documentation is one you could run against this change and get
  the result the text claims.
- Docs, contracts and code agree. If you find that they do not, report the mismatch and do not paper
  over it in prose.
- Each decision proposal names the story and acceptance criteria it arose from.

### Do not

- Do not change production code beyond doc comments on this story's own new code, and do not change
  tests or contracts. If documenting reveals a bug, report it.
- Do not document behaviour the acceptance criteria do not cover as if it were guaranteed.
- Do not paste the diff or the story back as documentation, and do not write changelog entries; the
  release step owns those.
