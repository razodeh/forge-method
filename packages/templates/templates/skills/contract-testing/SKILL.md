---
id: contract-testing
name: Contract testing
version: 1.0.0
description: >
  How to write a contract test that actually proves two sides of an interface agree, without a live
  counterparty in the test run.
when_to_use: >
  Any interaction that crosses a service boundary, an `INT-###` consumer/provider pair, or a mocked
  third-party HTTP API (13 §13.1's own "mocks are permitted only at process boundaries you do not
  own" rule).
applies_to:
  agents: [integration-architect, backend, sdet]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## What a contract test actually proves

Not "my code calls this endpoint correctly in isolation" -- that a real request built by the
consumer matches what the provider actually accepts, and a real response from the provider matches
what the consumer actually expects. One test per `INT-###` consumer/provider pair, run against a
recorded or verified schema, with no live counterparty needed at test time.

## Where mocks are legitimate

`13` §13.1: mocking your own database or a service you own means testing your mental model of it,
not the real thing -- not allowed. A mock is legitimate only at a process boundary you do not own (a
third-party HTTP API, a payment provider, email) -- and even then it needs a contract test against a
recorded/verified schema alongside it, not instead of it.

## Keep the schema honest

A contract test against a schema no one re-verifies against the real provider drifts silently. Pin
the schema's own source (an OpenAPI spec, a Pact broker, a recorded fixture) and re-verify it on a
cadence, not once at authoring time.

## Do not

- Do not write a contract test that only exercises the happy path -- version skew and error-shape
  disagreement are exactly what this test class exists to catch.
- Do not let "we don't own the provider so we can't test against it" become an excuse to skip the
  contract test entirely -- record/replay fixtures exist for exactly this case.
