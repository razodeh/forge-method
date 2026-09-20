/**
 * The known-gap inventory for the output contract check (`PLAN-M13.md` P7, P11; `SPEC-QUESTIONS.md` Q208
 * finding 4 and Q209): every agent step of every shipped workflow that declares `outputs` but is assigned
 * to an agent that cannot write them, derived from the real shipped workflows and the real shipped agents
 * rather than listed by hand.
 *
 * Why it exists. The output contract check fails an agent step whose declared outputs are not produced.
 * Shipped workflows assign file-producing steps to agents whose own grant forbids writing files
 * (`em`, `analyst`, `pm`, `po`, `architect`, `reviewer`, `security`, `test-architect`, `ux`,
 * `data-architect`, `integration-architect`): those steps cannot succeed until `PLAN-M13.md` P11 (an owner
 * decision: give the roles a write grant, or move the outputs to roles that have one) resolves each. The
 * check is deliberately not exempted for them and does not consult this inventory; this test only makes the
 * size of the gap visible and makes changing it deliberate. When P11 fixes some steps this goes red: lower
 * the pinned counts and delete the fixed rows in the same commit.
 *
 * Two classes. `no-write-grant`: the agent's `tools.write` is `false`, so its session cannot write a file
 * at all (the live case: `retro:run-retro`). `no-write-scope`: `tools.write` is true but none of the
 * agent's `parallel_safety.file_ownership` globs covers the output's registry path (or it declares none),
 * so the agent's own definition never claims the place the output must go. `file_ownership` is not enforced
 * at run time today, so this class is a definition inconsistency rather than a hard stop; it is inventoried
 * because P11 must settle it too.
 *
 * Only steps that are dispatched are counted (`steps:`, including fanout children and parallel/sequence
 * members); `onComplete` and `onFailure.escalations` steps are not compiled into the run plan. A step whose
 * agent is a run-time template (`{{ownerRole}}`) cannot be classified statically and is listed apart.
 *
 * Lives at the repository root for the reason `test/workflows.test.ts` documents (needs `@forge/engine`,
 * `@forge/templates` and the bare `modules/` directory, which no single package may import).
 *
 * @see specs/05 §5.5
 * @see specs/18 §18.7
 * @see PLAN-M13.md P7, P11
 * @see SPEC-QUESTIONS.md Q208, Q209
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AbsolutePath } from '@forge/core';
import { outputGlob, outputPathCoveredBy } from '@forge/engine/dispatch';
import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { artifactTypeById } from '@forge/schemas/registry';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { WORKFLOW_INDEX } from '@forge/templates';

import { loadAgentRegistry, resolveExtends } from '../packages/agents/src/registry/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

type GapClass = 'no-write-grant' | 'no-write-scope';

/**
 * The inventory. Keys are `<workflow>:<step id>`, with the module workflows prefixed `<module>/<file>:`.
 * Each entry is a step P11 must resolve; deleting one here without fixing the workflow or the agent
 * makes this test fail, and so does fixing one without deleting it.
 */
const KNOWN_GAPS: Readonly<Record<string, GapClass>> = {
  'intake:propose-level': 'no-write-grant',
  'intake:seed-glossary': 'no-write-grant',
  'discover:frame-problem': 'no-write-grant',
  'discover:define-metrics': 'no-write-grant',
  'define-product:write-vision': 'no-write-grant',
  'define-product:write-prd': 'no-write-grant',
  'define-product:write-ux-spec': 'no-write-grant',
  'shape-solution:select-architecture': 'no-write-grant',
  'shape-solution:model-data': 'no-write-grant',
  'shape-solution:select-stack': 'no-write-grant',
  'shape-solution:threat-model': 'no-write-grant',
  'initialize-project:decide-repo-strategy': 'no-write-scope',
  'plan-stages:decompose-stages': 'no-write-grant',
  'plan-stage:write-epics': 'no-write-grant',
  'plan-stage:write-stories': 'no-write-grant',
  'plan-stage:write-test-plan': 'no-write-grant',
  'build-stage:freeze-contracts': 'no-write-grant',
  'build-stage:review': 'no-write-grant',
  'implement-story:review': 'no-write-grant',
  'verify-stage:verify-nfrs': 'no-write-grant',
  'debug:run-rca': 'no-write-scope',
  'harden:security-pass': 'no-write-grant',
  'harden:performance-pass': 'no-write-scope',
  'refactor:state-invariants': 'no-write-grant',
  'deliver-stage:design-pipeline': 'no-write-scope',
  'deliver-stage:design-deployment': 'no-write-scope',
  'operate:instrument-observability': 'no-write-scope',
  'operate:define-slos': 'no-write-scope',
  'operate:write-runbooks': 'no-write-scope',
  'adopt:reverse-derive-specs': 'no-write-grant',
  'adopt:gap-analysis': 'no-write-grant',
  'migrate:plan-migration': 'no-write-grant',
  'retro:run-retro': 'no-write-grant',
  'replan:propose-change': 'no-write-grant',
  'replan:impact-analysis': 'no-write-grant',
  'fm-mobile/store-release.workflow.yaml:prepare-release-build': 'no-write-scope',
  'fm-service/contract-test-cycle.workflow.yaml:draft-contract': 'no-write-grant',
};

/** Pinned on purpose, in addition to the table: lowering these is the deliberate act P11 performs. */
const PINNED_TOTAL = 37;
const PINNED_NO_WRITE_GRANT = 28;
const PINNED_NO_WRITE_SCOPE = 9;

/** Steps whose agent is a run-time template: cannot be classified from the workflow alone. */
const UNRESOLVED_AGENT_STEPS: readonly string[] = ['implement-story:plan'];

interface DeclaredStep {
  readonly key: string;
  readonly agent: string;
  readonly outputTypes: readonly string[];
}

function collect(
  prefix: string,
  steps: readonly WorkflowStep[],
  into: DeclaredStep[],
  inheritedId?: string,
): void {
  for (const step of steps) {
    // A fanout's templated child carries no id of its own: the fanout step's id names it.
    if (step.kind === 'fanout') collect(prefix, [step.step], into, step.id);
    else if (step.kind === 'parallel' || step.kind === 'sequence')
      collect(prefix, step.steps, into);
    else if (step.kind === 'agent' && (step.outputs?.length ?? 0) > 0) {
      into.push({
        key: `${prefix}:${step.id ?? inheritedId ?? step.agent}`,
        agent: step.agent,
        outputTypes: (step.outputs ?? []).map((output) => output.type),
      });
    }
  }
}

function shippedSteps(): DeclaredStep[] {
  const found: DeclaredStep[] = [];
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    const parsed = parseWorkflow(readFileSync(path.join(templatesRoot, relative), 'utf8'));
    if (!parsed.success) throw new Error(`shipped workflow ${id} does not parse`);
    collect(id, parsed.workflow.steps, found);
  }
  for (const moduleName of readdirSync(modulesDir)) {
    const workflowsDir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(workflowsDir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files) {
      const parsed = parseWorkflow(readFileSync(path.join(workflowsDir, file), 'utf8'));
      if (!parsed.success) throw new Error(`module workflow ${moduleName}/${file} does not parse`);
      collect(`${moduleName}/${file}`, parsed.workflow.steps, found);
    }
  }
  return found;
}

const registry = await loadAgentRegistry(modulesDir as AbsolutePath);
const declared = shippedSteps();

const derived = new Map<string, GapClass>();
const unresolved: string[] = [];
for (const step of declared) {
  if (step.agent.includes('{{')) {
    unresolved.push(step.key);
    continue;
  }
  const agent = resolveExtends(step.agent, registry);
  if (!agent.tools.write) {
    derived.set(step.key, 'no-write-grant');
    continue;
  }
  const uncovered = step.outputTypes.some((type) => {
    const definition = artifactTypeById(type);
    return (
      definition === undefined ||
      !outputPathCoveredBy(
        definition.id,
        DEFAULT_CONFIG.paths,
        agent.parallel_safety.file_ownership,
      )
    );
  });
  if (uncovered) derived.set(step.key, 'no-write-scope');
}

describe('output contract: the known-gap inventory (P11 / Q208 finding 4)', () => {
  it('lists exactly the shipped agent steps that declare outputs their agent cannot write', () => {
    expect(Object.fromEntries([...derived].sort())).toEqual(
      Object.fromEntries(Object.entries(KNOWN_GAPS).sort()),
    );
  });

  it('pins the counts: fixing a step (P11) must lower these deliberately', () => {
    const count = (kind: GapClass): number =>
      [...derived.values()].filter((v) => v === kind).length;
    expect(derived.size).toBe(PINNED_TOTAL);
    expect(count('no-write-grant')).toBe(PINNED_NO_WRITE_GRANT);
    expect(count('no-write-scope')).toBe(PINNED_NO_WRITE_SCOPE);
    expect(PINNED_NO_WRITE_GRANT + PINNED_NO_WRITE_SCOPE).toBe(PINNED_TOTAL);
  });

  it('includes the step the live smoke run found (retro:run-retro, Q208 finding 4)', () => {
    expect(derived.get('retro:run-retro')).toBe('no-write-grant');
  });

  it('lists steps with a run-time agent apart, so they are not silently uncounted', () => {
    expect([...unresolved].sort()).toEqual([...UNRESOLVED_AGENT_STEPS].sort());
  });

  it('never has a declared output the check cannot locate: every output type is registered', () => {
    for (const step of declared) {
      for (const type of step.outputTypes) {
        const definition = artifactTypeById(type);
        expect(definition, `${step.key} declares unregistered type ${type}`).toBeDefined();
        if (definition !== undefined) {
          expect(outputGlob(definition.id, DEFAULT_CONFIG.paths)).toMatch(/^docs\/forge\//);
        }
      }
    }
  });
});
