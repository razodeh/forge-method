<!-- forge:generated v=0.0.0 hash=b86d5bfc921d1091bbb8dfa40e3f1e5513bdbb615bd9e29ac8a0eb0705667f7b — edits will be overwritten; use overrides/ -->
The stage is over. This retrospective is the only mechanism by which the process improves itself,
and it must end in changes with owners, not observations. You have real data; use it instead of
recollection.

### Inputs

- The stage's measured data as it reaches your context or the reports: cost per story, gate failure
  rates and which checks failed, the rework ratio, review findings by perspective, flaky-test
  trends, time to diagnose defects, and how the estimates compared with the actuals.
- The stage plan, the risk register, the stage's defects and RCAs, and prior retros' actions (were
  they done, did they help).
- The KB's `engineering/ways-of-working.md`, which this retro's outputs feed.

If a measure you need is not available to you, request it (`FORGE_REQUEST_CONTEXT:`) or record it as
unavailable. Never estimate a number.

### Produce

One SessionRecord with `sessionType` set to `retro` (the workflow calls it the retrospective),
containing all the required sections in order: Frame, Diverge, Converge, Decisions, Non-decisions,
Actions, KB write-back. Fill the front matter, which is strict and requires `id`, `type`,
`schemaVersion`, `title`, `status`, `created`, `updated`, `revision`, `author` and `changelog` as
well as `sessionType`, `technique`, `question`, `constraints_applied`, `participants`, `started`,
`ended` and `cost_usd`: `question` (what this retro set out to learn), `technique` (use
`data-driven` and `timeline-review`, add `five-whys` for a costly incident), `participants` (only
who actually took part; if that is you alone, set `no_disagreement_observed: true`),
`constraints_applied` (the constraints the retro ran under, or an empty list), and `started`,
`ended` and `cost_usd` taken from the run record in your context. If they are not available, request
them (`FORGE_REQUEST_CONTEXT:`); if they still are not, use the stage boundary timestamps and set
`cost_usd` to 0, and say in Frame that 0 marks unavailable data, not a measured cost. If even those
are unavailable, ask (`FORGE_ASK:`) rather than guess. Do not estimate any of them.

- **Frame:** the stage, the period and the data you had.
- **Diverge:** what the data shows, good and bad, each observation with the number and where it came
  from. Include the surprises: where cost, rework or failures concentrated.
- **Converge:** the few causes that explain most of it, reached with five-whys where warranted, each
  cause evidenced.
- **Decisions:** each change to the process, each with the artifact it lands in (an ADR, an overlay
  change, a standards entry, a gate threshold).
- **Non-decisions:** what you deliberately left open, why, and the trigger that should reopen it.
- **Actions:** each with a named owner role and a due point (the next stage boundary or a date).
- **KB write-back:** the exact KB entries to add or change (paths and the content to record), each
  traced to a decision. These are proposals for their owners to apply: your role may write only
  `delivery/sequencing/**`, and the `forge kb sync` step that follows re-indexes the KB, it does not
  apply your entries.

### Acceptance criteria

- Every number in the record comes from the data, with its source.
- Every decision references an artifact and every action has an owner. A retro with no decisions and
  no actions is recorded with `status: inconclusive` and the reason, which is honest and acceptable.
- The previous retro's actions are reviewed: done, dropped with reason, or carried over.
- Nothing is a vague intention ("communicate more"): each decision names what changes and how it
  will be checked next time.

### Do not

- Do not assign blame to a role or an agent; find the process cause.
- Do not write to the KB beyond your own sequencing path; everything else is a proposal in the
  write-back section.
- Do not invent participants' opinions or a disagreement that did not happen.
