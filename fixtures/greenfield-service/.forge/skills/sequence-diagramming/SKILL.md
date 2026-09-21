---
# forge:generated v=0.0.0 hash=8587ffa706062c369e5931ba1a533ecd7d7c103377a03a117fc7ce0c286f7283 — edits will be overwritten; use overrides/
id: sequence-diagramming
name: Sequence diagramming (failure paths, not just the happy path)
version: 1.0.0
description: >
  How to draw a sequenceDiagram that actually shows what happens when a call fails, times out, or
  retries -- not only the case where everything succeeds.
when_to_use: >
  F-ARCH-3's own rule: every interaction-matrix row with two or more hops, and every async path,
  needs a sequence diagram covering the failure path.
applies_to:
  agents: [architect, integration-architect]
activation: auto
budget_tokens: 1000
forge_version: '>=1.0 <2'
---

## The happy path is the easy half

A `sequenceDiagram` that only shows the success case answers "what does this do when it works,"
which is rarely the question that matters during an incident. `11` §11.2's own rule is explicit:
cover timeouts, retries, and DLQ routing, not just the happy path.

## What a real failure-path diagram shows

Where the timeout fires and what it's set to; what retries and how many times, with what backoff;
what happens to the message/request when retries are exhausted (dead-letter queue, error response,
silent drop -- state which); and what the caller observes at each of those points, not just at the
end.

## Async paths need this even when nothing is "wrong" yet

An async, fire-and-forget call still needs its failure path shown: what happens if the consumer
never processes the message? `11` §11.2's own communication-patterns rule requires a declared
retry/DLQ/ idempotency design for every async path, and the sequence diagram is where that design
becomes visible rather than implicit.

## Do not

- Do not draw a sequence diagram with only the success lifeline and a comment saying "errors handled
  similarly" -- that is exactly the missing failure path this skill exists to prevent.
- Do not omit the actual timeout/retry numbers from the diagram's own caption or annotations -- a
  diagram that shows retries happen but not how many is not verifiable against the real config.
