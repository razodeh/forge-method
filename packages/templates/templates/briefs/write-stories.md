Write the stories for this stage's epics. The stage is this run's `stageId` input; if your context
does not state it, ask the human, and never infer it. A story is the unit an engineer and a test
agent will execute against, so it must be vertically sliced, small, independently verifiable, and
ready to be claimed without asking anyone. The `G-Ready` gate mechanically checks the Definition of
Ready on what you write.

### Inputs

- The `Epic` artifacts you just wrote for this stage, and their parent `Capability` artifacts with
  `acceptance_summary`.
- The NFRs the stage enforces, the UX spec, the data model (`DM-###`), any existing
  `InterfaceContract` artifacts, and the ADRs.
- The threat model (`architecture/threat-model.md`) and `architecture/nfr.md`: each mitigation and
  mechanism in the stage's epics maps to a story, or is explicitly deferred with a reason.
- The repository layout (`delivery/repo-strategy.md`, `engineering/standards.md`), for realistic
  file paths.
- The Definition of Done profiles in `engineering/dod-profiles.yaml`; the profile ids there are the
  only valid `dod_profile` values. If the file is missing (a brownfield or L1 project may never have
  run project initialization), keep every story `draft`, use the configured default profile id, and
  ask the human to have the platform role create the file, since without it no story can pass the
  readiness check.

### What to produce

`Story` artifacts, and an update of each epic's `stories` list. Fill every field:

- `epic` and `capability`: the parent epic and its capability.
- `storyType`: feature, tech, spike, bug, chore or migration. A `tech` story states which capability
  it enables.
- `size`: S or M. A story you cannot make M or smaller is split, not sized L. An L story may exist
  only as a draft awaiting a split.
- `owner_role`: an agent role that exists in this project.
- `depends_on` and `blocked_by`: story ids, with `depends_on` forming no cycle. `blocked_by` is
  empty unless something outside the stage blocks it.
- `acceptance`: Given/When/Then criteria with ids `AC-###-#` (the story number, then a sequence),
  each with a `kind` (functional, error-handling, nfr, and so on) and, for an NFR criterion, the NFR
  id. Every criterion is independently testable and has a concrete expected value.
- `tests`: at least one test name per criterion, each beginning with its AC id and exactly one AC id
  (`AC-014-2 returns 422 for an empty invoice`). The test plan and the test author will use these
  names.
- `files_expected`: the production-code globs this story owns, as the implementer's ownership claim.
  They must not overlap any other story's claim. A shared file is owned by one story, and the others
  depend on it. The overlap check compares every story past `draft` across the whole project,
  including finished stories from earlier stages, and it ignores `depends_on`. Claim specific files
  or narrow globs, and when a story must change code that an earlier stage's story owns, keep it
  `draft` and raise the conflict with the human instead of overlapping. Do not list test files:
  tests are written by a separate role and are outside the implementer's claim, and the test plan
  names their paths.
- `context_refs`, `interfaces`, `data`: only ids that exist. Put the ids of the NFRs and ADRs the
  story must respect in `context_refs`. If an interface the story needs does not exist yet, leave
  `interfaces` empty and add a line to the body in the form
  `Needs interface: (operation), consumer (component)`, which the contract-freezing step reads. The
  `interfaces` field is back-filled once contracts are frozen.
- `dod_profile`: a profile id from `engineering/dod-profiles.yaml`; the project's configured default
  (`quality.dodProfileDefault`) if you have no better fit.
- Body: what the story delivers, from the user's point of view. For the first thin end-to-end slice
  of the first stage, state that it is the walking skeleton.

### Definition of Ready

The readiness check for a story reads four things: it has at least one acceptance criterion, a
non-empty `files_expected`, every `context_refs` id resolves, and no open question exists in the KB.
Separately, the gate rejects a story that is size L past draft and any acceptance criterion with no
bound test name. Set `status: ready` only when all of that holds. Otherwise keep the story `draft`,
name the gap in your closing message and raise it with the human or the owning role. Do not add an
`OpenQuestion` for it: an open question in the KB stops every story from being ready.

### Acceptance criteria

- Every epic's scope is covered by its stories, and each epic's `stories` list matches the stories
  that name it.
- Every NFR in the stage's subset is covered by a story whose acceptance criteria (`kind: nfr`) can
  verify it, or is explicitly left to a named later story.
- Given a story, a person could write a failing test from its criteria without asking a question.

### Do not

- Do not write implementation steps, class names or API designs beyond what an acceptance criterion
  needs.
- Do not write a criterion such as "the page is intuitive" or "works correctly".
- Do not bundle two behaviours into one criterion, or bind one test name to two criteria.
- Do not invent interface or data ids to satisfy a field.
