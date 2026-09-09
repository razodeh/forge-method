---
# forge:generated v=1 hash=ff7fb40ddd21bf86c99ba130cc6d13a50a4933fa1a1d58c7278703d24a06cc34 — edits will be overwritten; use overrides/
id: python-conventions
name: Python stack conventions
version: 1.0.0
description: >
  Layout, error, logging and testing conventions for a Python service or package. Thin and generic
  by design -- an organisation's own overlay is the real source of truth once one exists.
when_to_use: >
  Any task that creates or modifies Python source.
applies_to:
  agents: [backend, data-engineer, ml-engineer, reviewer, sdet]
  languages: [python]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Layout

`src/` layout (not a flat package at repo root) so the installed package and the working tree can
never silently diverge. `uv`/`poetry` with a committed lockfile; `hatch`/`tox` for multi-environment
test matrices.

## Errors

A real exception hierarchy rooted in one project-specific base exception, never bare `except:`
(catches `SystemExit`/`KeyboardInterrupt` too) and never `except Exception: pass`. Type-annotate
function signatures; a caller should be able to tell what a function can raise from its own
annotations plus docstring, not by reading the implementation.

## Logging

Structured (`structlog` or stdlib `logging` with a JSON formatter), one `event` field naming a
stable event name, never an f-string built into the message before logging. Bind
`trace_id`/`span_id` into the logger's own context at request/job entry, not per call site.

## Testing

`pytest`, real dependencies for integration tests, `pytest-randomly` (or equivalent) to run in
randomised order per `13` §13.1's own no-order-dependence rule. Property-based tests via
`hypothesis` where a domain invariant, not a specific example, is what needs proving.

## Do not

- Do not use mutable default arguments (`def f(x=[])`) -- a classic footgun a coding agent will
  otherwise reintroduce.
- Do not silently swallow an exception to "keep going" -- log it with full context or let it
  propagate.
