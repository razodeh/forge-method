---
id: threat-modelling-stride
name: Threat modelling with STRIDE
version: 1.0.0
description: >
  How to run a STRIDE pass per component boundary and produce a ThreatModel that names a real
  mitigation and test for each threat, not a checklist with no follow-through.
when_to_use: >
  F-ARCH-6 (threat-modelling.framework.yaml), mandatory at L3/L4 and whenever regulatory constraints
  exist (11 §11.2).
applies_to:
  agents: [security, architect]
activation: auto
budget_tokens: 1000
forge_version: '>=1.0 <2'
---

## STRIDE, per boundary

Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege
-- walked against every trust boundary in the data-flow diagram, not once for the whole system. A
boundary is any place data crosses from one trust level to another: client to server, service to
service, process to external API.

## Every threat needs all five fields

Asset, threat, likelihood, impact, mitigation (recorded **as a story**, not a bullet point that
never gets scheduled), residual risk, and the test that proves the mitigation actually works. A
threat model with a mitigation column and no corresponding story is a wish list, not a plan.

## The data-flow diagram is not optional

STRIDE without a real data-flow diagram showing trust boundaries misses exactly the boundaries where
threats concentrate. Produce or update the diagram before walking through the threat categories, not
after.

## Do not

- Do not list a mitigation with no test that proves it -- "we validate input" with no corresponding
  test is a claim, not a mitigation.
- Do not skip a boundary because "nothing sensitive crosses it" without stating why -- that
  judgement itself belongs in the record, since it is exactly the kind of claim that ages badly.
