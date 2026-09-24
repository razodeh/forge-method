/**
 * `modules/fm-core/agents/*.agent.yaml` — A3's own seventeen Build / Quality & operations /
 * Facilitation roster agents, plus the whole-roster (A2+A3) completeness test and the full
 * separation-of-duties load-time re-check `PLAN-M6.md` A3's own Checks section asks for ("run once
 * here, the last roster-content piece").
 *
 * @see specs/05 §5.2, §5.3, §5.9
 * @see PLAN-M6.md A3
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { WORKFLOW_INDEX } from '@forge/templates';
import { artifactTypeById } from '@forge/schemas';

import { loadAgentDefinition } from '../../src/schema/load.ts';
import { AgentRegistry } from '../../src/registry/registry.ts';
import { resolveExtends } from '../../src/registry/resolve-extends.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const agentsDir = path.join(repoRoot, 'modules', 'fm-core', 'agents');

const A2_ROSTER_IDS = [
  'orchestrator',
  'analyst',
  'pm',
  'po',
  'ux',
  'em',
  'architect',
  'data-architect',
  'domain-modeler',
  'integration-architect',
  'security',
] as const;

const A3_ROSTER_IDS = [
  // Build
  'platform',
  'backend',
  'frontend',
  'mobile',
  'data-engineer',
  'ml-engineer',
  // Quality & operations
  'test-architect',
  'sdet',
  'reviewer',
  'diagnostician',
  'sre',
  'release',
  'techwriter',
  'finops',
  'compliance',
  // Facilitation
  'facilitator',
  'critic',
] as const;

const BASE_DOCUMENT_IDS = ['base-engineer'] as const;

/** The roles a story can name as its owner (`implement-story`'s run-time agent); pinned, see below. */
const IMPLEMENTATION_ROLES = [
  'backend',
  'base-engineer',
  'data-engineer',
  'frontend',
  'ml-engineer',
  'mobile',
] as const;

/** The roles (A3, plus `base-engineer`, the shared base document of the implementation roles) whose shipped steps declare a `HandoffRecord` output: `test-architect` (`write-test-plan`,
 * `verify-nfrs`), `sre` (`instrument-observability`), `release` (`prepare-store-submission`) and every implementation
 * role (`implement-story:plan`). Pinned; see the test that uses it. */
const HANDOFF_DECLARING_A3_ROLES: readonly string[] = [
  'test-architect',
  'sre',
  'release',
  ...IMPLEMENTATION_ROLES,
];

/** The agent ids of every shipped workflow step (built-in and module) that declares a `HandoffRecord` output, plus,
 * for a step run by a run-time owner role, every agent that declares a `Code` output (a story owner). */
function agentsDeclaringHandoffSteps(): readonly string[] {
  const ids = new Set<string>();
  const sources: string[] = Object.values(WORKFLOW_INDEX).map((relative) =>
    readFileSync(path.join(repoRoot, 'packages', 'templates', relative), 'utf8'),
  );
  const modulesDir = path.join(repoRoot, 'modules');
  for (const module of readdirSync(modulesDir)) {
    const dir = path.join(modulesDir, module, 'workflows');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files) sources.push(readFileSync(path.join(dir, file), 'utf8'));
  }
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    const outputs = record['outputs'];
    if (
      typeof record['agent'] === 'string' &&
      Array.isArray(outputs) &&
      outputs.some((output) => (output as { type?: unknown } | null)?.type === 'HandoffRecord')
    ) {
      ids.add(record['agent']);
    }
    for (const child of Object.values(record)) walk(child);
  };
  for (const source of sources) walk(parseYaml(source));
  return [...ids];
}

/** The real, complete 28-role `05` §5.2 roster, across all six subsections. */
const FULL_ROSTER_IDS = [...A2_ROSTER_IDS, ...A3_ROSTER_IDS];

function readAgentSource(id: string): string {
  return readFileSync(path.join(agentsDir, `${id}.agent.yaml`), 'utf8');
}

function loadAgent(id: string): AgentDefinition {
  const result = loadAgentDefinition(readAgentSource(id), `${id}.agent.yaml`);
  if (!result.success)
    throw new Error(`${id} failed to load: ${JSON.stringify(result.issues, null, 2)}`);
  return result.agent;
}

function globPrefix(glob: string): string {
  return glob.replace(/\/?\*+$/, '');
}

function globsOverlap(a: string, b: string): boolean {
  const [prefixA, prefixB] = [globPrefix(a), globPrefix(b)];
  return (
    prefixA === prefixB || prefixA.startsWith(`${prefixB}/`) || prefixB.startsWith(`${prefixA}/`)
  );
}

function distinctPairs<T>(items: readonly T[]): (readonly [T, T])[] {
  const pairs: (readonly [T, T])[] = [];
  items.forEach((left, i) => {
    items.slice(i + 1).forEach((right) => pairs.push([left, right]));
  });
  return pairs;
}

describe('A3: the seventeen Build / Quality & operations / Facilitation roster agents', () => {
  it.each(A3_ROSTER_IDS)('%s loads via loadAgentDefinition with a matching id', (id) => {
    expect(loadAgent(id).id).toBe(id);
  });

  it("every A3 agent's tier/decisions_owned/outputs is non-empty and tier is a real value", () => {
    for (const id of A3_ROSTER_IDS) {
      const agent = loadAgent(id);
      expect(['core', 'specialised', 'optional']).toContain(agent.tier);
      expect(agent.decisions_owned.length).toBeGreaterThan(0);
      expect(agent.outputs.length).toBeGreaterThan(0);
    }
  });

  it("frontend/mobile/data-engineer/ml-engineer declare their own specialised/optional tier per the table's Tier column", () => {
    expect(loadAgent('frontend').tier).toBe('specialised');
    expect(loadAgent('mobile').tier).toBe('specialised');
    expect(loadAgent('data-engineer').tier).toBe('specialised');
    expect(loadAgent('ml-engineer').tier).toBe('optional');
  });

  it("release/finops/compliance declare their own optional tier per the table's Tier column", () => {
    expect(loadAgent('release').tier).toBe('optional');
    expect(loadAgent('finops').tier).toBe('optional');
    expect(loadAgent('compliance').tier).toBe('optional');
  });

  it("reviewer never declares an implementation-shaped output (05 §5.2's own separation-of-duties rule, A1's own load-time shape check)", () => {
    const reviewer = loadAgent('reviewer');
    const implementationTypes = new Set(['Code', 'Component']);
    for (const output of reviewer.outputs) {
      expect(
        implementationTypes.has(output.type),
        `reviewer declares implementation-shaped output "${output.type}"`,
      ).toBe(false);
    }
  });

  it("critic never self-approves a gate, and never writes to the KB directly (05 §5.2's own separation-of-duties rule)", () => {
    const critic = loadAgent('critic');
    expect(critic.gates.may_approve).toEqual([]);
    expect(critic.kb_write).toEqual([]);
  });

  it('frontend genuinely inherits skills from base-engineer via resolveExtends -- the one field this piece deliberately left unset (SPEC-QUESTIONS.md Q98)', () => {
    const registry = new AgentRegistry([loadAgent('frontend'), loadAgent('base-engineer')]);
    const resolved = resolveExtends('frontend', registry);
    const frontendOwnSource = loadAgent('frontend');
    expect(frontendOwnSource.skills).toBeUndefined();
    expect(resolved.skills).toEqual(loadAgent('base-engineer').skills);
  });

  it("no engineer-tier implementer role (backend/frontend/mobile/data-engineer/ml-engineer) claims exclusive file ownership -- they all extend base-engineer's own non-exclusive default, since real code lives across arbitrary src/** paths no static glob claim can safely partition ahead of time", () => {
    for (const id of ['backend', 'frontend', 'mobile', 'data-engineer', 'ml-engineer'] as const) {
      expect(loadAgent(id).parallel_safety.exclusive).toBe(false);
    }
  });

  // A fresh critic round found two real issues here, both fixed:
  it('HandoffRecord is used only for real inter-agent handoffs, never as a stand-in for an unrelated document type', () => {
    // `orchestrator` (A2) and `facilitator`/`security` (their own roles) are the only genuinely
    // HandoffRecord/SessionRecord-shaped outputs in the whole roster -- every other agent's own output
    // must use a type specific to what it actually produces, matching `05` §5.6's own rigid
    // inter-agent-handoff shape (id/from/to/step/timestamp/delivered/...), which a test strategy doc,
    // a README, a cost model, a compliance matrix, release notes, or an objection list could never
    // honestly satisfy.
    //
    // `PLAN-M13.md` P18 (`SPEC-QUESTIONS.md` Q224) narrowed this from "no other role" to "no role whose shipped
    // steps do not declare one": P7's output check made a subtype-tagged `HandoffRecord` entry in
    // `reports/handoffs.md` the checkable product of ten shipped steps (the entry REGISTERS the document the brief
    // writes, `from`/`to`/`step`/`delivered` all real), and block [5] of a prompt is rendered from the agent's own
    // `outputs`, so an agent whose step declares one must list it or its prompt never mentions the register. The
    // premise is kept: a role that runs no such step still may not list one. The allowed roles are PINNED by hand
    // (`HANDOFF_DECLARING_A3_ROLES`), and a second test asserts the pin equals the roles the shipped workflows
    // give such a step, so a step that starts declaring `HandoffRecord` for another role is a deliberate edit here,
    // not a silent grant.
    const HANDOFF_SHAPED_IDS = new Set(['orchestrator', ...HANDOFF_DECLARING_A3_ROLES]);
    for (const id of A3_ROSTER_IDS) {
      if (HANDOFF_SHAPED_IDS.has(id)) continue;
      const agent = loadAgent(id);
      for (const output of agent.outputs) {
        expect(
          output.type,
          `${id} declares a HandoffRecord-typed output for non-handoff content`,
        ).not.toBe('HandoffRecord');
      }
    }
  });

  it('the pinned HandoffRecord roles are exactly the A3 roles whose shipped steps declare one, and every pinned implementation role declares Code', () => {
    const derived = new Set([
      ...agentsDeclaringHandoffSteps().filter((id) => !id.includes('{{')),
      // A `{{ownerRole}}` step (`implement-story:plan`) is run by whichever implementation role owns the story: the
      // pin follows only if some shipped step with a run-time agent still declares one.
      ...(agentsDeclaringHandoffSteps().some((id) => id.includes('{{'))
        ? IMPLEMENTATION_ROLES
        : []),
    ]);
    const a3 = new Set<string>(A3_ROSTER_IDS);
    expect(new Set([...derived].filter((id) => a3.has(id)))).toEqual(
      new Set(HANDOFF_DECLARING_A3_ROLES.filter((id) => a3.has(id))),
    );
    for (const id of IMPLEMENTATION_ROLES) {
      expect(
        loadAgent(id).outputs.map((output) => output.type),
        `${id} is pinned as an implementation role but declares no Code output`,
      ).toContain('Code');
    }
  });

  it('every cardinality: many output has a real templated path (a placeholder), so multiple instances cannot collide on one literal file', () => {
    for (const id of A3_ROSTER_IDS) {
      const agent = loadAgent(id);
      for (const output of agent.outputs) {
        if (output.cardinality !== 'many') continue;
        expect(
          output.path,
          `${id}'s "many"-cardinality output "${output.type}" has a non-templated path "${output.path}"`,
        ).toMatch(/\{[a-zA-Z_]+\}|\*\*|[^/]*\*[^/]*$/);
      }
    }
  });

  describe('whole-roster (A2+A3) invariants -- run once here, the last roster-content piece', () => {
    it('modules/fm-core/agents/ names exactly the real 28-role 05 §5.2 roster plus base-engineer, no more and no fewer', () => {
      const shipped = readdirSync(agentsDir)
        .filter((name) => name.endsWith('.agent.yaml'))
        .map((name) => name.replace(/\.agent\.yaml$/, ''))
        .sort();
      expect(FULL_ROSTER_IDS).toHaveLength(28);
      expect(shipped).toEqual([...FULL_ROSTER_IDS, ...BASE_DOCUMENT_IDS].sort());
    });

    it('no two agents in the complete roster have the same id', () => {
      const ids = FULL_ROSTER_IDS.map((id) => loadAgent(id).id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('no two agents both marked exclusive claim overlapping file_ownership globs, across the complete roster', () => {
      const exclusiveAgents = [...FULL_ROSTER_IDS, ...BASE_DOCUMENT_IDS]
        .map(loadAgent)
        .filter((agent) => agent.parallel_safety.exclusive);
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

    it("no two agents' kb_write globs overlap, across the complete roster (05 §5.9's own rule)", () => {
      const agents = [...FULL_ROSTER_IDS, ...BASE_DOCUMENT_IDS].map(loadAgent);
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

    it("pm/po may only approve product-side gates, architect/platform only engineering-side, across the complete roster (05 §5.2's own roster rule)", () => {
      const ENGINEERING_GATES = new Set(['G-Foundation', 'G-Verify', 'G-Stable', 'G-Integration']);
      const PRODUCT_GATES = new Set(['G-Problem', 'G-Product']);
      for (const id of ['pm', 'po'] as const) {
        for (const gate of loadAgent(id).gates.may_approve) {
          expect(
            ENGINEERING_GATES.has(gate),
            `${id} may_approve names engineering gate "${gate}"`,
          ).toBe(false);
        }
      }
      for (const id of ['architect', 'platform'] as const) {
        for (const gate of loadAgent(id).gates.may_approve) {
          expect(PRODUCT_GATES.has(gate), `${id} may_approve names product gate "${gate}"`).toBe(
            false,
          );
        }
      }
    });

    it("every reviewer/critic/diagnostician/test-architect agent (05 §5.2's own separation-of-duties roster) never self-approves a gate", () => {
      for (const id of ['reviewer', 'critic', 'diagnostician', 'test-architect'] as const) {
        expect(loadAgent(id).gates.may_approve).toEqual([]);
      }
    });

    // `PLAN-M14.md` P42: `orchestrator`/`em` used to claim `docs/forge/sessions/handoffs/**`,
    // `docs/forge/kb/delivery/risks/**` and `docs/forge/sessions/retros/**` -- none of them the real `18`
    // §18.7 registry path of the output each role actually declares (`HandoffRecord` at
    // `docs/forge/reports/handoffs.md`; `Risk` at `docs/forge/kb/risks.md`; `SessionRecord` at
    // `docs/forge/sessions/SESSION-*.md`), so `forge agent validate`'s claim never covered what it named.
    it("no A2/A3 agent's file_ownership names a stale docs/forge/sessions/handoffs, docs/forge/kb/delivery/risks or docs/forge/sessions/retros path", () => {
      const STALE_SEGMENTS = [
        'docs/forge/sessions/handoffs',
        'docs/forge/kb/delivery/risks',
        'docs/forge/sessions/retros',
      ];
      for (const id of [...FULL_ROSTER_IDS, ...BASE_DOCUMENT_IDS]) {
        for (const glob of loadAgent(id).parallel_safety.file_ownership) {
          for (const stale of STALE_SEGMENTS) {
            expect(
              glob === stale || glob.startsWith(`${stale}/`),
              `${id}'s file_ownership ("${glob}") names the stale "${stale}" path`,
            ).toBe(false);
          }
        }
      }
    });

    // `PLAN-M14.md` P42's own `output-ownership-overlap` rule (`05` §5.9), recomputed here at the
    // definition level over the real fm-core roster: the concrete sample path a registered output type's
    // own declared `path` names (every placeholder read as a literal `x` -- the same "one representative
    // concrete path" `outputPathCoveredBy` (`@forge/engine`, unreachable from this package, `02` §2.2's
    // own boundary graph) uses) must never fall inside another role's exclusive `file_ownership` claim.
    // Sound because `checkOutputsAgreeWithRegistry` (`schema/load.ts`, `PLAN-M14.md` P33) already enforces,
    // at load time, that a REGISTERED type's own declared `path` ends with the registry's own tail, so the
    // agent's own declared path and the registry's own path cannot disagree for any type this test checks
    // (`Code` and an unregistered type are skipped before `outputSample` is ever called on them).
    function outputSample(outputPath: string): string {
      return outputPath.replace(/\*/g, 'x').replace(/\{[^}]+\}/g, 'x');
    }

    it("no exclusive agent's file_ownership glob covers another role's declared output sample (05 §5.9's new output-ownership-overlap rule)", () => {
      const agents = [...FULL_ROSTER_IDS, ...BASE_DOCUMENT_IDS].map(loadAgent);
      for (const owner of agents) {
        if (!owner.parallel_safety.exclusive || owner.parallel_safety.file_ownership.length === 0) {
          continue;
        }
        for (const producer of agents) {
          if (producer.id === owner.id) continue;
          for (const output of producer.outputs) {
            if (output.type === 'Code' || artifactTypeById(output.type) === undefined) continue;
            const sample = outputSample(output.path);
            for (const glob of owner.parallel_safety.file_ownership) {
              expect(
                globsOverlap(glob, sample),
                `${owner.id}'s exclusive file_ownership ("${glob}") covers ${producer.id}'s declared ${output.type} output ("${output.path}")`,
              ).toBe(false);
            }
          }
        }
      }
    });
  });
});
