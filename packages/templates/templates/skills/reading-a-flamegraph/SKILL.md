---
id: reading-a-flamegraph
name: Reading a flamegraph
version: 1.0.0
description: >
  How to read a CPU/wall-time flamegraph to find where a hot path actually spends its time, without
  mistaking a wide frame for a slow one.
when_to_use: >
  Investigating a performance NFR miss, or isolating a hot path during performance-benchmarking
  work.
applies_to:
  agents: [sre, backend, diagnostician]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Width is time, not call count

A wide frame means that function (plus everything it calls) consumed a large share of the sampled
time -- not that it was called many times. A function called once that blocks for 500ms and a
function called 10,000 times taking 50μs each can produce the same frame width; the flamegraph alone
does not tell them apart without also checking a count-based profile.

## Look at self time, not just total time

Total time (the frame's own width) includes everything the function calls. Self time (the part of
the frame not covered by any child frame) is what that function actually did itself. A wide frame
with almost all of its width covered by children is not the bottleneck -- one of its children is.

## Follow the widest unbroken stack down, not across

The bottleneck is usually found by descending the widest tower of frames to where self time actually
concentrates, not by comparing frames that sit at the same horizontal position but in different call
paths.

## Do not

- Do not optimise the first wide frame you see without checking whether its width is self time or
  inherited from children -- optimising the wrong frame wastes the fix attempt.
- Do not draw conclusions from a single sampled run under non-representative load -- profile under
  conditions that match the NFR's own stated scale.
