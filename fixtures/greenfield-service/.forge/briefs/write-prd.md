<!-- forge:generated v=0.0.0 hash=b89b7b0fa0210ce0b1c6e76a1d17cbb3106b57ca8cea311caed021bc327d653a — edits will be overwritten; use overrides/ -->
Turn the Vision and the capability brainstorm into the product's requirements: a prioritized, staged
set of Capabilities, and the numeric NFRs that bound them. After this step the product gate checks
that every capability has an acceptance summary, every NFR is numeric, and no open question remains.

### Inputs

- The `Vision` (`VIS-001`): target users, success metrics, non-goals, horizon.
- The record of the `capability-brainstorm` session: the candidate capabilities and the ideas it
  discarded.
- The KB `product/` entries from discovery, the KB constraints (`constraints/**`), and the
  `Assumption`, `Risk` and `OpenQuestion` entries so far.

### What to produce

- One `Capability` per user-meaningful ability the product must offer. A capability is something a
  user can do, not a component or a task. Fill every field:
  - `statement`: "As a (user), I can (do X) so that (outcome)."
  - `priority`: `must`, `should`, `could` or `wont` (MoSCoW). Use `wont` for a capability that is
    deliberately deferred; it stays recorded, with `stage: deferred` (the schema requires a stage
    value, and no delivery stage exists for it).
  - `stage`: the delivery stage that targets it (for example `mvp`). Use the stage names the human
    or the Vision's horizon already use; the stage-planning step assigns the final stage of each
    capability.
  - `depends_on`: other capability ids, forming no cycle.
  - `nfrs` and `metrics`: the `NFR-###` and `MET-###` ids it must satisfy or move.
  - `acceptance_summary`: the observable condition that means the capability is done.
  - `epics`: leave empty; the epic-writing step fills it in.
- `NFR` artifacts for every quality constraint not already recorded in discovery, under the same
  rules as in discovery: a `category` from the schema's list, a `metric`, a `target` that begins
  with a number (`< 300ms`, `>= 99.9%`), `conditions`, and a `verification` with `kind` and a
  descriptive `ref` (the concrete test is allocated later; do not invent a test id). A categorical
  standard is encoded as a count, for example target `0` open violations with the named standard in
  `conditions`. If any capability is user-facing, an accessibility NFR is required. Every NFR id is
  listed in the `nfrs` field of each capability it governs, or is system-wide and says so in its
  statement; `applies_to` may stay empty until components exist.
- The capability index in the KB (`product/capabilities.md`): one line per capability with id,
  title, priority and stage.

### Acceptance criteria

- Every `must` and `should` capability traces to at least one Vision target user and to at least one
  `MET-###` metric it moves, cited in its `metrics` field, or is explicitly an enabler that says
  which capability it enables.
- Every capability has a non-empty `acceptance_summary` that names something observable, not "works
  well".
- Every NFR target parses as a number. Where the inputs give no figure, propose one with a stated
  reason, keep the NFR at `status: draft`, say "proposed" in its `statement`, and record an
  `Assumption` with `validate_by`. If no reasonable basis exists at all, ask the human instead.
- Capabilities that the Vision lists as non-goals appear only as `wont`, if at all.
- An `OpenQuestion` entry is created only for a question that must be answered before product
  approval, because any `OpenQuestion` left open blocks the product gate and, later, every story's
  readiness. Resolve it or turn it into an `Assumption` with `validate_by` before you finish.
- Every success metric in the Vision is moved by at least one capability, and not every capability
  is `must`: priorities are differentiated, with the reason for each `must`.
- The NFRs cover the security, privacy, availability, cost and performance categories, or state for
  each missing one why it does not apply to this product.
- Capability statements and acceptance summaries use backticks only around terms defined in
  `glossary.md`; the KB linter warns on undefined ones.

### Do not

- Do not write epics, stories, screens, APIs, data models or technology choices.
- Do not add capabilities the Vision and brainstorm do not support in order to look complete.
- Do not merge distinct capabilities into one to keep the count down, or split one into technical
  tasks.
- Do not leave an NFR qualitative ("secure", "fast", "scalable").
