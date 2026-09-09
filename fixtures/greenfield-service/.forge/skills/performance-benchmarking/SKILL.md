---
# forge:generated v=1 hash=6686d05544fa0fcc6e95e51e1837322b6c8cf3982310d94342bfb58b66cfad03 — edits will be overwritten; use overrides/
id: performance-benchmarking
name: Performance benchmarking
version: 1.0.0
description: >
  How to write a benchmark that actually proves an NFR's numeric target holds, run out-of-band from
  the fast feedback loop.
when_to_use: >
  Verifying a `must` NFR with a numeric performance target (13 §13.1's own NFR test layer), or
  producing the "benchmark test with the NFR's numbers" F-ARCH-5 asks for.
applies_to:
  agents: [test-architect, backend, sre]
activation: auto
budget_tokens: 900
forge_version: '>=1.0 <2'
---

## Benchmark against the NFR's own number, not a vibe

An NFR reads "p99 latency under 200ms at 500 req/s" or it is not a real NFR (`01`'s own numeric-NFR
requirement). The benchmark's own pass/fail threshold is that number, not "seems fast enough
locally."

## Isolate what you are actually measuring

Warm up before measuring (JIT, connection pools, caches). Pin the environment (dedicated, not shared
with other CI jobs contending for CPU). Report percentiles, not just the mean -- a mean that hides a
long tail is exactly what a p99-based NFR exists to catch.

## Where it runs

`13` §13.1's own pyramid table: NFR benchmarks are out-of-band, nightly, in a dedicated environment
-- never blocking the fast PR feedback loop. A benchmark that runs on every commit either gets
skipped under time pressure or slows the loop everyone depends on; neither is acceptable.

## Do not

- Do not report a single run's number as the result -- benchmark noise is real; report a
  distribution across multiple runs.
- Do not benchmark against a target with no NFR behind it -- that produces a number with no
  pass/fail meaning.
