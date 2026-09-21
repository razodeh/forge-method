/**
 * An empty claim means no write, for every shipped agent step (`PLAN-M13.md` P36, `06` §6.7, `20` §20.1;
 * `SPEC-QUESTIONS.md` Q220 and the P36 entry).
 *
 * `assembleAgentSession` gives a session `write` only when the agent's own grant has it AND the step's claim
 * (`resolveStepClaim`: `produces` plus the paths of declared `outputs`) is non-empty. This is the permanent inventory
 * of the other half of that rule: for EVERY agent step every shipped workflow declares (`WORKFLOW_INDEX` plus every
 * `modules/*\/workflows/*.workflow.yaml`, enumerated rather than named, `onComplete` and failure-escalation steps
 * included), and for EVERY installed copy of the agent that could run it (a module's own copy shadows the core one; a
 * `{{ownerRole}}` step could run any role that produces source code), a `write` grant that survives
 * `resolveStepToolGrant` implies a non-empty claim. A new step whose agent writes and whose claim is empty fails here
 * with the step and agent named, instead of silently running with no write grant (the run would then fail RUN-083 or
 * succeed having done nothing), and a new agent given `tools.write` that some step cannot claim for fails the same way.
 *
 * The end-to-end half (the request the adapter really receives carries that grant) is
 * `agent-prompts-all-workflows.test.ts`, which compares every dispatched step's `tools.write` to its agent's own.
 *
 * @see specs/06 §6.7
 * @see PLAN-M13.md P36
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { docRootsOf, resolveStepClaim } from '@forge/engine/dispatch';
import { compileRunPlan } from '@forge/engine/plan';
import { parseWorkflow, type Workflow, type WorkflowStep } from '@forge/engine/workflow';
import { WORKFLOW_INDEX } from '@forge/templates';

import { resolveStepToolGrant } from '../packages/agents/src/resolve/index.ts';
import {
  isImplementationAgent,
  loadAgentDefinition,
  type AgentDefinition,
} from '../packages/agents/src/schema/index.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');

const FIXTURE_CONTEXT = {
  stage: {
    stories: [
      {
        id: 'story-1',
        owner_role: 'backend',
        test_paths: 'test/story-1.test.ts',
        files_expected: 'src/story-1.ts',
      },
    ],
  },
  run: {
    findings: [{ id: 'defect-1' }],
    testPaths: 'test/story-1.test.ts',
    filesExpected: 'src/story-1.ts',
  },
  vars: { integration_branch: 'forge/integration/stage-1' },
  stageId: 'stage-1',
  storyId: 'story-1',
  ownerRole: 'backend',
  defectId: 'defect-1',
  migrationGoal: 'expand the users table',
  changeSummary: 'add a new field',
  goal: 'extract a shared helper',
  interfaceName: 'orders-api',
  buildTarget: 'ios',
} as const;

const ROOTS = docRootsOf({});

interface AgentCopy {
  readonly module: string;
  readonly agent: AgentDefinition;
}

function loadAgentCopies(): readonly AgentCopy[] {
  const copies: AgentCopy[] = [];
  for (const moduleName of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, moduleName, 'agents');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.agent.yaml'));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      const parsed = loadAgentDefinition(readFileSync(path.join(dir, file), 'utf8'), file);
      if (!parsed.success)
        throw new Error(`${moduleName}/${file}: ${JSON.stringify(parsed.issues)}`);
      copies.push({ module: moduleName, agent: parsed.agent });
    }
  }
  return copies;
}

interface WorkflowSource {
  readonly origin: string;
  readonly module: string;
  readonly workflow: Workflow;
}

function loadWorkflows(): readonly WorkflowSource[] {
  const loaded: WorkflowSource[] = [];
  const parse = (file: string, origin: string, module: string): void => {
    const parsed = parseWorkflow(readFileSync(file, 'utf8'));
    if (!parsed.success) throw new Error(`${origin}: ${JSON.stringify(parsed.issues)}`);
    loaded.push({ origin, module, workflow: parsed.workflow });
  };
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    parse(path.join(templatesRoot, relative), id, 'fm-core');
  }
  for (const moduleName of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files.sort())
      parse(path.join(dir, file), `${moduleName}/${file}`, moduleName);
  }
  return loaded;
}

interface ShippedStep {
  readonly key: string;
  readonly module: string;
  /** The agent field as written (possibly a `{{ownerRole}}` template). */
  readonly agentRef: string;
  readonly claim: readonly string[];
}

function collect(): readonly ShippedStep[] {
  const found: ShippedStep[] = [];
  for (const { origin, module, workflow } of loadWorkflows()) {
    const compiled = compileRunPlan(workflow, FIXTURE_CONTEXT);
    if (!compiled.success) {
      throw new Error(`${origin} fails to compile: ${JSON.stringify(compiled.issues)}`);
    }
    for (const node of compiled.nodes) {
      if (node.kind !== 'agent') continue;
      const rest = node.id.slice(workflow.id.length + 1).split(':')[0] ?? node.id;
      // The agent reference as authored, not as this fixture resolved it: `{{ownerRole}}` is any implementer.
      found.push({
        key: `${origin}:${rest}`,
        module,
        agentRef: authoredAgent(workflow, rest) ?? String(node.agent),
        claim: resolveStepClaim(node, ROOTS, 'warn').globs,
      });
    }
    const hooks: { name: string; step: WorkflowStep }[] = [];
    (workflow.onComplete ?? []).forEach((step, index) => {
      if (step.kind === 'agent') hooks.push({ name: `onComplete[${String(index)}]`, step });
    });
    (workflow.onFailure?.escalations ?? []).forEach((escalation, index) => {
      if (escalation.do.kind === 'agent') {
        hooks.push({ name: `onFailure[${String(index)}]`, step: escalation.do });
      }
    });
    for (const { name, step } of hooks) {
      const declared = step as {
        agent: string;
        outputs?: readonly { type: string }[];
        produces?: string | readonly string[];
      };
      const produces =
        typeof declared.produces === 'string' ? [declared.produces] : (declared.produces ?? []);
      found.push({
        key: `${origin}:${name}`,
        module,
        agentRef: declared.agent,
        claim: resolveStepClaim(
          { kind: 'agent', outputs: declared.outputs ?? [], produces },
          ROOTS,
          'warn',
        ).globs,
      });
    }
  }
  return found;
}

/** The `agent:` a step (or a fanout's child) is authored with. */
function authoredAgent(workflow: Workflow, stepId: string): string | undefined {
  const visit = (steps: readonly WorkflowStep[], inherited?: string): string | undefined => {
    for (const step of steps) {
      const id = inherited ?? step.id;
      if (step.kind === 'parallel' || step.kind === 'sequence') {
        const inner = visit(step.steps);
        if (inner !== undefined) return inner;
      } else if (step.kind === 'fanout') {
        const inner = visit([step.step], step.id);
        if (inner !== undefined) return inner;
      } else if (step.kind === 'agent' && id === stepId) {
        return (step as { agent: string }).agent;
      }
    }
    return undefined;
  };
  return visit(workflow.steps);
}

const copies = loadAgentCopies();
const steps = collect();

/** The agent copies a step could run under (a module's own copy shadows the core one; a templated owner is any
 * implementer, an agent that declares a `Code` output). */
function copiesFor(step: ShippedStep): readonly AgentCopy[] {
  if (step.agentRef.includes('{{')) {
    return copies.filter((copy) => isImplementationAgent(copy.agent));
  }
  const named = copies.filter((copy) => copy.agent.id === step.agentRef);
  if (step.module === 'fm-core') return named;
  const own = named.filter((copy) => copy.module === step.module);
  return own.length > 0 ? own : named.filter((copy) => copy.module === 'fm-core');
}

function canWrite(agent: AgentDefinition): boolean {
  return resolveStepToolGrant({ agent, escalations: [], now: 0 }).grant.write;
}

describe('every shipped agent step: a write grant implies a non-empty claim (P36)', () => {
  it('enumerates for real (a floor against a vacuous pass)', () => {
    expect(steps.length).toBeGreaterThanOrEqual(50);
    expect(copies.length).toBeGreaterThanOrEqual(33);
    expect(steps.filter((step) => step.claim.length > 0).length).toBeGreaterThanOrEqual(45);
    for (const step of steps) {
      expect(
        copiesFor(step).length,
        `${step.key}: no agent copy for "${step.agentRef}"`,
      ).toBeGreaterThan(0);
    }
  });

  it('no step lets a write-capable agent run with an empty claim', () => {
    const problems: string[] = [];
    for (const step of steps) {
      if (step.claim.length > 0) continue;
      for (const copy of copiesFor(step)) {
        if (canWrite(copy.agent)) {
          problems.push(
            `${step.key} runs ${copy.agent.id} (${copy.module}), whose grant has write, with no outputs and no produces: ` +
              'the session gets no write grant, so the step can change nothing. Give the step a claim, or the agent read-only tools.',
          );
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('the nine steps that once had no claim now have a positive one', () => {
    const nine = [
      'debug:fix',
      'harden:fix-findings',
      'implement-story:document',
      'implement-story:refactor',
      'migrate:contract',
      'migrate:expand',
      'quick-fix:fix',
      'quick-fix:write-failing-test',
      'refactor:refactor-code',
    ];
    for (const key of nine) {
      const step = steps.find((candidate) => candidate.key === key);
      expect(step, `no such step: ${key}`).toBeDefined();
      expect(step?.claim.length, key).toBeGreaterThan(0);
    }
  });

  it('a step with an empty claim is a step that cannot write, and the inventory of them is pinned', () => {
    const empty = steps
      .filter((step) => step.claim.length === 0)
      .map((step) => step.key)
      .sort();
    // Read-only by design (critics and reviewers, whose report the engine writes): each runs an agent whose grant has no write.
    for (const key of empty) {
      const step = steps.find((candidate) => candidate.key === key);
      if (step === undefined) throw new Error(key);
      for (const copy of copiesFor(step))
        expect(canWrite(copy.agent), `${key}/${copy.agent.id}`).toBe(false);
    }
  });
});
