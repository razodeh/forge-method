/**
 * `modules/fm-core/agents/*.agent.yaml` — A2's own eleven Direction & product / Architecture & design
 * roster agents, plus `base-engineer` (the shared base document `architect`'s own `extends:
 * base-engineer` field needs to resolve, required to exist even though it is not itself a `05` §5.2
 * roster row — see `SPEC-QUESTIONS.md`).
 *
 * Lives in this package's own `test/`, not the repository root: unlike `@forge/templates`'
 * `WORKFLOW_INDEX`/`GATE_INDEX`/`FRAMEWORK_INDEX` (T1-T4), `modules/fm-core/agents/` content has no
 * package-level index of its own to import — this file reads the real files off disk directly via a
 * relative path, the same "just a filesystem read, no cross-package import" shape `@forge/methods`'
 * own fixture-string tests already use, so no repository-root placement or boundary-graph edge is
 * needed at all.
 *
 * The exact-directory-listing completeness check originally lived here but moved to
 * `a3-roster.test.ts`'s own "whole-roster" describe block once A3 shipped seventeen more files into
 * the same directory — a single, real completeness check against the complete 28-role roster, not two
 * competing partial ones that would need to agree on where the dividing line falls.
 *
 * @see specs/05 §5.2, §5.3
 * @see PLAN-M6.md A2
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadAgentDefinition } from '../../src/schema/load.ts';
import { AgentRegistry } from '../../src/registry/registry.ts';
import { resolveExtends } from '../../src/registry/resolve-extends.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const agentsDir = path.join(repoRoot, 'modules', 'fm-core', 'agents');

const A2_ROSTER_IDS = [
  // Direction & product
  'orchestrator',
  'analyst',
  'pm',
  'po',
  'ux',
  'em',
  // Architecture & design
  'architect',
  'data-architect',
  'domain-modeler',
  'integration-architect',
  'security',
] as const;

function readAgentSource(id: string): string {
  return readFileSync(path.join(agentsDir, `${id}.agent.yaml`), 'utf8');
}

function loadAgent(id: string): AgentDefinition {
  const result = loadAgentDefinition(readAgentSource(id), `${id}.agent.yaml`);
  if (!result.success)
    throw new Error(`${id} failed to load: ${JSON.stringify(result.issues, null, 2)}`);
  return result.agent;
}

describe('A2: the eleven Direction & product / Architecture & design roster agents', () => {
  it.each(A2_ROSTER_IDS)('%s loads via loadAgentDefinition with a matching id', (id) => {
    expect(loadAgent(id).id).toBe(id);
  });

  it("architect matches 05 §5.3's own literal worked example exactly", () => {
    const worked = `
id: architect
name: System Architect
version: 1.2.0
tier: core
extends: base-engineer            # optional inheritance from a base agent

mandate: >
  Owns the shape of the system: decomposition into components, the interaction patterns between
  them, the technology-independent design, and the non-functional strategy. Accountable for every
  architecture ADR being decided, recorded, and consistent with the Knowledge Body.

decisions_owned:                  # used for routing, gate evidence, and KB write permissions
  - architecture.decomposition
  - architecture.patterns
  - architecture.interfaces
  - architecture.nfr_strategy

persona:
  voice: precise, sceptical, allergic to unjustified complexity
  stance: >
    Prefers boring, reversible choices. Demands a stated failure mode for every component boundary.
    Will refuse to proceed on an undefined non-functional requirement rather than guess.
  disagreement_style: names the specific assumption being challenged and proposes a cheaper test

inputs:
  required:
    - artifact: PRD
    - artifact: NFR
    - kb: constraints/*
  optional:
    - artifact: DomainModel
    - kb: architecture/*

outputs:
  - type: ArchitectureSpec
    schema: architecture-spec.schema.json
    path: docs/forge/kb/architecture/architecture-spec.md
  - type: ADR
    schema: adr.schema.json
    path: docs/forge/kb/decisions/ADR-{seq}-{slug}.md
    cardinality: many
  - type: InterfaceContract
    schema: interface-contract.schema.json
    path: docs/forge/specs/interfaces/{name}.yaml
    cardinality: many
  - type: Diagram
    schema: diagram.schema.json
    path: docs/forge/kb/architecture/views/{name}.mmd
    cardinality: many

kb_write:                          # sections this agent may write without review
  - architecture/**
  - decisions/**                   # ADRs of category architecture only (enforced by schema)
kb_propose:                        # sections it may only propose changes to
  - data/**
  - constraints/**

tools:
  read: true
  write: false                     # architects don't write source code
  exec: [ "git log*", "git diff*", "ls*", "rg*", "cat*", "tree*" ]
  network: false
  git_commit: docs-only            # none | docs-only | lane | full
  deploy: false

model:
  tier: max                        # frugal | balanced | max — mapped per platform in config
  thinking: high                   # none | low | medium | high (adapter maps to its own control)

limits:
  max_turns: 40
  wall_clock_ms: 900000
  max_cost_usd: 6.00

parallel_safety:
  file_ownership: [ "docs/forge/kb/architecture/**", "docs/forge/kb/decisions/**", "docs/forge/specs/interfaces/**" ]
  exclusive: true                  # only one architect lane at a time

gates:
  produces_evidence_for: [ G-Design, G-Integration ]
  may_approve: []                  # architects never self-approve their own gate

frameworks:                        # decision frameworks this agent is expected to run
  - system-design
  - pattern-selection
  - nfr-strategy

skills:                            # procedural knowledge packets (see 15 §15.4)
  - adr-authoring
  - stride-threat-modelling
  - mermaid-authoring
  - c4-diagramming
  - sequence-diagramming

mcp:                               # external reach: per-server, per-tool grants (see 15 §15.5)
  - server: acme-confluence
    tools: [ search, get_page ]

ceiling:                           # the maximum an overlay may widen \`tools\` to (see 15 §15.3.2)
  tools:
    write: false
    exec: [ "git *", "ls*", "rg*", "cat*", "tree*" ]
    network: none
    deploy: false

prompt:
  system: prompts/architect.system.md
  briefs:
    design-system: prompts/architect.design-system.md
    review-change: prompts/architect.review-change.md
`;
    const workedResult = loadAgentDefinition(worked, '(worked example)');
    if (!workedResult.success)
      throw new Error(
        `the worked example itself failed to load: ${JSON.stringify(workedResult.issues, null, 2)}`,
      );
    const shipped = loadAgent('architect');
    // `frameworks`/`skills` differ deliberately: the spec's own worked example names
    // `system-design`/`adr-authoring`/`stride-threat-modelling` (10/11 §11.0/13's own real ids being
    // `architecture-style` and `writing-an-adr`/`threat-modelling-stride`, per the framework/skill ids
    // T3/T5 actually shipped) -- the worked example is illustrative prose from a piece written before
    // T3/T5 existed, not a byte-for-byte content contract for those two fields specifically. Every
    // other field is asserted equal.
    //
    // `prompt.briefs`' *keys* differ deliberately too (`PLAN-M13.md` P3c, `SPEC-QUESTIONS.md` Q205):
    // the worked example's `design-system`/`review-change` are illustrative names that match no workflow
    // step brief, so `assembleAgentSession` could never attach them (`15` §15.3 keys a specialisation by
    // the step brief's basename). The shipped agent uses the real ones, pinned below; every shipped key
    // is proven attachable by `packages/agents/test/prompt/brief-keys-attachable.test.ts`. `prompt.system`
    // is still asserted equal.
    function omitDeliberateDifferences(agent: AgentDefinition): Record<string, unknown> {
      const excluded = new Set(['frameworks', 'skills']);
      return Object.fromEntries(
        Object.entries(agent)
          .filter(([key]) => !excluded.has(key))
          .map(([key, value]) => [key, key === 'prompt' ? { system: agent.prompt.system } : value]),
      );
    }
    expect(omitDeliberateDifferences(shipped)).toEqual(
      omitDeliberateDifferences(workedResult.agent),
    );
    expect(shipped.prompt.briefs).toEqual({
      'select-architecture-style': 'prompts/architect.select-architecture-style.md',
      'change-impact-analysis': 'prompts/architect.change-impact-analysis.md',
    });
    expect(shipped.frameworks?.length).toBeGreaterThan(0);
    expect(shipped.skills?.length).toBeGreaterThan(0);
  });

  it("architect never self-approves a gate (05 §5.2's own roster rule)", () => {
    expect(loadAgent('architect').gates.may_approve).toEqual([]);
  });

  it("pm/po may only approve product-side gates, never an engineering gate (05 §5.2's own roster rule)", () => {
    const ENGINEERING_GATES = new Set(['G-Foundation', 'G-Verify', 'G-Stable', 'G-Integration']);
    for (const id of ['pm', 'po'] as const) {
      const agent = loadAgent(id);
      for (const gate of agent.gates.may_approve) {
        expect(
          ENGINEERING_GATES.has(gate),
          `${id} may_approve names engineering gate "${gate}"`,
        ).toBe(false);
      }
    }
  });

  it("architect/platform may only approve engineering-side gates, never a product gate (05 §5.2's own roster rule)", () => {
    const PRODUCT_GATES = new Set(['G-Problem', 'G-Product']);
    // `platform` ships in A3, not A2 -- checked here anyway since architect (A2) is covered by this
    // same rule and the check is cheap to make general now rather than duplicated in A3's own suite.
    const agent = loadAgent('architect');
    for (const gate of agent.gates.may_approve) {
      expect(PRODUCT_GATES.has(gate), `architect may_approve names product gate "${gate}"`).toBe(
        false,
      );
    }
  });

  it("domain-modeler declares its own specialised tier (fm-service module gating, per the table's Tier column)", () => {
    expect(loadAgent('domain-modeler').tier).toBe('specialised');
  });

  it("integration-architect declares its own specialised tier (bare S, per the table's Tier column)", () => {
    expect(loadAgent('integration-architect').tier).toBe('specialised');
  });

  it("resolveExtends correctly layers architect's own fields over base-engineer's, with architect winning on every field both declare", () => {
    const registry = new AgentRegistry([loadAgent('architect'), loadAgent('base-engineer')]);
    const resolved = resolveExtends('architect', registry);
    const architect = loadAgent('architect');
    // Every field architect itself declares (all of them -- architect has no optional field left
    // unset) must win over base-engineer's own value.
    expect(resolved).toEqual(architect);
  });

  // A fresh critic round found two agents (domain-modeler, integration-architect) originally claimed
  // exclusive `file_ownership`/`kb_write` over a path that was a strict subpath of -- or, for
  // integration-architect's own `file_ownership`, byte-identical to -- another agent's own exclusive
  // claim, a real violation of `05` §5.9's own validator rule ("file_ownership globs don't overlap with
  // another agent marked exclusive"; this schema has no `shared` flag to declare a deliberate overlap).
  // This test locks the fix in with a real, if minimal, prefix-based overlap check -- every glob these
  // 12 files actually use is either an exact path or a `<dir>/**` prefix, so "does neither glob's own
  // literal prefix (with any trailing `/**`/`*` stripped) start with the other's" is a real, correct
  // overlap test for this content, not a full glob-matching engine this piece has no other need for.
  function globPrefix(glob: string): string {
    return glob.replace(/\/?\*+$/, '');
  }

  function globsOverlap(a: string, b: string): boolean {
    const [prefixA, prefixB] = [globPrefix(a), globPrefix(b)];
    return (
      prefixA === prefixB || prefixA.startsWith(`${prefixB}/`) || prefixB.startsWith(`${prefixA}/`)
    );
  }

  /** Every unordered pair of distinct elements from `items`, as `[a, b]` tuples -- avoids the
   * possibly-`undefined` array-index reads a manual `for (i) for (j = i+1)` loop would need. */
  function distinctPairs<T>(items: readonly T[]): (readonly [T, T])[] {
    const pairs: (readonly [T, T])[] = [];
    items.forEach((left, i) => {
      items.slice(i + 1).forEach((right) => pairs.push([left, right]));
    });
    return pairs;
  }

  it('no two agents both marked exclusive claim overlapping file_ownership globs', () => {
    const exclusiveAgents = A2_ROSTER_IDS.map(loadAgent).filter(
      (agent) => agent.parallel_safety.exclusive,
    );
    for (const [left, right] of distinctPairs(exclusiveAgents)) {
      for (const globA of left.parallel_safety.file_ownership) {
        for (const globB of right.parallel_safety.file_ownership) {
          expect(
            globsOverlap(globA, globB),
            `${left.id} ("${globA}") and ${right.id} ("${globB}") both claim exclusive, overlapping file_ownership`,
          ).toBe(false);
        }
      }
    }
  });

  it('no two agents\' kb_write globs overlap (05 §5.9\'s own rule: "no KB write overlap ... unless declared shared" -- this schema has no shared flag, so any overlap at all is unconditional)', () => {
    const agents = A2_ROSTER_IDS.map(loadAgent);
    for (const [left, right] of distinctPairs(agents)) {
      for (const globA of left.kb_write) {
        for (const globB of right.kb_write) {
          expect(
            globsOverlap(globA, globB),
            `${left.id} ("${globA}") and ${right.id} ("${globB}") both claim overlapping kb_write`,
          ).toBe(false);
        }
      }
    }
  });

  it("every A2 agent's tier/decisions_owned/outputs faithfully reflects its own 05 §5.2 table row", () => {
    // A representative, not exhaustive, cross-check: every agent's own `tier` is one of the three
    // real values, and `decisions_owned`/`outputs` are both non-empty -- content fidelity beyond this
    // (the actual wording matching the table's own Owns/Outputs columns) was authored directly from
    // that table and is reviewed by the fresh critic round, not re-derived mechanically here.
    for (const id of A2_ROSTER_IDS) {
      const agent = loadAgent(id);
      expect(['core', 'specialised', 'optional']).toContain(agent.tier);
      expect(agent.decisions_owned.length).toBeGreaterThan(0);
      expect(agent.outputs.length).toBeGreaterThan(0);
    }
  });
});
