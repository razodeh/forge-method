Choose the system's architecture style, decompose it into components with clear ownership, and
record each decision as an ADR. `G-Design` will check that every component has an owning ADR, every
structural ADR points to a diagram, the required diagrams exist, and every NFR has a mechanism and a
verification.

### Inputs

- All `Capability` artifacts and the `NFR` artifacts, with the Vision for context.
- The UX spec and its `ux-spec` handoff record: the `constraints_for_receiver` list carries UX needs
  (offline use, real-time updates, session handling) that can change the style.
- The KB constraints (`constraints/**`): team size, operational maturity, mandated or forbidden
  technology, regulatory flags.
- The project level, and the architecture decision frameworks where they are attached to you
  (architecture style, pattern selection, NFR strategy). The procedure below is complete without
  them.

### Procedure

1. **Style.** Gather the decision inputs (team size, whether independent scaling is a hard NFR,
   operational maturity) from the constraints; ask the human for any that are missing. Apply the
   elimination rules first: fewer than about 8 engineer-equivalents eliminates microservices; no
   operational maturity eliminates microservices and event-driven; no hard independent-scaling need
   prefers a modular monolith. Then score the remaining options on scaling-independence fit,
   operational-maturity fit, domain-boundary clarity, velocity, and latency and consistency fit,
   with evidence in every cell. The default at L2 and L3 is a modular monolith with explicit
   internal boundaries and named extraction seams. Choosing microservices at L2 or L3 requires human
   confirmation and an ADR that states the operational cost accepted. State the condition that would
   disqualify the chosen style, its killer risk, and the concrete trigger for extracting a service.
2. **Decomposition.** From the capabilities, cluster aggregates by reason to change and data
   ownership into components. Check the result with the change test (a typical feature touches at
   most two components), the data ownership test (each piece of state has one owning component), the
   failure test and the team-parallelism test, and report which failed.
3. **Interactions.** For each cross-boundary interaction choose the style, protocol, sync or async,
   delivery guarantee, idempotency and failure behaviour. Any async path needs its retry,
   dead-letter and idempotency design stated.
4. **Patterns.** Adopt a pattern only for a specific problem. Each pattern ADR states the
   precondition it satisfies, the cost accepted, the simpler alternative rejected, and where it must
   not be applied.
5. **NFR strategy.** For each NFR write the mechanism and the verification, in
   `architecture/nfr.md`. An NFR with neither is reported as unmodelled at the design gate.

### What to produce

- `ADR` artifacts (category `architecture`): one for the style and decomposition, and one for each
  pattern or NFR-strategy decision that has a real alternative. Each has all front-matter fields, a
  `revisit_trigger` that is a measurable condition, `reversibility`, `blast_radius`, `framework`, a
  score table of the options, and the sections Context, Options considered, Decision, Diagram,
  Consequences and Reversal plan. Do not choose products, vendors, versions or runtimes; technology
  selection is the next-but-one step.
- The architecture spec (`architecture/architecture-spec.md`) and `architecture/nfr.md`, both KB
  entries. In the spec, record for each component its owned data, interface and scaling axis, and
  which components are separately deployable units, and include the interaction matrix from step 3
  (one row per interaction: caller, callee, style, protocol, sync or async, delivery guarantee,
  idempotency, timeout and retry, failure behaviour). Runtimes are added by the technology step.
- `architecture/components.md`: a `type: Component` file whose `components` list holds one entry per
  component with exactly these fields: `id` as `component:<slug>`, `label`, `responsibility`,
  `owner`, `dependsOn`, `failureModes`. The schema is strict, so nothing else goes in an entry.
- For every component, one active KB entry, a file under `architecture/`, whose `applies_to` names
  `component:<slug>` (lower-case letters, digits and hyphens) and whose `sources` cite the owning
  ADR as `kind: decision` with the real ADR id. That link is how component coverage is decided. Cite
  exactly one ADR per component (the style and decomposition ADR), and add no component-scoped KB
  entries for pattern, NFR or stack ADRs: two accepted ADRs of one category with overlapping scope
  and no supersession link are reported as a contradiction.
- Diagrams, each registered as a `Diagram` with caption and alt text, `depicts` naming real
  components, and at most about 20 nodes and 30 edges (split into layered views beyond that): the
  context view (`architecture/views/context.mmd`), the container view
  (`architecture/views/containers.mmd`), a sequence diagram for every cross-boundary flow of two or
  more hops (`architecture/views/seq-<flow>.mmd`), and one for every async path
  (`architecture/views/async-<flow>.mmd`), each covering the failure path (timeouts, retries, dead
  letters) and not only the happy path. Derive the container view from the component inventory where
  a generator exists, and mark it `generated` only if it is.

### Acceptance criteria

- Every ADR has a non-empty `diagrams` list. A structural ADR with none fails the diagram coverage
  check.
- Every component in `components.md` has exactly one owning ADR through an active KB entry as
  described above.
- Every NFR id is cited by at least one mechanism in `architecture/nfr.md`, and each mechanism names
  how it is verified.
- Every recommendation shows the score table, including the options that were eliminated and why.
- The components file parses under the component schema: no extra fields, and every `dependsOn`
  names an existing component.

### Do not

- Do not pick microservices or an event-driven design because it sounds scalable. Justify from the
  inputs.
- Do not leave a real decision with alternatives without an ADR, or write an ADR for a choice that
  had no alternative.
