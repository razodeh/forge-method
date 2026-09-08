---
id: mermaid-authoring
name: Mermaid authoring
version: 1.0.0
description: >
  How to author a Mermaid diagram that passes @forge/diagrams' own real lint checks -- real labels,
  a real caption, and no orphan nodes -- not just valid Mermaid syntax.
when_to_use: >
  Authoring or editing any diagram whose `notation` is `mermaid` (one of the five notations
  `diagramSchema`/`08` §8.11.2 support).
applies_to:
  agents: [architect, data-architect, sre]
activation: auto
budget_tokens: 1100
forge_version: '>=1.0 <2'
---

## Every node needs a real label

`diagram:label-quality` rejects empty, single-letter, and placeholder labels -- `foo`/`bar`/`baz`/
`tbd`/`xxx`/`lorem`/`placeholder`/`dummy` (any case), `TODO`/`FIXME` (shouting case only), and a
generic noun immediately followed by a digit (`Component1`, `Node_2`, `Item-3`). Name the real
thing: `InvoiceService`, not `Service1`.

## Every node needs an edge

`diagram:orphan-nodes` flags a node with no incident edge in any diagram that has at least one edge
at all -- almost always a typo in a node id, or a node that was drawn but never actually wired into
the flow it claims to depict.

## Caption and alt_text are both required, and both must actually say something

`diagram:caption` rejects a caption or alt_text that is a single word -- `"TopologyDiagram"` is not
a caption. Write one real sentence explaining what the diagram shows and why it matters.

## Keep it within budget

`diagram:complexity`: over the node/edge budget warns; at or past the hard maximum errors. Split
into layered views (a context diagram plus a container diagram, say) rather than one diagram trying
to show everything.

## Do not

- Do not set `generated: true` without naming a real `generator` -- `diagramSchema` itself rejects
  that combination, since a diagram claiming to be machine-produced with no named generator can
  never be regenerated to check for drift.
- Do not reference an id in `depicts` that does not resolve to a real
  component/datastore/entity/actor -- `diagram:refs` flags it.
