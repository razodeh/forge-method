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
 * One class: `no-write-grant`, the agent's `tools.write` is `false`, so its session cannot write a file at
 * all (the live case: `retro:run-retro`). P15 flips those grants.
 *
 * `PLAN-M13.md` P17 (`SPEC-QUESTIONS.md` Q217) removed the two `swarm-review` reviewer steps
 * (`build-stage:review`, `implement-story:review`) from it, and they are NOT exempt: the `reviewer` stays
 * `write: false` (separation of duties), a `mode: swarm-review` step now runs one read-only session per
 * perspective and the ENGINE writes and validates the `ReviewReport` in the step's own lane, after which the
 * output contract check runs on that lane like on any agent step. They are pinned below as
 * `ENGINE_WRITTEN_STEPS`, each asserted to declare only engine-written types, so a swarm-review step that
 * declared any other output its write-forbidden reviewer cannot produce is a gap again (and fails here).
 *
 * There used to be a second class, `no-write-scope` (9 steps whose agent's `parallel_safety.file_ownership`
 * does not cover the output's registry path). `PLAN-M13.md` P14 (`SPEC-QUESTIONS.md` Q212) removed it: a
 * step's claim is now its `produces` globs plus the registry paths of its declared `outputs`, and
 * `file_ownership` is enforced nowhere at run time (only `forge agent validate`'s overlap check reads it), so
 * an agent whose ownership omits the output path was never blocked by that, and under `strict` claim
 * enforcement the output is no longer reverted either. The 9 steps are pinned below as
 * `OWNERSHIP_ONLY_STEPS`; their outputs are asserted to lie inside their claim (definition level here;
 * concrete registry paths of every type through the real claim matcher in
 * `packages/engine/test/dispatch/output-claim.test.ts`). That is all "not a gap" means: the output survives
 * claim enforcement. Documents their briefs name beyond the output (`decide-repo-strategy`'s
 * `delivery/repo-strategy.md`, the `sre` pipeline Diagram, the mobile app's own build files) were outside the
 * claim and reverted; `PLAN-M13.md` P16 declares them as `produces` (`SPEC-QUESTIONS.md` Q216), and
 * `test/brief-write-paths-in-claim.test.ts` compares the paths and register entries each brief tells its agent
 * to write with the step's claim (for the default docs layout; its header lists what it cannot see).
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
import { outputGlob, outputPathCoveredBy, resolveStepClaim } from '@forge/engine/dispatch';
import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { artifactTypeById } from '@forge/schemas/registry';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { WORKFLOW_INDEX } from '@forge/templates';

import { loadAgentRegistry, resolveExtends } from '../packages/agents/src/registry/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

type GapClass = 'no-write-grant';

/**
 * The inventory. Keys are `<workflow>:<step id>`, with the module workflows prefixed `<module>/<file>:`.
 * Each entry is a step whose agent cannot write; deleting one here without fixing the agent makes this test
 * fail, and so does fixing one without deleting it.
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
  'plan-stages:decompose-stages': 'no-write-grant',
  'plan-stage:write-epics': 'no-write-grant',
  'plan-stage:write-stories': 'no-write-grant',
  'plan-stage:write-test-plan': 'no-write-grant',
  'build-stage:freeze-contracts': 'no-write-grant',
  'verify-stage:verify-nfrs': 'no-write-grant',
  'harden:security-pass': 'no-write-grant',
  'refactor:state-invariants': 'no-write-grant',
  'adopt:reverse-derive-specs': 'no-write-grant',
  'adopt:gap-analysis': 'no-write-grant',
  'migrate:plan-migration': 'no-write-grant',
  'retro:run-retro': 'no-write-grant',
  'replan:propose-change': 'no-write-grant',
  'replan:impact-analysis': 'no-write-grant',
  'fm-service/contract-test-cycle.workflow.yaml:draft-contract': 'no-write-grant',
};

/** Pinned on purpose, in addition to the table: lowering it is the deliberate act P15 performs (P17 took it
 * from 28 to 26: the two reviewer steps below). */
const PINNED_TOTAL = 26;

/**
 * The steps whose agent cannot write but whose declared outputs the engine writes itself (`PLAN-M13.md` P17): a
 * `mode: swarm-review` step declaring only `ReviewReport`. Not gaps and not exemptions: the output check runs
 * on their lane (`packages/engine/test/interaction/swarm-review-step.test.ts` proves it, and proves a report
 * that is missing or invalid fails the step typed).
 */
const ENGINE_WRITTEN_STEPS: readonly string[] = ['build-stage:review', 'implement-story:review'];
/** The artifact types the engine writes for a step (today only the swarm-review report). */
const ENGINE_WRITTEN_TYPES: ReadonlySet<string> = new Set(['ReviewReport']);

/**
 * The steps that used to be the `no-write-scope` class (P7 to P13: 9): their agent can write but its
 * `file_ownership` does not cover the declared output's registry path. Not gaps since P14: the step's claim
 * covers the output, and ownership is not enforced at run time. Kept as an explicit list so the recomputed
 * definition-level fact is visible and any new such step is noticed.
 */
const OWNERSHIP_ONLY_STEPS: readonly string[] = [
  'initialize-project:decide-repo-strategy',
  'debug:run-rca',
  'harden:performance-pass',
  'deliver-stage:design-pipeline',
  'deliver-stage:design-deployment',
  'operate:instrument-observability',
  'operate:define-slos',
  'operate:write-runbooks',
  'fm-mobile/store-release.workflow.yaml:prepare-release-build',
];

/** Steps whose agent is a run-time template: cannot be classified from the workflow alone. */
const UNRESOLVED_AGENT_STEPS: readonly string[] = ['implement-story:plan'];

interface DeclaredStep {
  readonly key: string;
  readonly agent: string;
  readonly mode: string | undefined;
  readonly perspectives: readonly string[];
  readonly outputTypes: readonly string[];
  readonly produces: readonly string[];
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
        mode: step.mode,
        perspectives: step.perspectives ?? [],
        outputTypes: (step.outputs ?? []).map((output) => output.type),
        produces: typeof step.produces === 'string' ? [step.produces] : (step.produces ?? []),
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
/** Write-forbidden agents whose outputs the engine writes (`swarm-review` + only engine-written types). */
const engineWritten: string[] = [];
const unresolved: string[] = [];
/** Steps whose agent can write but whose `file_ownership` does not cover an output: the retired class. */
const ownershipOnly: string[] = [];
for (const step of declared) {
  if (step.agent.includes('{{')) {
    unresolved.push(step.key);
    continue;
  }
  const agent = resolveExtends(step.agent, registry);
  if (!agent.tools.write) {
    if (
      step.mode === 'swarm-review' &&
      // No perspectives is RUN-046 at run time: such a step writes no report, so it is not engine-written.
      step.perspectives.length > 0 &&
      step.outputTypes.every((type) => ENGINE_WRITTEN_TYPES.has(type))
    ) {
      engineWritten.push(step.key);
      continue;
    }
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
  if (uncovered) ownershipOnly.push(step.key);
}

describe('output contract: the known-gap inventory (P11 / Q208 finding 4)', () => {
  it('lists exactly the shipped agent steps that declare outputs their agent cannot write', () => {
    expect(Object.fromEntries([...derived].sort())).toEqual(
      Object.fromEntries(Object.entries(KNOWN_GAPS).sort()),
    );
  });

  it('pins the count: fixing a step (P15) must lower it deliberately', () => {
    expect(derived.size).toBe(PINNED_TOTAL);
  });

  it('the swarm-review reviewer steps are not gaps because the engine writes their report, not because they are exempt (P17)', () => {
    expect([...engineWritten].sort()).toEqual([...ENGINE_WRITTEN_STEPS].sort());
    for (const key of engineWritten) {
      expect(derived.has(key), `${key} is listed as a gap`).toBe(false);
      // Still write-forbidden: the reviewer's grant was not touched to make this pass.
      const step = declared.find((entry) => entry.key === key);
      expect(step?.agent).toBe('reviewer');
      expect(resolveExtends('reviewer', registry).tools.write).toBe(false);
    }
  });

  it('recomputes the retired no-write-scope class from the real definitions: the same 9 steps, none of them a gap', () => {
    expect([...ownershipOnly].sort()).toEqual([...OWNERSHIP_ONLY_STEPS].sort());
    for (const key of ownershipOnly) expect(derived.has(key), `${key} is a gap`).toBe(false);
  });

  it('every ownership-only step is covered by its own claim (produces plus declared outputs), whatever its agent owns', () => {
    for (const step of declared.filter((entry) => ownershipOnly.includes(entry.key))) {
      const claim = resolveStepClaim(
        {
          kind: 'agent',
          produces: step.produces,
          outputs: step.outputTypes.map((type) => ({ type })),
        },
        DEFAULT_CONFIG.paths,
        'warn',
      );
      expect(claim.policy, `${step.key} is enforced strict`).toBe('strict');
      for (const type of step.outputTypes) {
        const definition = artifactTypeById(type);
        expect(definition, `${step.key} declares unregistered ${type}`).toBeDefined();
        if (definition === undefined) continue;
        expect(
          outputPathCoveredBy(definition.id, DEFAULT_CONFIG.paths, claim.globs),
          `${step.key}: ${type} is outside its claim ${claim.globs.join(', ')}`,
        ).toBe(true);
      }
    }
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
