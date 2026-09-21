<!-- forge:generated v=0.0.0 hash=2a585c10d2359ebe74911d9bc5eb741bc68cad50f6f9a25c65a6b133efa4547b — edits will be overwritten; use overrides/ -->
Turn the stage's observable behaviour into service level objectives that the monitors and the
requirements agree on by construction. Each SLO is an NFR artifact with a measurable indicator and a
target, and each will drive an alert and a runbook.

### Inputs

- The observability plan from the previous step. An SLI may be defined only on a signal that plan
  names.
- The existing NFR set, the stage's capabilities and their `metrics`, and
  `constraints/operational.md` (support model, on-call reality). SLOs are derived from these, not
  invented beside them.
- The ArchitectureSpec, for dependency chains: a service cannot promise more than what it depends
  on.

### Produce

NFR artifacts, one per SLO (usually availability and latency per user-facing flow, plus freshness or
correctness where the product has them; use the closest category the schema allows). Fill the schema
exactly, with every key it requires (`id`, `type`, `schemaVersion`, `title`, `status`, `created`,
`updated`, `revision`, `author` and `changelog`, then `category`, `statement`, `metric`, `target`,
`verification`, `applies_to`):

- `category`: `availability`, `performance` or `operability` as fits.
- `metric`: the SLI written as a measurable ratio or quantile from the user's perspective, for
  example the fraction of successful requests, or p95 and p99 latency, naming the signal from the
  plan.
- `target`: numeric, starting with the number or a comparator (`99.9%`, `< 300ms`). Put the
  measurement window (for example a rolling 30 days) in `conditions`, and in `statement` what must
  hold and under what conditions.
- `verification`: `kind: monitor`, `ref` the id of the planned alert or dashboard (from the
  observability plan, or one you add to the SLO body as a planned item with its expression and
  window) that evaluates it. Nothing in this workflow creates monitors, so they are specified, not
  claimed to exist.
- `applies_to`: the capabilities or components covered.
- The body states why this target, the error budget it implies, the burn-rate alert policy (fast and
  slow windows, what pages and what only opens a ticket), and the runbook the alert will link, named
  by its failure mode so the next step writes it.

### Acceptance criteria

- Every SLI is measurable from a signal in the observability plan, and each SLO has an alert defined
  on budget burn rate, not on a raw threshold.
- Every target traces to an NFR, a capability metric, a constraint or a recorded assumption. Where
  none exists, record `FORGE_ASSUME:` with confidence and how to validate it.
- Targets are achievable given the dependencies' own limits and the stated support model, and never
  100%.
- Paging is reserved for user-impacting conditions; everything else is a ticket or a dashboard.
- Each SLO names the failure mode whose runbook it links.

### Do not

- Do not create an SLO with no indicator, no alert, or no way to verify it.
- Do not contradict an existing NFR. If a target conflicts with one, record the conflict
  (`FORGE_CONFLICT:`); the NFR's owner changes it.
- Do not write the runbooks here.
