<!-- forge:generated v=0.0.0 hash=a455437ce9ed60caa3ac25d6137e268e4fc935503521d99d5931de05e78555b8 — edits will be overwritten; use overrides/ -->
The reverse-derived architecture and data model now exist. Turn them, together with what the
deterministic phases measured, into a gap analysis that makes adoption immediately useful: what is
unknown, unverified, unsafe or missing, ranked so someone can plan remediation instead of admiring
the list.

### Inputs

- The retroactive ADRs and DataModel from the previous step, with their evidence and confidence
  ratings, and the deterministic gap findings in `reports/adoption/gaps.md` and the baseline
  measures if they exist. Extend and rank those; do not contradict them without evidence.
- The adoption reports that exist under `reports/adoption/` (survey, inventory, and the verification
  results: whether the documented build command works from a clean clone, whether the tests pass,
  measured coverage). Build and test failures are findings, not blockers: record them as measured.
  If a report you need (verification results, `gaps.md`, baseline) is absent, say so as an open
  question; do not reconstruct it.
- The KB's `constraints/*` and any existing risks and open questions.
- The repository, read-only, when you need to confirm a signal before you rate it.

### Produce

One HandoffRecord with subtype `adoption-gap-analysis`, `from: analyst`, `to: pm` (who owns scope
and will turn the gaps into planned work), `step: gap-analysis`. The record's front matter is
strict, so use exactly these keys and no others: `id` (`HO-` and four digits), `from`, `to`, `step`,
`timestamp` (ISO 8601 date-time), `delivered`, `open_questions`, `assumptions` (each an object with
`id` as `ASM-` and three digits, `text`, `confidence` of `low`, `medium` or `high`, and
`validate_by`), `constraints_for_receiver` and `acceptance_for_receiver`. There is no `subtype` key:
make the first `delivered` entry `subtype: adoption-gap-analysis`, which is how a reader recognises
this record.

- `delivered`: one entry per gap, in the form
  `GAP-<n> [<class> | <severity>] <finding> | evidence: <path, report or ADR id> | remediation: <a story-sized action, or "needs human decision">`.
  Gap ids are local to this record. After the subtype entry, list safety gaps first. For a class
  with no gaps, add one entry `class <name>: no gaps; checked <what>`. The classes are: knowledge
  (unexplained components, dead-code candidates, undocumented magic values, unknown data ownership),
  verification (no tests on critical paths, no e2e, unmeasured NFRs, no contract tests at
  integration points), delivery (no reproducible build, manual deploy steps, no rollback, missing
  environments), operability (no structured logging, tracing, alerts or runbooks), safety (secrets
  in the repository, shared-write tables, unbounded queries, missing authorisation on routes,
  destructive migrations) and consistency (convention or layering violations, dependency cycles).
- `open_questions`: every claim from the reverse-derivation that stayed at `low` confidence and
  matters, phrased as a question a human can answer in one sentence, ranked by impact times
  uncertainty.
- `assumptions`: each with confidence and how it would be validated.
- `constraints_for_receiver` and `acceptance_for_receiver`: what the planner must respect (for
  example "conventions stay as observed; a convention change needs its own ADR") and what a finished
  remediation plan must show.

### Acceptance criteria

- Every gap has a class, a severity (`critical`, `high`, `medium` or `low`, the scale
  `reports/adoption/gaps.md` uses; user or data harm first), evidence you can point at, and a next
  action. A gap with no evidence is an open question, not a gap.
- All six classes are addressed. A class with no gaps says what you checked to conclude that.
- Safety gaps are listed first and never rated below the impact the evidence shows.
- Verification gaps cover every critical path the inventory identified (routes, jobs, data writers),
  and say which have no test.
- The measured baseline numbers you cite (build result, test count and pass rate, coverage,
  dependency count, cycles) are the ones the reports contain, quoted exactly.

### Do not

- Do not reproduce secret values when citing evidence; cite the path and line only.
- Do not fix anything or edit the reverse-derived ADRs and DataModel; if one is wrong, hand it back
  with the evidence.
- Do not soften a failed build or failing tests into a note. Report them as measured.
- Do not invent severity to look thorough, or pad the list: fewer evidenced gaps beat many guessed
  ones.
