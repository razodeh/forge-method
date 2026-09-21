<!-- forge:generated v=0.0.0 hash=336bc6e9a86bf3b77f086c74cce1f6fa63aacd42b985fc70ddc47472e3603cfb — edits will be overwritten; use overrides/ -->
Decide how the code is organized into repositories, and record the decision as one ADR. This is the
first step of project initialization; the scaffold that follows will implement whatever you decide,
so it must be unambiguous.

### Inputs

- The architecture and stack decisions that passed `G-Design`: the "Deployable units and runtimes"
  table in `architecture/architecture-spec.md` (how many deployable units exist and what runtime
  each uses), `architecture/components.md`, and the stack ADRs.
- The KB constraints (`constraints/**`), especially regulatory constraints on code isolation and any
  mandated hosting or repository setup.
- How many people and agent lanes will change the code concurrently (from the constraints or the
  project configuration; ask the human if neither says).

### Procedure

Use the repository-strategy decision method.

1. Derive two inputs from the architecture instead of asking: the number of deployable units and the
   number of distinct runtimes.
2. Ask the human only what the inputs do not answer: concurrency, and whether all deployables must
   ship together (always, usually, independent).
3. Apply the rules before scoring. A single deployable unit eliminates polyrepo and meta-repo and
   prefers a single-package monorepo. A regulatory code-isolation requirement eliminates both
   monorepo options.
4. Score the remaining options on: atomic cross-cutting change, independent release cadence, build
   tooling cost, access-control granularity, CI scale, and onboarding simplicity, with evidence in
   each cell.

### What to produce

- One `ADR` (category `delivery`) with the score table, the recommendation, and its killer risk.
  Give it a `revisit_trigger` that is a measurable condition (for example a second deployable that
  must release independently), a `reversibility` that honestly reflects how costly a later split or
  merge is, and a `blast_radius`.
- The KB entry `delivery/repo-strategy.md`: the chosen strategy, the top-level repository or
  workspace layout, package boundaries, and ownership by role or team (the source for a CODEOWNERS
  file). Real user handles are not in your inputs; record them as an assumption for the human to
  supply.

### Acceptance criteria

- The ADR shows every option, including the ones eliminated by a rule and the rule that eliminated
  them.
- The chosen option is consistent with the number of deployable units and runtimes in the
  architecture; if it is not, the ADR says why.
- The ADR states what the scaffold step must create: the repository or workspace layout, package
  boundaries, and the ownership file.
- No claim about tooling cost or scale is made without a basis in the inputs.

### Do not

- Do not create files, directories or configuration. The scaffold step does that.
- Do not choose the build tool, package manager, or the folder convention inside a package. Those
  are decided while scaffolding.
- Do not re-open the architecture or the technology stack. If the repo strategy cannot work with
  them, hand off instead of overriding.
