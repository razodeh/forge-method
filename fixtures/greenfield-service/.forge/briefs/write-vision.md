<!-- forge:generated v=0.0.0 hash=4ac4a4c3fd3787b828d31040521516b1541fd09dae86c5b5f814ce4e1de45a20 — edits will be overwritten; use overrides/ -->
Write the product Vision: the single, stable statement of what this product is, for whom, and why,
that every Capability, Epic and Story will trace back to. Discovery has already passed `G-Problem`;
your job is to distil its findings, not to redo them.

### Inputs

- The discovery output in the KB `product/` section: `problem.md`, `users.md`, `scope.md` and
  `metrics.md`.
- The `Assumption` and `Risk` entries from discovery, and the KB constraints (`constraints/**`).

### What to produce

One `Vision` artifact (id `VIS-001`; there is exactly one per project). If a Vision already exists,
revise it: bump `revision`, add a `changelog` entry, and keep the id.

Fill each field from the inputs:

- `product`, `one_liner`: the name and one sentence saying what it is and who it is for.
- `problem`: the problem statement from `problem.md`, restated in one or two sentences; cite the KB
  entry id in the body.
- `target_users`: one entry per user group in `users.md`, named as its `persona:<slug>` id.
- `value_hypothesis`: why this problem, why now, why this approach, phrased so that evidence could
  disprove it.
- `success_metrics`: the `MET-###` metrics from `metrics.md`, copied with their `statement`,
  `baseline`, `target` and `instrumentation` unchanged.
- `non_goals`: the explicit non-goals from `scope.md`, each one a thing a reader might otherwise
  assume is included.
- `horizon`: the time horizon the constraints or the human gave.
- Body: one or two paragraphs on what the product is, who it is for and why it matters now. Keep the
  body stable across revisions, because it is the anchor other artifacts cite.

### Acceptance criteria

- The Vision validates against the Vision schema. Beyond the schema, it has at least one target
  user, one success metric and one non-goal.
- Every value in `success_metrics` and `target_users` exists in the discovery entries, with no
  additions or renamed ids.
- A reader who has seen no other artifact can say what the product does, for whom, and how success
  will be measured.
- Nothing in the Vision contradicts a constraint or a discovery non-goal.

### Do not

- Do not list features or capabilities. They come next, in `write-prd`.
- Do not name technologies, architectures or vendors.
- Do not improve the metrics or the scope on your own. If discovery is inconsistent or a required
  field has no source, report the conflict or ask the human instead of filling the gap.
- Do not write marketing copy. Prefer concrete nouns and measurable claims.
