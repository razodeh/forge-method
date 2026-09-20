An alert with no runbook will be flagged at the operate gate, and a runbook that says "investigate
the database" is not one. Write the runbooks an on-call person, or an agent, can execute under
pressure at three in the morning.

### Inputs

- The SLOs from the previous step and the failure modes they name, and the observability plan (which
  signals, dashboards and log fields exist to diagnose with).
- The failure analysis: the ArchitectureSpec's component failure modes, the threat model, the risk
  register, and prior Defects and RCAs, which show how the system has really failed.
- The repository, read-only, and the delivery KB (`delivery/pipeline.md`, `ops/**`) for the
  commands, tools, environments and access that actually exist.
- `constraints/operational.md` for the real support and escalation model, including "there is no
  on-call".

### Produce

Runbook artifacts, one per Sev1 failure mode, with every key the strict schema requires (`id`,
`type`, `schemaVersion`, `title`, `status`, `created`, `updated`, `revision`, `author` and
`changelog`, then `symptoms`, `immediate_mitigation`, `diagnosis_steps`, `escalation`,
`post_incident_actions`) filled and concrete:

- `title`: the failure mode, worded as it is in its source (SLO, threat, component analysis), so a
  reader can tie each runbook back to the failure mode it covers.
- `symptoms`: how it presents, naming the alert (by its id from the SLO or observability plan) and
  the log event or metric that shows it. Where the alert or dashboard is still only planned, say so;
  do not describe it as existing.
- `immediate_mitigation`: the first action that limits damage (fail over, disable a flag, roll back,
  shed load), with the exact command or control and how to confirm it worked.
- `diagnosis_steps`: an ordered list where every entry is an exact command or query with the
  expected output that separates one cause from another. No step says "investigate" or "check the
  logs" without saying which log, which filter and what to look for.
- `escalation`: who is contacted, when, and how, stated honestly for this project's real support
  model.
- `post_incident_actions`: what to record and what prevention to consider afterwards, including the
  RCA and any observability that was missing.
- Include a data-loss or corruption runbook, with a restore procedure and the command that would
  test it (you cannot run it), when the system has datastores; and secret rotation and compromise
  handling when it holds credentials.

### Acceptance criteria

- Every Sev1 failure mode you can derive from the sources above has a runbook, and every SLO alert
  points at one.
- Every command exists in this project: you found it in the repository, the pipeline, the KB or a
  documented tool. Where you could not find one, record an open question instead of inventing a
  name, host or dashboard.
- Each runbook can be followed without other context than the runbook and the tools it names.
- Runbooks for different failure modes are not copies of one another.

### Do not

- Do not write runbooks for failures the architecture cannot have, to pad coverage.
- Do not invent CLI commands, URLs, dashboard names or on-call rotations.
- Do not change alerts, SLOs or code. If an alert is wrong, hand it back.
