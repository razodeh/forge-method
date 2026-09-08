---
id: writing-a-runbook
name: Writing a runbook
version: 1.0.0
description: >
  How to write a runbook an agent (not only a human) can actually execute during an incident --
  concrete commands, not investigative prose.
when_to_use: >
  A Sev1 failure mode is identified during threat modelling, NFR strategy, or operational readiness
  work and needs a runbook before G-Operate.
applies_to:
  agents: [sre, diagnostician]
activation: auto
budget_tokens: 1000
forge_version: '>=1.0 <2'
---

## Commands, not investigation prompts

"Investigate the database" is not a runbook step. `forge debug:context <trace-id>` or
`kubectl logs -l app=billing --since=10m | grep ERROR` is. `14` §14.5's own rule: runbooks are
written to be executable by an agent as well as a human, which means every step is a concrete,
copy-pasteable command with its expected output stated.

## Required sections

Symptoms (how this failure mode actually presents, in logs/alerts/user reports) -> immediate
mitigation (the fastest safe stop-the-bleeding action) -> diagnosis steps (exact commands, in order)
-> escalation (who/what, and the condition that triggers it) -> post-incident actions.

## Link it, don't just write it

`14` §14.5's own rule: every alert must link to a runbook, or it gets deleted or downgraded at
`G-Operate`. A runbook that exists but is not linked from the alert that would need it does not
exist in practice.

## Do not

- Do not write a mitigation step that requires interactive judgement with no decision criteria
  stated ("restart the service if it seems unhealthy") -- state the concrete signal.
- Do not let a runbook go stale silently -- if the commands it names no longer exist, that is a
  defect against the runbook, not a documentation nice-to-have.
