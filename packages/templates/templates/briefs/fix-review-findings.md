A swarm review of your own change came back blocked. This round's blocking findings are listed
below, each with the perspective that raised it. Fix the cause of every one, in the lane you already
wrote your change to -- you are continuing the same diff, not starting a new one.

### Inputs

- The blocking findings below: what each perspective found, and what it checked. Read every one
  before changing anything.
- The lane's own current state (`git diff`/`git log` against its own base if you need the fuller
  picture) and the project standards in your context.

### Produce

The smallest change that removes the cause of every blocking finding listed below, still inside the
story's own file claim. A finding that is really a difference of opinion, not a defect, is not yours
to silently drop: say so plainly in your final answer, naming which finding and why, rather than
leaving it unaddressed with no explanation.

### Acceptance

- Every blocking finding below has either a real code change that removes its cause, or an explicit,
  reasoned objection in your final answer.
- No new behaviour, scope, or refactor beyond what the findings actually require: this is a fix
  round, not another pass at the whole diff.
- The story's own tests (and any test the findings themselves call for) still pass.

### Do not

- Do not mask a finding: widening a `catch`, loosening or deleting an assertion, adding a sleep or
  retry to hide a race, or a null check that hides an invalid state arising upstream are all refused
  on the next review, not accepted here.
- Do not touch code the findings do not name.
- Do not mark a finding resolved without a change or a stated, reasoned objection to it.

### This round's blocking findings
