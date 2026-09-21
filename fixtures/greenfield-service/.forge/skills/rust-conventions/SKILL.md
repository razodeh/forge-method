---
# forge:generated v=0.0.0 hash=d9c731830456d3346c0139fd3bcfb12392c44404c63bc7ca371b23ecb452bbc8 — edits will be overwritten; use overrides/
id: rust-conventions
name: Rust stack conventions
version: 1.0.0
description: >
  Layout, error, logging and testing conventions for a Rust service or crate. Thin and generic by
  design -- an organisation's own overlay is the real source of truth once one exists.
when_to_use: >
  Any task that creates or modifies Rust source.
applies_to:
  agents: [backend, sre, reviewer, sdet]
  languages: [rust]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Layout

A workspace (`Cargo.toml` with `[workspace]`) once more than one crate exists, so `cargo build`/
`cargo test`/`cargo clippy` run once across all of them. `rust-toolchain.toml` pins the compiler
version; `Cargo.lock` committed for binaries (and for libraries where reproducibility matters more
than downstream flexibility).

## Errors

`thiserror` for library-facing typed errors, `anyhow` at binary/application boundaries where the
caller doesn't need to match on a specific variant. Never `.unwrap()`/`.expect()` on a value that
can genuinely be absent or an error in production code paths -- reserve them for cases a type or
invariant already makes impossible, and say so in a comment when it isn't obvious.

## Logging

`tracing` with structured fields, not `println!`. Spans carry `trace_id`, propagated across
`tokio::spawn` boundaries explicitly -- async task boundaries are exactly where trace context
silently drops if not carried forward deliberately.

## Testing

`cargo test`, `cargo nextest` for parallel/isolated test execution at scale. `proptest`/`quickcheck`
for property-based tests. `cargo clippy -- -D warnings` and `cargo fmt --check` as part of the
standard gate suite, not optional.

## Do not

- Do not use `unsafe` without a comment stating the specific invariant that makes it sound.
- Do not silently allow a `clippy` lint at the crate level without recording why in the same commit.
