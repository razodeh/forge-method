---
id: api-reference-writing
name: API reference writing
version: 1.0.0
description: >
  How to document a public API endpoint or exported function so a consumer can use it correctly
  without reading the implementation.
when_to_use: >
  Documenting any endpoint or exported symbol a consumer outside the immediate module is expected to
  call -- required per 13 §13.3's own Documentation review perspective ("Public API documented").
applies_to:
  agents: [techwriter, backend, integration-architect]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## State the contract, not the implementation

What does this accept, what does it return, and under what conditions does it fail -- not how it is
implemented internally. A reference that describes internals goes stale the moment the
implementation changes; a reference that describes the contract stays correct as long as the
contract does.

## Every error path is part of the reference, not an afterthought

Every documented error response/exception, with the condition that triggers it. An API reference
that only documents the success path leaves the consumer to discover failure modes at runtime --
exactly what a contract test and its accompanying reference both exist to prevent.

## Show a real example, not a placeholder

A request/response example with real, plausible field values -- not `"foo": "bar"`. `08` §8.11.7's
own placeholder-word rule applies to reference examples in spirit even where it isn't mechanically
checked: a placeholder example teaches nothing about real usage.

## Do not

- Do not document a parameter's type without documenting its constraints (range, format, required vs
  optional) -- "a string" is not a contract.
- Do not let the reference and the actual signature drift -- if the API changed and the reference
  wasn't updated in the same change, that is a review finding, not a follow-up task.
