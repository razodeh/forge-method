Write the UX spec: for every user-facing capability, the flow a user takes, the information
architecture around it, and the full set of states each screen can be in. Every user-facing
capability must have a flow map and a state inventory before implementation starts.

### Inputs

- The `Capability` artifacts from `write-prd`: `statement`, `priority`, `acceptance_summary`, and
  the linked `nfrs`.
- The Vision's target users, and the personas in the KB `product/users.md`.
- The NFRs in the accessibility, performance and privacy categories, and the KB constraints
  (`constraints/**`).

### What to produce

The UX spec, written as a KB entry in the `product` section (`product/ux-spec.md`,
`type: knowledge`, with the KB entry body sections), and one `HandoffRecord` entry (subtype
`ux-spec`; `from: ux`, `to: architect`, `step: write-ux-spec → product-gate`) that registers it. The
entry has no `subtype` key, so the first string in `delivered` is `subtype: ux-spec`, the second is
the spec's path.

The spec contains:

1. Capability coverage table: each capability id marked "user-facing" or "no UI", with a reason for
   the latter.
2. Information architecture: the navigation structure, screen or view inventory, and where each
   capability lives.
3. For each user-facing capability, a flow map as a Mermaid `flowchart`, including the failure and
   cancel paths. Give each diagram a caption and alt text, and keep each within about 20 nodes and
   30 edges; split a larger flow into layered views.
4. For each screen or view, a state inventory: initial, empty, loading, populated, error,
   permission-denied, offline or degraded where they apply, with what the user sees and can do in
   each.
5. Interaction and content rules that would otherwise be decided differently by each implementer:
   validation timing, confirmation of destructive actions, message tone, empty-state copy.
6. Accessibility: the target, taken from the accessibility NFR and cited by id, and how each flow
   satisfies it (keyboard path, focus order, contrast, labels).

In the handoff record, `delivered` lists the spec path, `constraints_for_receiver` lists UX
decisions that bind the architecture (real-time updates, offline use, session handling), which the
architecture step reads, and `open_questions` lists what you could not decide. The handoff's
`open_questions` list does not block a gate; an `OpenQuestion` entry in the KB does, so create one
only for a question the product cannot be approved without.

### Acceptance criteria

- Every capability appears in the coverage table. Every user-facing one has at least one flow and a
  state inventory for each screen it uses.
- Every state in an inventory is testable: a story could write an acceptance criterion for it.
- Every cited capability, persona and NFR id exists.
- If the accessibility NFR is missing or non-numeric, say so in `open_questions` and hand it off to
  the role that owns NFRs. Do not assume a level.

### Do not

- Do not choose colours, typography or brand identity unless a constraint specifies them.
- Do not add or change capabilities. If a flow reveals a missing capability, hand it off to the role
  that owns scope instead.
- Do not specify components, frameworks or APIs. The spec describes what the user experiences.
- Do not describe only the happy path.
