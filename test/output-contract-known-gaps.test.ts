/**
 * The known-gap inventory for the output contract check (`PLAN-M13.md` P7, P11; `SPEC-QUESTIONS.md` Q208
 * finding 4 and Q209): every agent step of every shipped workflow that declares `outputs` but is assigned
 * to an agent that cannot write them, derived from the real shipped workflows and the real shipped agents
 * rather than listed by hand.
 *
 * Why it exists. The output contract check fails an agent step whose declared outputs are not produced.
 * Shipped workflows used to assign file-producing steps to agents whose own grant forbade writing files
 * (`em`, `analyst`, `pm`, `po`, `architect`, `reviewer`, `security`, `test-architect`, `ux`,
 * `data-architect`, `integration-architect`), and 28 steps could not succeed. The check is deliberately not
 * exempted for any step and does not consult this inventory; this test makes the size of the gap visible
 * and makes changing it deliberate.
 *
 * One class: `no-write-grant`, the agent's `tools.write` is `false`, so its session cannot write a file at
 * all (the live case: `retro:run-retro`). `PLAN-M13.md` P15 (`SPEC-QUESTIONS.md` Q220, owner decision
 * 2026-09-20) flipped the grant of every AUTHORING role, confined by the P14 claim, and reassigned
 * `define-product:write-prd` from `po` to `pm` (`05` §5.2), so the inventory is now EMPTY (28 -> 0 with P17):
 * an entry may only be added back by a deliberate decision, and this file then fails until it is named.
 *
 * `PLAN-M13.md` P17 (`SPEC-QUESTIONS.md` Q217) took the two `swarm-review` reviewer steps
 * (`build-stage:review`, `implement-story:review`) out of it, and they are NOT exempt: the `reviewer` stays
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
 * enforcement the output is no longer reverted either. The steps are pinned below as
 * `OWNERSHIP_ONLY_STEPS` (9 when P14 landed; 32 once P15 let their agents write, because the P15 roles own
 * a narrower territory than the registry paths their steps declare: the same fact, now for the steps that
 * used to be blocked earlier); their outputs are asserted to lie inside their claim (definition level here;
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
 * @see PLAN-M13.md P7, P11, P15
 * @see SPEC-QUESTIONS.md Q208, Q209, Q220
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
 * Each entry would be a step whose agent cannot write. It is empty (P15 with P17): the authoring roles hold
 * `tools.write: true` (confined by the P14 claim), `reviewer` steps are engine-written, and the reverse
 * also holds, a step added here without an agent that cannot write it fails the first test below.
 */
const KNOWN_GAPS: Readonly<Record<string, GapClass>> = {};

/** Pinned on purpose, in addition to the table: P17 took it from 28 to 26 (the two reviewer steps) and P15's
 * grants from 26 to 0; any step that cannot write its declared outputs from now on is a deliberate, recorded
 * exception, not a silent one. */
const PINNED_TOTAL = 0;

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
 * The steps whose agent can write but whose `file_ownership` does not cover a declared output's registry path:
 * the retired `no-write-scope` class. Not gaps since P14: the step's claim covers the output, and ownership is
 * not enforced at run time. Kept as an explicit list so the recomputed definition-level fact is visible and any
 * new such step is noticed. It is a ratchet, not a fact about the roles: a piece that changes an agent's
 * `file_ownership` or a step's outputs (P18 aligns both) changes it and updates it deliberately. The first nine are the class as P7 to P13 measured it; the rest are the steps
 * that P15's grants made writable (their roles own a narrower territory than the registry paths of what the
 * steps declare, e.g. a `HandoffRecord` in `reports/handoffs.md` for an agent that owns only its own KB
 * section), plus `plan-stages:review-stages` and `store-release:prepare-store-submission`, which P15 gave
 * `outputs` and which are therefore checked for the first time.
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
  'adopt:gap-analysis',
  'adopt:reverse-derive-specs',
  'define-product:write-prd',
  'define-product:write-ux-spec',
  'define-product:write-vision',
  'discover:define-metrics',
  'discover:frame-problem',
  'fm-mobile/store-release.workflow.yaml:prepare-store-submission',
  'fm-service/contract-test-cycle.workflow.yaml:draft-contract',
  'harden:security-pass',
  'intake:capture-constraints',
  'intake:propose-level',
  'intake:seed-glossary',
  'plan-stage:write-epics',
  'plan-stage:write-test-plan',
  'plan-stages:decompose-stages',
  'plan-stages:review-stages',
  'refactor:state-invariants',
  'replan:impact-analysis',
  'replan:propose-change',
  'retro:run-retro',
  'shape-solution:model-data',
  'shape-solution:threat-model',
  'verify-stage:verify-nfrs',
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

  it('recomputes the retired no-write-scope class from the real definitions: exactly the pinned steps, none of them a gap', () => {
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

  it('the step the live smoke run found (retro:run-retro, Q208 finding 4) is no longer a gap: its agent writes and the output is checked', () => {
    expect(derived.has('retro:run-retro')).toBe(false);
    const retro = declared.find((step) => step.key === 'retro:run-retro');
    expect(retro?.agent).toBe('em');
    expect(retro?.outputTypes).toEqual(['SessionRecord']);
    expect(resolveExtends('em', registry).tools.write).toBe(true);
  });

  it('write-prd runs as pm, the role 05 §5.2 gives the PRD and the capabilities, and pm declares both of its output types', () => {
    const step = declared.find((entry) => entry.key === 'define-product:write-prd');
    expect(step?.agent).toBe('pm');
    const pmOutputs = resolveExtends('pm', registry).outputs.map((output) => output.type);
    for (const type of step?.outputTypes ?? []) expect(pmOutputs, type).toContain(type);
  });

  it('P15 gave outputs to the two steps that declared none, so P7 now covers them (Q208 finding 4 was still live for both)', () => {
    for (const key of [
      'plan-stages:review-stages',
      'fm-mobile/store-release.workflow.yaml:prepare-store-submission',
    ]) {
      const step = declared.find((entry) => entry.key === key);
      expect(step, `${key} declares no outputs`).toBeDefined();
      expect(step?.outputTypes).toEqual(['HandoffRecord']);
    }
  });

  it('every agent step that declares outputs is assigned to a role that can write them or whose report the engine writes (the inventory is empty)', () => {
    expect(derived.size).toBe(0);
    for (const step of declared) {
      if (step.agent.includes('{{')) continue;
      const writes = resolveExtends(step.agent, registry).tools.write;
      expect(writes || engineWritten.includes(step.key), `${step.key} (${step.agent})`).toBe(true);
    }
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
