<!-- forge:generated v=0.0.0 hash=d9c53d27cd6dd81ca80b6f1831a3d883c7a7a8012fe5e24802f96da4c2043c75 — edits will be overwritten; use overrides/ -->
Select the technology stack as one coherent set that fits the architecture, the data access patterns
and the constraints, and record each significant choice as an ADR. Pick the boring option and record
the trigger that would change the answer.

### Inputs

- The architecture ADRs, the architecture spec, and `architecture/components.md` from
  `select-architecture`.
- The UX spec and its handoff record, for whether there is a UI and what it needs (offline,
  real-time).
- The data model, `data/access-patterns.md`, and the storage-category ADR from `model-data`. The
  category is already decided; choose the concrete product within it.
- The `NFR` artifacts and the KB constraints (`constraints/**`): mandated and forbidden technology,
  team skills, cloud, licence policy, compliance.
- The technology catalog entries in your context, when present, and the project level.

### Procedure

1. **Constraint filter.** Remove every option that violates a hard constraint, and list what you
   removed and why. Silent elimination is a defect.
2. **Mandates.** If a constraint mandates a technology, record it as the decision with
   `framework: mandated` and do not re-score it.
3. **Coherent grouping.** Choose together: language and runtime, application framework, frontend
   framework if there is a UI, data-access approach, the datastore product, the schema migration
   tool (recorded against the strategy in `data/migrations.md`), cache or queue if needed (a cache
   needs a named invalidation event and a hit-rate target), authentication (including the identity
   provider), any other third-party service, the observability backend, and the deployment platform.
   Prefer combinations known to work together, and penalize any new language runtime, package
   manager or deployment mechanism that no requirement demands. Never build undifferentiated heavy
   lifting (authentication, email delivery, payments, search, observability backends) without an ADR
   that justifies it against a named alternative. The CI/CD platform is decided later, in project
   initialization, and is not part of this step.
4. **Score** the surviving options on weighted criteria: fit to requirements, team familiarity,
   ecosystem maturity, operational burden, hiring and AI-assistant support, cost, exit cost, and
   agent friendliness, with evidence in each cell.
5. **Limits.** One primary language by default, two at most at L3, unless an ADR justifies more. A
   technology whose maturity is emerging needs human approval and a documented fallback.

### What to produce

- One `ADR` (category `architecture`, or `data` for the datastore) per significant choice. Each has
  all front-matter fields, a `revisit_trigger` that is a measurable condition, a score table, the
  killer risk of the chosen option, an exit plan when there is lock-in, and a `diagrams` list that
  references the existing container view. Reference that diagram; do not edit it, since the C4 views
  are derived from the component inventory. Add no component-scoped KB entries for these ADRs
  (component coverage already rests on the architecture ADR).
- A "Deployable units and runtimes" table in `architecture/architecture-spec.md`: for each
  deployable unit, its runtime, framework, data store and deployment target. The repository-strategy
  step reads it to count deployables and runtimes.
- The list of libraries the choices imply, and the conventions coding agents need, added to the KB
  entry `engineering/standards.md`. Extend that entry if it exists; do not overwrite it.

### Acceptance criteria

- Every component in `components.md` is covered by a choice: its runtime, its data store, and how it
  is deployed.
- Every choice cites the NFR or access pattern that motivates it, and no choice contradicts a
  constraint.
- The number of runtimes, datastores and infrastructure primitives is justified by named
  requirements.
- Every ADR shows the options that lost and why, including the eliminated ones.

### Do not

- Do not re-decide the architecture style or the storage category.
- Do not recommend technology because it is popular or because it is new. State evidence from the
  inputs.
- Do not assume versions, prices or capabilities you cannot source from your inputs; label them as
  unverified in the ADR.
