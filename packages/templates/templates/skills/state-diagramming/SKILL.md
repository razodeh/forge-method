---
id: state-diagramming
name: State diagramming
version: 1.0.0
description: >
  When an entity's lifecycle needs a stateDiagram-v2 of its own, and how to draw one that actually
  names every transition's real trigger and guard.
when_to_use: >
  Any entity with more than two lifecycle states (F-DATA-1's own trigger: "a stateDiagram-v2 for
  every entity with more than two lifecycle states," 08 §8.11.3).
applies_to:
  agents: [data-architect, backend]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Two states needs no diagram; three does

An entity that is only ever `active`/`archived` does not need a state diagram -- prose suffices. The
moment a third state exists (soft-deleted, pending, expired, ...), the transition graph stops being
obvious from a sentence and needs to be drawn.

## Every edge names its real trigger

A transition arrow with no label answers nothing. Name the actual event or condition that causes it
("payment confirmed webhook received", not "moves to paid"), and note any guard that must hold for
the transition to be legal.

## Unreachable and dead-end states are real findings

A state with no incoming edge, or one with no outgoing edge that isn't a genuine terminal state, is
usually a modelling bug -- either a state that can never actually be reached, or a lifecycle that
has no way out of a non-terminal state. Both are worth catching at diagram-review time, not at
runtime.

## Do not

- Do not draw a soft-delete without a stated query policy for the deleted state -- `12` §12.1's own
  validation rule: every soft-delete needs a query policy (is a soft-deleted row visible to ordinary
  reads? to which callers?).
- Do not omit the terminal states -- a lifecycle diagram with no clear end state understates what
  the entity can actually do.
