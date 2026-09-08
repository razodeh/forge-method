---
id: go-conventions
name: Go stack conventions
version: 1.0.0
description: >
  Layout, error, logging and testing conventions for a Go service. Thin and generic by design -- an
  organisation's own overlay is the real source of truth once one exists.
when_to_use: >
  Any task that creates or modifies Go source.
applies_to:
  agents: [backend, sre, reviewer, sdet]
  languages: [go]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Layout

Standard `cmd/`/`internal/`/`pkg/` split -- `internal/` for anything not meant to be imported by
another module, `pkg/` only for genuinely reusable, stable exports. `go.mod`/`go.sum` committed;
`.tool-versions` or equivalent pins the toolchain version.

## Errors

Wrap with `%w` (`fmt.Errorf("doing X: %w", err)`) so `errors.Is`/`errors.As` still work up the call
stack -- never discard the original error's context with a bare `%s`/`%v`. Sentinel errors
(`var ErrNotFound = errors.New(...)`) for conditions callers are expected to check.

## Logging

Structured (`slog` or `zap`), one stable `event`/`msg` value, `trace_id`/`span_id` attached via
context propagation. Never `fmt.Println`/`log.Println` in service code.

## Testing

Table-driven tests as the default shape; `t.Parallel()` where tests are genuinely independent (never
where they share mutable state). `-race` in CI, always -- a Go concurrency bug that only reproduces
under the race detector is exactly the class of bug this flag exists to catch before it reaches
production.

## Do not

- Do not ignore an error return with `_` unless the reason it is genuinely safe to ignore is stated
  in a comment.
- Do not use a package-level mutable variable for anything that isn't genuinely process-lifetime
  global state -- it is usually a smuggled-in shared state bug waiting for `-race` to find it.
