Define how this product's success will be measured, and turn the quality targets those measures
imply into verifiable non-functional requirements. The `G-Problem` gate fails if there is no
measurable success metric, so at least one metric must have a numeric target and a way to collect
it.

### Inputs

- The problem framing from `frame-problem`: `product/problem.md`, `users.md`, `scope.md`, and the
  `Assumption` and `Risk` entries it recorded.
- The KB constraints (`constraints/**`), especially operational and business constraints that
  already state a number (a budget, an availability need, a deadline).

### What to produce

1. Success metrics, recorded in the KB metrics entry (`product/metrics.md`; if that path is outside
   your write scope, submit it as a KB proposal). Give each metric an id (`MET-###`, numbered
   sequentially in that file and never reused) and these fields: `statement` (the measured quantity
   and its window or cohort, for example "at day 30 after signup"), `baseline` (a number, or
   `unknown` plus how the baseline will be established), `target` (numeric, with the comparison and
   unit), and `instrumentation` (the concrete event, log or query that yields it). The
   `write-vision` step copies these into the Vision, so write them in final form.
2. `NFR` artifacts for the system-quality constraints the metrics and the problem framing imply:
   performance, availability, cost ceilings, privacy, accessibility, compliance and so on. Outcome
   metrics such as activation or retention stay in the metrics entry and are not NFRs.

### NFR rules

- `category` is one of performance, availability, scalability, security, privacy, maintainability,
  operability, cost, accessibility, compliance.
- `target` must begin with a number, optionally preceded by a comparison operator: `< 300ms`,
  `>= 99.5%`. A value such as `p95 under 300ms` or `fast` is rejected by the schema. Put the
  percentile and load in `metric` and `conditions`. A standard that is categorical (an accessibility
  level, a compliance regime) is encoded as a count against it, for example target `0` open
  violations, with the named standard in `conditions`.
- `verification` names how the target will be checked (`test`, `benchmark`, `monitor`, `review` or
  `audit`) and a descriptive `ref` (for example `benchmark: invoice-list-p95`). The stage test plan
  later allocates the concrete test and ties it to the NFR, so do not invent a test id.
- `applies_to` stays empty at this point (component ids do not exist yet). The link between an NFR
  and the capabilities it governs is the capability's `nfrs` list, which the product step sets.

### Acceptance criteria

- Every success metric has a statement, a baseline, a numeric target and an instrumentation source.
- Every NFR has a numeric target and a verification method, so a check for numeric NFR targets
  passes at the product gate.
- Every metric traces to a problem or user need in `problem.md` or `users.md`, cited by entry id.
- A number you chose yourself, rather than read from the inputs, is recorded as an `Assumption` (low
  confidence, with `validate_by`). The metric or NFR statement says "proposed target", and an NFR
  built on it stays at `status: draft`.
- If no reasonable basis for a number exists, raise the question with the human instead of guessing.

### Do not

- Do not use vanity metrics (page views, lines shipped) unless the inputs make them the real goal.
- Do not copy targets from other products. A target needs a basis in this project's inputs or a
  stated assumption.
- Do not write capabilities, stories or solution requirements. This step measures outcomes only.
