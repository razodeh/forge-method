---
# forge:generated v=0.0.0 hash=baae4dce1f59ff752388c79b6ac3ad8d72fe3507906abddf02ede4c91eedbe2d — edits will be overwritten; use overrides/
id: jvm-conventions
name: JVM (Java/Kotlin) stack conventions
version: 1.0.0
description: >
  Layout, error, logging and testing conventions for a JVM service written in Java or Kotlin. Thin
  and generic by design -- an organisation's own overlay is the real source of truth once one
  exists.
when_to_use: >
  Any task that creates or modifies Java/Kotlin source in a service module.
applies_to:
  agents: [backend, reviewer, sdet]
  languages: [java, kotlin]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Layout

Package-by-feature (`com.acme.billing.{api,domain,data}`), not package-by-layer
(`com.acme.controllers`, `com.acme.services`) once the codebase passes roughly 15 modules. Gradle
with the version catalog (`libs.versions.toml`) over ad-hoc version strings scattered across build
files.

## Errors

A checked-vs-unchecked exception policy stated explicitly, not left to convention drift -- most
FORGE projects prefer unchecked exceptions with a typed hierarchy plus a controller/handler boundary
mapper (`@ProblemDetail` or equivalent) rather than checked exceptions propagating through every
layer.

## Logging

Structured JSON via a logging facade (SLF4J + a JSON encoder), MDC-scoped `trace_id`/`span_id` for
the lifetime of a request, never string-concatenated log messages.

## Testing

JUnit 5, Testcontainers for real-dependency integration tests, `@Order`/`MethodOrderer.Random` (or
build-tool equivalent) so the suite runs in randomised order. ArchUnit (or an equivalent layering
enforcer) as the machine-checkable form of the package-by-feature convention above.

## Do not

- Do not catch `Exception` at a controller/handler boundary -- catch the specific exception types
  the boundary mapper actually needs to translate.
- Do not let a build file's own dependency versions drift from the version catalog "just this once."
