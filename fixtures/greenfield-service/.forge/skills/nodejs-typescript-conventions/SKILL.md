---
# forge:generated v=1 hash=7402f02cc66776bb77980b0dcb0dc9909078db550d2c903d53e2bc3a6ec6cc0b — edits will be overwritten; use overrides/
id: nodejs-typescript-conventions
name: Node/TypeScript stack conventions
version: 1.0.0
description: >
  Layout, error, logging and testing conventions for a Node/TypeScript service or package. Thin and
  generic by design -- an organisation's own overlay is the real source of truth once one exists.
when_to_use: >
  Any task that creates or modifies TypeScript/JavaScript source in a Node.js runtime module.
applies_to:
  agents: [backend, frontend, reviewer, sdet]
  languages: [typescript, javascript]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Layout

Feature/domain-first (`src/billing/{api,domain,data,tests}`) over layer-first once the codebase
passes roughly 15 modules (`11` §11.1's own F-INIT-2 default). Colocate a module's tests with its
source unless the project's own build-toolchain decision says otherwise.

## Errors

Throw typed errors (a class hierarchy or a discriminated-union `Result`), never a bare
`throw new Error(string)` for anything a caller is expected to handle. Every error that crosses a
module boundary carries a stable code, per the project's own error taxonomy.

## Logging

Structured JSON, one `event` field naming a stable event name -- never an interpolated sentence
(`14` §14.5's own rule: interpolated log messages are ungroupable). Include `trace_id`/`span_id` on
every log line inside a request or job context.

## Testing

`vitest`/`jest` with real dependencies for integration tests (testcontainers, not mocks of your own
database). One command per layer (`test:unit`, `test:integration`, ...), machine-readable output.

## Do not

- Do not use `any` to silence a type error -- narrow the type or state explicitly why the escape
  hatch is needed.
- Do not catch an error only to re-throw a less specific one -- that destroys the diagnostic value
  the original error carried.
