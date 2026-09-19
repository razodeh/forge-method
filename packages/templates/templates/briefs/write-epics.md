Break the capabilities that belong to this stage into epics: coherent slabs of work, each delivering
part of exactly one capability. The stage to plan is this run's `stageId` input; if your context
does not state it, ask the human, and never infer it. The stories are written in the next step, so
each epic must give that step a clear boundary to cut along.

### Inputs

- The stage plan (`docs/forge/plans/stages.md`): the entry whose `id` equals `stageId`, with its
  `goal`, `capabilities`, `excluded`, `exit_criteria` and `nfr_subset`.
- The `Capability` artifacts listed in that stage, and the `NFR` artifacts in its `nfr_subset`.
- The architecture ADRs and `architecture/components.md`, the data model, and any interface
  contracts that already exist (contracts are usually frozen later, so expect none), for the ids an
  epic should cite.
- The UX spec, for user-facing capabilities.
- The threat model (`architecture/threat-model.md`) and the NFR mechanisms (`architecture/nfr.md`):
  each non-low mitigation and each mechanism that applies to this stage's capabilities becomes part
  of an epic's scope, or is explicitly deferred with a reason.

### What to produce

One `Epic` per coherent slab of work. Fill every field:

- `capability`: the id of the one parent capability. An epic never spans two capabilities; split it.
  A cross-cutting enabler (authentication, observability, a migration) is attached to the first
  capability that needs it, and says which other capabilities it also serves.
- `stage`: the value of `stageId`.
- `goal`: one sentence naming the outcome the epic delivers.
- `scope_in` and `scope_out`: what is covered and what is deliberately excluded. Use `scope_out` for
  anything a reader could assume is included but is planned elsewhere, with the epic or stage that
  owns it.
- `interfaces` and `data`: the `INT-###` and `DM-###` ids the epic touches, only ids that exist.
  Describe a needed interface that does not exist yet in the epic body.
- `exit_criteria`: observable conditions, including the end-to-end check that would run in the
  stage's target environment.
- `stories`: leave empty. `write-stories` fills it in.

Then add each new epic's id to its capability's `epics` list.

### Acceptance criteria

- Every capability in the stage has at least one epic (the KB linter reports a capability with no
  downstream epic), unless it is `wont`.
- Every epic's `capability` exists and is listed in this stage.
- The epics of one capability, together, cover its `acceptance_summary`. State which epic delivers
  which part.
- Epics do not overlap: no piece of scope appears in two `scope_in` lists.
- The stage's `nfr_subset` is addressed: each NFR in it is named in the exit criteria or scope of at
  least one epic that can verify it.
- In the first stage, one epic delivers the first thin end-to-end slice on top of the scaffold, and
  it says so, so the stories can carry the walking skeleton.
- An epic goal uses backticks only around terms defined in `glossary.md`; the KB linter warns on
  undefined ones.
- Epics are sized to be sliceable into stories of size S or M. If one clearly cannot, split it now.

### Do not

- Do not write stories, acceptance criteria or tasks.
- Do not plan capabilities from other stages or from the `excluded` list.
- Do not organize epics by technical layer ("database", "frontend"). An epic is a vertical slice of
  a capability. A purely technical epic is allowed only when the architecture requires an enabler,
  and it must say which capability it enables.
- Do not cite ids that do not exist.
