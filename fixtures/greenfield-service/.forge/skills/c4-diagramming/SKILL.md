---
# forge:generated v=1 hash=841e72b3805327866d23fcc572ec5435dcb03dcfe8334de056091c5cefcbff67 — edits will be overwritten; use overrides/
id: c4-diagramming
name: C4 diagramming
version: 1.0.0
description: >
  How to produce C4Context/C4Container/C4Component views that stay generated from the real component
  inventory, not hand-drawn and free to drift.
when_to_use: >
  F-ARCH-2's own decomposition output (architecture/components.md + C4 views), or any G-Design check
  requiring C4 context/container coverage.
applies_to:
  agents: [architect]
activation: auto
budget_tokens: 1000
forge_version: '>=1.0 <2'
---

## Generate, don't hand-draw

`08` §8.11.6's own rule, enforced by the `components-to-c4` generator: C4 views are produced _from_
the component inventory (`architecture/components.md`), never authored independently of it. A
hand-drawn C4 diagram is exactly the kind of content `diagram:staleness`/drift checking exists to
catch -- `generated: true` with a real `generator` field is what makes
`forge diagram generate --all --check` able to detect when the diagram has fallen out of sync with
the inventory it claims to depict.

## Which level, which audience

**Context** (C4Context): the system and its external actors/systems, no internals -- for anyone who
needs to know what this system talks to. **Container** (C4Container): the deployable units inside
the system boundary -- for anyone deciding where a change lands. **Component** (C4Component): inside
one container -- only for the team that owns it; do not produce a component diagram for every
container by default, only where the internal structure is not obvious from the code.

## Every box is a real thing

The same `diagram:label-quality`/`diagram:refs` rules from `mermaid-authoring` apply here: a
container box named `Service2` or a `depicts` reference to a component id that does not exist in the
inventory both fail lint.

## Do not

- Do not skip the context diagram because "everyone already knows how this system fits in" --
  `G-Design` requires C4 context/container coverage explicitly, not on a case-by-case judgement
  call.
- Do not let a container diagram silently omit a real deployable unit -- an incomplete container
  diagram is worse than a coarse one, since it implies completeness it does not have.
