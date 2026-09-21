<!-- forge:generated v=0.0.0 hash=59647fcffb032bdef1cf43a3f8cf568c06f28f1a0f644c6d7e81cc84af8dfd5e — edits will be overwritten; use overrides/ -->
The stage has been delivered. Decide what its runtime must emit so that a person or an agent can
tell that it is healthy and diagnose it when it is not, and record what is missing today. The next
steps turn this plan into SLOs and runbooks, so the signals you name here are the ones they may rely
on.

### Inputs

- The ArchitectureSpec and components, interaction matrix and data flows it describes.
- `constraints/*` (operational constraints, support model, regulatory needs) and the stage's NFRs.
- The stage's capabilities and stories, for the user-visible flows and the business metrics they
  imply, and any existing observability KB entries (`ops/observability.md`) and the observability
  ADR, if one exists.
- The repository, read-only, to see what is already logged, measured and traced.

### Produce

One HandoffRecord with subtype `observability-plan`, `from: sre`, `to: sre`,
`step: instrument-observability → define-slos`. The record's front matter is strict, so use exactly
these keys and no others: `id` (`HO-` and four digits), `from`, `to`, `step`, `timestamp` (ISO 8601
date-time), `delivered`, `open_questions`, `assumptions` (each an object with `id` as `ASM-` and
three digits, `text`, `confidence` of `low`, `medium` or `high`, and `validate_by`),
`constraints_for_receiver` and `acceptance_for_receiver`. There is no `subtype` key: make the first
`delivered` entry `subtype: observability-plan`, which is how a reader recognises this record.
`delivered` holds the plan, one entry per component or flow (its signals, its gaps and the tasks
that close them), then one per planned alert or dashboard; `open_questions`, `assumptions` and
`acceptance_for_receiver` carry what the SLO and runbook steps need. The plan covers:

- **Logs:** structured JSON; the mandatory fields (`timestamp`, `level`, `service`, `env`,
  `version`, `trace_id`, `span_id`, `event`, plus domain ids); stable `event` names, not
  interpolated sentences; level meanings, with `error` reserved for what a human must act on.
- **Metrics:** RED per service and USE per resource, plus the business metrics the stage's
  capabilities define. Name each metric, its type, unit and labels, with a cardinality limit and no
  user ids or raw URLs as labels.
- **Traces:** context propagated across every boundary including queues and scheduled jobs; the
  sampling strategy, with errors always sampled; one correlation id from request to logs to
  downstream calls to spawned jobs.
- **PII:** an allowlist redaction policy at the logging boundary and how it is tested.
- **Debugging preconditions:** an error taxonomy with a code on every thrown error, the ability to
  retrieve the input that caused a failure (redacted), and a `debug:context <trace-id>` path.
- **Gap list:** for each component and flow, what exists today (with file evidence) and what is
  missing, each missing item written as a specific, story-sized task: component, signal, name,
  labels, where in the code.
- **Alerts and dashboards** the stage needs, listed as planned items with an id (`ALERT-<slug>` or
  `DASH-<slug>`), the signal they evaluate and the shape of the expression (a ratio, a quantile, a
  burn rate), with no numeric thresholds, which the SLO step sets. They are specified here; nothing
  in this workflow creates them, so later steps refer to them by these ids.
- The backend choice, cited from the existing ADR. If none exists, raise it as an open question for
  the owner rather than choosing silently.

### Acceptance criteria

- Every component and every user-facing flow in the architecture appears in the plan or is marked
  out of scope with a reason.
- Every async path names how trace context crosses it.
- Nothing you list as existing is unverified: cite the file.
- Signals are named precisely enough for the next step to define an SLI on them.

### Do not

- Do not edit application code or configuration in this step. Instrumentation work is planned here
  and implemented as stories.
- Do not define SLO targets or write runbooks; those are the next two steps.
- Do not choose a vendor without an ADR, or list a signal the system does not or will not emit.
