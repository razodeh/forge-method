<!-- forge:generated v=0.0.0 hash=96ce2c92c46f6b23b01355c1ca43da597d58780b2196da6e5e9f864fee0bf124 — edits will be overwritten; use overrides/ -->
Produce the threat model for the designed system: a STRIDE pass over every component boundary, with
a data-flow view and trust boundaries, where each threat ends in a mitigation and a test that would
prove it.

### Inputs

- The architecture from `select-architecture` and the stack ADRs from `select-stack`:
  `architecture/components.md`, the container view, and the choices for authentication, hosting and
  third-party services.
- The data model, especially its personal, sensitive and regulated attributes.
- The `Capability` artifacts (to find the assets and actors), and the KB constraints
  (`constraints/**`), especially the regulatory ones.

### What to produce

- The threat model, written as a KB entry in the `architecture` section
  (`architecture/threat-model.md`, `type: knowledge`, with the KB entry body sections), and one
  `HandoffRecord` entry (subtype `threat-model`; `from: security`, `to: architect`,
  `step: threat-model → design-review`) that registers it. The entry has no `subtype` key, so the
  first string in `delivered` is `subtype: threat-model`, the second is the model's path.
- A trust-boundary data-flow diagram as a Mermaid `flowchart` with one subgraph per trust boundary
  (`architecture/views/threat-model.mmd`), registered as a `Diagram` with caption and alt text, and
  at most about 20 nodes and 30 edges (layer it if larger). Every internal node is a component from
  the inventory. External actors and third-party systems appear as labelled nodes outside the
  boundaries and are listed in the model's actor inventory.
- For each boundary crossing, the STRIDE categories that apply (spoofing, tampering, repudiation,
  information disclosure, denial of service, elevation of privilege), each as a row: asset, threat,
  likelihood, impact, mitigation, residual risk, and the test that proves the mitigation.
- The authentication and authorization approach was chosen with the stack. Review it here and record
  its threats. Write an `ADR` (category `security`) only for a decision that is still open, such as
  the authorization model or secrets handling, and only when a real alternative exists.
- A `Risk` entry (in `kb/risks.md`, with an owner) for every residual risk that is not reduced to
  low.

### Depth

The design phase runs this step at every level, and the method makes a threat model mandatory at L3
and L4 and wherever a regulatory constraint exists. At L2 keep it proportionate: cover the
internet-facing edge, authentication, and every store that holds personal data, and leave out only
boundaries that carry no sensitive data. Do not skip it.

### Acceptance criteria

- Every component boundary and every external integration in the inventory appears in the diagram
  and in at least one row.
- Every row has a concrete mitigation, stated as a change that a story could implement (not "follow
  best practices"), and a test that could fail if the mitigation is missing. The planning steps turn
  each non-low mitigation into an epic or story, so write each one with a clear scope.
- Every regulated or sensitive attribute in the data model is protected by at least one row: at
  rest, in transit, in logs, and in backups where relevant.
- Ids of components, ADRs and requirements that you cite exist.
- Residual risk above low has a `Risk` entry, and a high one is put to the human before you close.

### Do not

- Do not paste a generic OWASP or STRIDE checklist. A threat that does not name a real component and
  asset is not a finding.
- Do not mark a threat mitigated because a technology is "secure by default". Name the control and
  how it is verified.
- Do not accept risk on the human's behalf.
- Do not change the architecture. If a mitigation requires it, put the change in
  `constraints_for_receiver` for the design review.
