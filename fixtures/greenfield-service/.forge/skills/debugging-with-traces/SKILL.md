---
# forge:generated v=1 hash=b3e2d14890b744c77ae6a0e88dbad6b8b13487d4d21dfa810bd609c15e933158 — edits will be overwritten; use overrides/
id: debugging-with-traces
name: Debugging with traces
version: 1.0.0
description: >
  How to use a distributed trace to isolate a fault domain during an RCA, instead of guessing from
  logs alone.
when_to_use: >
  The ISOLATE step of the RCA loop (running-an-rca), when the symptom crosses a service or async
  boundary.
applies_to:
  agents: [diagnostician, sre]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Start from the trace id, not the log search

`13` §13.2 F-DEBUG-3's own `debug:context <trace-id>` command assembles logs, traces and relevant
state for one request in one place -- start there, not with a free-text log search that may or may
not actually cover the failing request.

## Read the span tree for where time and errors concentrate

The failing span is not always the one that raised the visible error -- a downstream span's latency
or error can surface as a symptom several hops upstream. Walk the tree from the root span down, and
note where the error status or the latency outlier actually first appears.

## Async boundaries are where trace context most often silently breaks

A queue message or a scheduled job that doesn't carry trace context forward produces a trace that
just stops -- the investigation then has no way to connect the async side effect back to the request
that caused it. If a trace ends abruptly at a queue publish, that gap is itself a finding (a missing
observability precondition, per `debugging-observability-precondition`), not a dead end to work
around.

## Do not

- Do not treat "the trace looks fine" as proof the bug isn't there -- a trace only shows what was
  instrumented; missing instrumentation is itself informative (feed it to PREVENT).
- Do not skip straight to log grepping when a trace id is available -- the trace gives you the
  actual causal chain across services; a log search across services does not.
