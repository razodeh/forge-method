Decide, and record, how the system gets from its current state to the migration goal without ever
breaking the running version. The steps after yours execute this plan literally: an expand phase, a
data migration, a contract phase and a verification run. If your plan is vague, those steps
improvise on production data.

### Inputs

- The workflow input `migrationGoal`: the schema, platform or framework change requested.
- The current state, from the architecture, data model and interface contracts in the KB
  (`architecture/**`, `data/**`), the migration history in the repository, and existing ADRs you may
  be superseding.
- `constraints/*`, especially the availability and downtime constraints, and the NFRs the migration
  must not regress.
- The repository, read-only, to find every reader and writer of what is changing. Count them.

### Produce

One ADR (`category: data` for schema changes, otherwise the closest category,
`framework: schema-evolution-migrations`) with every front matter key the strict schema requires (`id`, `type`, `schemaVersion`, `title`, `status`, `created`, `updated`, `revision`, `author` and `changelog`, then `category`, `deciders`, `date`, `reversibility`, `blast_radius`, `revisit_trigger`, `supersedes` (the ADRs this one replaces, if any), `superseded_by`, `related`, `diagrams` and `framework`), whose sections are the required ones: Context, Options
considered, Decision, Diagram, Consequences, Reversal plan. It must contain:

- **Current and target state**, stated precisely enough to diff, and the exact list of things that
  change (tables, columns, types, endpoints, dependencies, config).
- **Options considered**, including at least one that avoids the migration or defers it, and why the
  chosen path won.
- **The phases, mapped to the workflow steps.** For each of expand, migrate-data, contract and
  verify-migration: what changes, what the previous code version still does correctly during and
  after the phase, how it is verified (a differential or round-trip oracle against the old
  representation, row counts, checksums) and how it is rolled back.
- **The diagram**: a Mermaid view of the phases and the release boundaries between them, with caption and
  alt text.
- **The readers and writers inventory**: every code path, job, report and external consumer that
  touches the changing structure, and the order in which each moves to the new one.
- **The change set**: an explicit list of the file paths and globs each phase may touch. The
  `blast_radius` front matter field names affected components; the later steps need paths, so write
  them out. Say also which release ships each phase, and record that no step in this workflow
  switches the readers or deploys, and name the KB file under `delivery/` where the evidence of the
  reader switch and the deployment will be recorded, and by whom: that must happen between the data
  migration and the contract phase, and the plan must say by whom and how it will be evidenced.
- **How the data migration runs**: the path of the migration script or routine the data migration
  step executes (`forge migrate run --phase expand`) and its arguments, so the expand step builds
  exactly that.
- **What the contract step can check itself.** Split the contract preconditions into those checkable
  by searching and reading the repository (no remaining references) and those that must arrive as
  recorded evidence (the deployment, the restore point), with where each will be recorded.
- **The backfill strategy** for existing data: batched, resumable, throttled, idempotent, and how
  progress and completion are measured.
- **The point of no return**: which action is irreversible (normally the contract phase), the exact
  preconditions that must be evidenced before it runs, and the reversal plan up to that point. Set
  `reversibility` to reflect it (`hard` or `one-way` when data is dropped).
- **The deployment sequencing**: schema and code changes ship in separate releases, and the plan
  names the release boundary between switching the last reader and removing the old structure.
- A `revisit_trigger` that is checkable, and the blast radius (components, teams, consumers).

### Acceptance criteria

- No phase requires the previous code version to break. State how each phase is compatible with the
  version currently deployed and with the one before it.
- Every precondition for the contract phase is verifiable from recorded output or a repository search, not by judgement.
- Every reader and writer found in the repository appears in the inventory, or the plan says why it
  is out of scope.
- Unknowns (data volume, live consumers you cannot see, downtime tolerance) are open questions or
  explicit assumptions with a validation method.

### Do not

- Do not write migration code, scripts or schema changes. This step decides; the next ones build.
- Do not plan a big-bang change, a destructive step in the same release as the code that stops using
  the old structure, or a migration you cannot roll back before the point of no return.
- Do not pick a migration tool or strategy without recording the alternative you rejected.
