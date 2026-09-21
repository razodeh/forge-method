/**
 * Agent `outputs[]` agree with the artifact registry and with the steps that run them
 * (`PLAN-M13.md` P18; `P11-TRIAGE.md` C1, `SPEC-QUESTIONS.md` Q209 and Q220/Q224).
 *
 * Block [5] of every compiled prompt ("Output contract") is rendered from the RUNNING AGENT'S own
 * `outputs[]` (`packages/agents/src/prompt/compile-prompt.ts`), while the output contract check
 * (`packages/engine/src/dispatch/outputs.ts`, P7) demands the STEP's declared `outputs` at the `18` §18.7
 * registry path (`outputGlob`). Until P18 the two disagreed: 18 steps declared an output type their agent's
 * list lacked (so the prompt never mentioned it), five named a different path than the registry, and 22
 * agent declarations named a type the registry does not have. A brief-compliant agent could follow block [5]
 * and fail the check, or write a document (`PRD`, `ArchitectureSpec`) that no claim admits.
 *
 * Derived, not listed: every agent file of every module and every agent step of every shipped workflow
 * (`onComplete` and `onFailure` hooks included; they are not dispatched yet, but the day they are their
 * agents must already agree) are enumerated from disk, and the expectations are computed from the real
 * registry (`artifactTypeById`, `ARTIFACT_SCHEMAS`, `outputGlob`, the very derivation the check uses). The
 * rendered block [5] of a dispatched step is asserted in `test/agent-prompts-all-workflows.test.ts`.
 *
 * Lives at the repository root because it needs `@forge/engine`, `@forge/templates`, `@forge/schemas` and the
 * bare `modules/` directory (`test/workflows.test.ts` documents why no single package may import them).
 *
 * @see specs/05 §5.3
 * @see specs/18 §18.7
 * @see PLAN-M13.md P18
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import * as YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { ArtifactDocument, validateArtifact } from '@forge/core/artifacts';
import { outputGlob } from '@forge/engine/dispatch';
import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { ARTIFACT_SCHEMAS } from '@forge/schemas/json-schema';
import { artifactTypeById } from '@forge/schemas/registry';
import { GATE_INDEX, WORKFLOW_INDEX } from '@forge/templates';

import { loadAgentDefinition } from '../packages/agents/src/schema/load.ts';
import type { AgentDefinition } from '../packages/agents/src/schema/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');
const roots = DEFAULT_CONFIG.paths;
/** `minimatch` exactly as `@forge/vcs` resolves it (the root package does not depend on it). */
const { minimatch } = createRequire(path.join(repoRoot, 'packages', 'vcs', 'package.json'))(
  'minimatch',
) as {
  minimatch: (path: string, glob: string, options?: { dot?: boolean }) => boolean;
};

interface AgentCopy {
  readonly module: string;
  readonly agent: AgentDefinition;
}

/** Every `modules/<m>/agents/*.agent.yaml`, loaded through the real loader (a malformed file fails loudly). */
function loadAgentCopies(): readonly AgentCopy[] {
  const copies: AgentCopy[] = [];
  for (const module of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, module, 'agents');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.agent.yaml'));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      const source = path.join(dir, file);
      const loaded = loadAgentDefinition(readFileSync(source, 'utf8'), source);
      if (!loaded.success)
        throw new Error(`${source} does not load: ${JSON.stringify(loaded.issues)}`);
      copies.push({ module, agent: loaded.agent });
    }
  }
  return copies;
}

/** The artifact types a module adds to the core registry (`module.yaml` `provides.artifactTypes`). */
function moduleArtifactTypes(): ReadonlyMap<string, ReadonlySet<string>> {
  const byModule = new Map<string, ReadonlySet<string>>();
  for (const module of readdirSync(modulesDir)) {
    let text: string;
    try {
      text = readFileSync(path.join(modulesDir, module, 'module.yaml'), 'utf8');
    } catch {
      continue;
    }
    const parsed = YAML.parse(text) as { provides?: { artifactTypes?: string[] } };
    byModule.set(module, new Set(parsed.provides?.artifactTypes ?? []));
  }
  return byModule;
}

interface ShippedStep {
  /** `<workflow id>:<step id>`, module workflows prefixed `<module>/<file>:`. */
  readonly key: string;
  /** `fm-core` for the built-in workflows, else the module directory the workflow lives in. */
  readonly module: string;
  readonly agent: string;
  readonly brief: string | undefined;
  readonly outputTypes: readonly string[];
  /** The subtype of each declared `HandoffRecord` output. */
  readonly handoffSubtypes: readonly string[];
}

function collectSteps(
  origin: string,
  module: string,
  steps: readonly WorkflowStep[],
  into: ShippedStep[],
  inheritedId?: string,
): void {
  for (const step of steps) {
    if (step.kind === 'fanout') collectSteps(origin, module, [step.step], into, step.id);
    else if (step.kind === 'parallel' || step.kind === 'sequence')
      collectSteps(origin, module, step.steps, into);
    else if (step.kind === 'agent') {
      into.push({
        key: `${origin}:${step.id ?? inheritedId ?? step.agent}`,
        module,
        agent: step.agent,
        brief: step.brief,
        outputTypes: (step.outputs ?? []).map((output) => output.type),
        handoffSubtypes: (step.outputs ?? []).flatMap((output) =>
          output.type === 'HandoffRecord' && output.subtype !== undefined ? [output.subtype] : [],
        ),
      });
    }
  }
}

function collectWorkflow(origin: string, module: string, text: string, into: ShippedStep[]): void {
  const parsed = parseWorkflow(text);
  if (!parsed.success) throw new Error(`${origin} does not parse`);
  const { workflow } = parsed;
  collectSteps(origin, module, workflow.steps, into);
  const hooks = [
    ...(workflow.onComplete ?? []),
    ...(workflow.onFailure?.escalations ?? []).map((escalation) => escalation.do),
  ];
  collectSteps(`${origin}[hook]`, module, hooks, into);
}

function shippedSteps(): readonly ShippedStep[] {
  const found: ShippedStep[] = [];
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    collectWorkflow(id, 'fm-core', readFileSync(path.join(templatesRoot, relative), 'utf8'), found);
  }
  for (const module of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, module, 'workflows');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      collectWorkflow(
        `${module}/${file}`,
        module,
        readFileSync(path.join(dir, file), 'utf8'),
        found,
      );
    }
  }
  return found;
}

const copies = loadAgentCopies();
const steps = shippedSteps();
const extraTypes = moduleArtifactTypes();

/**
 * The one output type that is not a document: what an implementation role produces is source code, whose
 * claim is the story's `files_expected` (`06` §6.7), not a registry path. Kept on the code-owner agents
 * because it is true and block [5] should say it; a `Code` output must carry the source glob, never a doc path.
 */
const CODE_OUTPUT = { type: 'Code', schema: 'code-change.schema.json', path: 'src/**' } as const;

/**
 * Agent-declared output types no registry (core or module) defines, and which are allowed to stay because
 * NO shipped workflow runs the agent (`05` §5.2 roles that `P11-TRIAGE.md` B4 defers). Pinned by agent and
 * type; a stale entry (the agent gained a step, or the type was registered) fails, so the list can only
 * shrink. An agent that runs a shipped step never names an unregistered type: block [5] would tell it to
 * write a document nothing checks and, under `strict`, no claim admits.
 */
const UNREGISTERED_ALLOWED_FOR_ROLES_THAT_RUN_NO_STEP: Readonly<Record<string, readonly string[]>> =
  {
    compliance: ['ComplianceMatrix'],
    critic: ['ObjectionList'],
    finops: ['CostModel'],
    techwriter: ['Readme', 'DocsSet'],
    'domain-modeler': ['ContextMap'],
  };

/**
 * The roles a story can name as its `owner_role` (`implement-story`'s `{{ownerRole}}` and `build-stage`'s
 * `{{item.owner_role}}` agents): the implementation roles. Pinned by hand, NOT derived from which agents declare
 * `Code`, because deriving the set from the field under test lets a mutation that deletes `Code` and the step's
 * output together make the agent disappear from its own check. A test below asserts this list equals the agents
 * that declare `Code`, so adding an implementation role (or giving `Code` to another) is a deliberate edit here.
 */
const IMPLEMENTATION_ROLES: readonly string[] = [
  'backend',
  'base-engineer',
  'data-engineer',
  'frontend',
  'ml-engineer',
  'mobile',
];

/** A type is registered for an agent when the core registry has it or the agent's OWN module provides it: fm-data
 * registering a type does not excuse an fm-mobile agent. */
function isRegistered(type: string, module: string): boolean {
  return artifactTypeById(type) !== undefined || (extraTypes.get(module)?.has(type) ?? false);
}

/** Whether any module registers `type` (the allowance below is about types nobody registers). */
function isRegisteredAnywhere(type: string): boolean {
  return (
    artifactTypeById(type) !== undefined ||
    [...extraTypes.values()].some((types) => types.has(type))
  );
}

/** The agent copies a step's agent could be resolved to at run time (a module's own copy shadows the core one). */
function copiesFor(step: ShippedStep): readonly AgentCopy[] {
  if (step.agent.includes('{{')) {
    // A run-time owner role: any implementation role. Every one of them must list what the step declares.
    return copies.filter((copy) => IMPLEMENTATION_ROLES.includes(copy.agent.id));
  }
  const named = copies.filter((copy) => copy.agent.id === step.agent);
  if (step.module === 'fm-core') return named; // any installed copy may shadow the core one
  const own = named.filter((copy) => copy.module === step.module);
  return own.length > 0 ? own : named.filter((copy) => copy.module === 'fm-core');
}

describe('agent outputs[] agree with the artifact registry (P18, C1)', () => {
  it('enumerates the roster and the steps for real (a floor against a vacuous pass)', () => {
    // Exact: deleting an agent file (or adding one) is a deliberate edit of this number, not a silent pass.
    expect(copies.length).toBe(34);
    expect(steps.length).toBeGreaterThanOrEqual(60);
    expect(steps.filter((step) => step.outputTypes.length > 0).length).toBeGreaterThanOrEqual(42);
  });

  it('every output an agent declares whose type is registered carries the registry schema and the registry path', () => {
    const problems: string[] = [];
    for (const { module, agent } of copies) {
      for (const output of agent.outputs) {
        const definition = artifactTypeById(output.type);
        if (definition === undefined) {
          // A type the agent's own module registers has no core registry row to compare with, but a path with a
          // `{placeholder}` is a promise nothing keeps (no code substitutes it): it must be a glob like the rest.
          if (isRegistered(output.type, module) && /\{\w+\}/.test(output.path)) {
            problems.push(
              `${module}/${agent.id}: ${output.type} path ${output.path} has a placeholder, use a glob`,
            );
          }
          continue;
        }
        const stem = ARTIFACT_SCHEMAS[definition.id].fileStem;
        const wantPath = outputGlob(definition.id, roots);
        // One file per instance (a `{id}` or `{name}` in the registry template) is `many`; a single file or a
        // register is not (the agent schema has no `one`, so the field is absent for those).
        const wantCardinality = /\{\w+\}/.test(definition.pathTemplate) ? 'many' : undefined;
        if (output.cardinality !== wantCardinality) {
          problems.push(
            `${module}/${agent.id}: ${output.type} has cardinality ${String(output.cardinality)}, the registry's template ${definition.pathTemplate} means ${String(wantCardinality)}`,
          );
        }
        if (output.schema !== `${stem}.schema.json`) {
          problems.push(
            `${module}/${agent.id}: ${output.type} names schema ${output.schema}, the registry's is ${stem}.schema.json`,
          );
        }
        if (output.path !== wantPath) {
          problems.push(
            `${module}/${agent.id}: ${output.type} names path ${output.path}, the registry's (outputGlob) is ${wantPath}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('no agent that runs a shipped step names an output type the registry lacks, except Code', () => {
    const running = new Set(steps.flatMap((step) => copiesFor(step).map((copy) => copy.agent.id)));
    const problems: string[] = [];
    for (const { module, agent } of copies) {
      for (const output of agent.outputs) {
        if (isRegistered(output.type, module)) continue;
        if (output.type === CODE_OUTPUT.type) {
          if (output.path !== CODE_OUTPUT.path || output.schema !== CODE_OUTPUT.schema) {
            problems.push(
              `${module}/${agent.id}: Code must be ${CODE_OUTPUT.schema} at ${CODE_OUTPUT.path}`,
            );
          }
          continue;
        }
        const allowed = UNREGISTERED_ALLOWED_FOR_ROLES_THAT_RUN_NO_STEP[agent.id] ?? [];
        if (running.has(agent.id) || !allowed.includes(output.type)) {
          problems.push(
            `${module}/${agent.id}: names ${output.type}, which no registry defines${running.has(agent.id) ? ' (and the agent runs a shipped step)' : ''}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the allowance for unregistered types is not stale: each entry names a type its agent still declares, on an agent no step runs', () => {
    const running = new Set(steps.flatMap((step) => copiesFor(step).map((copy) => copy.agent.id)));
    for (const [agentId, types] of Object.entries(
      UNREGISTERED_ALLOWED_FOR_ROLES_THAT_RUN_NO_STEP,
    )) {
      expect(running.has(agentId), `${agentId} now runs a shipped step`).toBe(false);
      const declared = copies
        .filter((copy) => copy.agent.id === agentId)
        .flatMap((copy) => copy.agent.outputs.map((output) => output.type));
      for (const type of types) {
        expect(declared, `${agentId} no longer declares ${type}`).toContain(type);
        expect(isRegisteredAnywhere(type), `${type} is registered now: drop the allowance`).toBe(
          false,
        );
      }
    }
  });

  it('every output type a shipped step declares is in the outputs[] of the agent that runs it (block [5] names it)', () => {
    const problems: string[] = [];
    for (const step of steps) {
      const candidates = copiesFor(step);
      if (candidates.length === 0)
        problems.push(`${step.key}: agent ${step.agent} has no definition`);
      for (const { module, agent } of candidates) {
        const listed = new Set(agent.outputs.map((output) => output.type));
        for (const type of step.outputTypes) {
          if (!listed.has(type)) {
            problems.push(`${step.key}: ${module}/${agent.id} does not list ${type} in outputs[]`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the pinned implementation roles are exactly the agents that declare Code, in every module copy', () => {
    const withCode = new Set(
      copies
        .filter((copy) => copy.agent.outputs.some((output) => output.type === 'Code'))
        .map((copy) => copy.agent.id),
    );
    expect([...withCode].sort()).toEqual([...IMPLEMENTATION_ROLES].sort());
    for (const id of IMPLEMENTATION_ROLES) {
      for (const copy of copies.filter((entry) => entry.agent.id === id)) {
        expect(
          copy.agent.outputs.map((output) => output.type),
          `${copy.module}/${id}`,
        ).toContain('Code');
      }
    }
  });

  it('no agent lists the same type twice', () => {
    for (const { module, agent } of copies) {
      const types = agent.outputs.map((output) => output.type);
      expect(new Set(types).size, `${module}/${agent.id}: ${types.join(', ')}`).toBe(types.length);
    }
  });
});

describe('the briefs tell an agent to record the subtype where the output check reads it (P18, C2)', () => {
  const briefDir = path.join(templatesRoot, 'templates', 'briefs');
  const withSubtype = steps.filter((step) => step.handoffSubtypes.length > 0);

  // Pinned so that a step which drops its `subtype:` key (and so leaves the it.each below) is noticed. Additions are
  // allowed: each new one is covered by the it.each.
  const PINNED_SUBTYPES = [
    'adoption-gap-analysis',
    'change-proposal',
    'impact-analysis',
    'implementation-plan',
    'level-proposal',
    'nfr-verification',
    'observability-plan',
    'refactor-invariants',
    'stage-plan',
    'stage-plan-review',
    'store-submission-record',
    'test-plan',
    'threat-model',
    'ux-spec',
  ];

  it('enumerates the HandoffRecord steps for real: every pinned subtype is still declared by a shipped step', () => {
    const declared = withSubtype.flatMap((step) => step.handoffSubtypes);
    for (const subtype of PINNED_SUBTYPES) expect(declared, subtype).toContain(subtype);
  });

  // P7 (`outputs.ts`, `subtypeText`) reads a register entry's `step` and its `subtype: X` `delivered` items, and
  // nothing else: a HandoffRecord has no `subtype` key. Five briefs (`propose-level`, `decompose-stages`,
  // `verify-nfrs`, `state-refactor-invariants`, `plan-story`) gave only a `step` naming the NEXT node, so a
  // brief-compliant agent failed the check. Every brief now asks for the `delivered` line, by name.
  it.each(
    withSubtype.flatMap((step) => step.handoffSubtypes.map((subtype) => [step, subtype] as const)),
  )('%s: the brief makes `subtype: %s` the first string in `delivered`', (step, subtype) => {
    expect(step.brief, `${step.key} declares no brief`).toBeDefined();
    const text = readFileSync(
      path.join(templatesRoot, 'templates', step.brief ?? ''),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(text).toMatch(
      new RegExp(
        `first (?:string in \`delivered\`|\`delivered\` entry)[^.]{0,80}\`subtype: ${subtype}\``,
      ),
    );
    // The old wording said the subtype rides in `step`, which the five briefs then contradicted.
    expect(text).not.toMatch(/recorded as its `step` value/);
  });

  it('the shipped briefs directory has no other brief that still says the subtype rides in `step`', () => {
    for (const file of readdirSync(briefDir)) {
      const text = readFileSync(path.join(briefDir, file), 'utf8').replace(/\s+/g, ' ');
      expect(text, file).not.toMatch(/recorded as its `step` value/);
    }
  });
});

/**
 * The steps upstream (transitively, through `dependsOn`) of each `gate` step of each shipped workflow, and the
 * output types the agent steps among them declare. `evidence:` in a gate file is what the approving human is
 * shown (`10` §10.3), so an evidence type nothing upstream produces (`G-Problem` listed `Vision`, which
 * `define-product:write-vision` writes AFTER the gate) makes the approval page promise an artifact the run
 * cannot have made.
 */
interface GateRun {
  readonly workflow: string;
  readonly gate: string;
  readonly upstreamTypes: ReadonlySet<string>;
}

function gateRuns(): readonly GateRun[] {
  const runs: GateRun[] = [];
  const sources: { origin: string; text: string }[] = Object.entries(WORKFLOW_INDEX).map(
    ([id, relative]) => ({
      origin: id,
      text: readFileSync(path.join(templatesRoot, relative), 'utf8'),
    }),
  );
  for (const module of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, module, 'workflows');
    let files: string[];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      sources.push({
        origin: `${module}/${file}`,
        text: readFileSync(path.join(dir, file), 'utf8'),
      });
    }
  }
  for (const { origin, text } of sources) {
    const parsed = parseWorkflow(text);
    if (!parsed.success) throw new Error(`${origin} does not parse`);
    const byId = new Map(parsed.workflow.steps.map((step) => [step.id, step] as const));
    const typesOf = (step: WorkflowStep): string[] => {
      if (step.kind === 'fanout') return typesOf(step.step);
      if (step.kind === 'parallel' || step.kind === 'sequence') return step.steps.flatMap(typesOf);
      return step.kind === 'agent' ? (step.outputs ?? []).map((output) => output.type) : [];
    };
    for (const step of parsed.workflow.steps) {
      if (step.kind !== 'gate') continue;
      const seen = new Set<string>();
      const walk = (rawId: string): void => {
        // A per-item dependency (`review:{{item.id}}`) names the fanout step that expands it.
        const id = rawId.replace(/:\{\{[^}]*\}\}$/, '');
        const node = byId.get(id);
        // Fail closed: a dependency this walk cannot resolve would silently shrink the upstream set.
        if (node === undefined)
          throw new Error(`${origin}: ${step.id ?? step.gate} depends on unknown step ${id}`);
        if (seen.has(id)) return;
        seen.add(id);
        for (const dependency of node.dependsOn ?? []) walk(dependency);
      };
      for (const dependency of step.dependsOn ?? []) walk(dependency);
      const upstreamTypes = new Set(
        [...seen].flatMap((id) => {
          const node = byId.get(id);
          return node === undefined ? [] : typesOf(node);
        }),
      );
      runs.push({ workflow: origin, gate: step.gate, upstreamTypes });
    }
  }
  return runs;
}

/** Evidence types of one shipped gate file, `(*)` stripped. */
function evidenceTypes(gateId: string): readonly string[] {
  const relative = (GATE_INDEX as Readonly<Record<string, string>>)[gateId];
  if (relative === undefined) throw new Error(`no shipped gate ${gateId}`);
  const parsed = YAML.parse(readFileSync(path.join(templatesRoot, relative), 'utf8')) as {
    evidence?: { artifact: string }[];
  };
  return (parsed.evidence ?? []).map((entry) => entry.artifact.replace(/\(\*\)$/, ''));
}

describe('a gate lists as evidence what the steps before it produce (P18, E3)', () => {
  const runs = gateRuns();

  it('enumerates the gate steps for real', () => {
    expect(runs.length).toBe(15);
  });

  it('G-Problem lists no artifact that a step after the gate writes: its evidence is the discover steps output', () => {
    const problems = runs.filter((run) => run.gate === 'G-Problem');
    expect(problems.map((run) => run.workflow)).toEqual(['discover']);
    const evidence = evidenceTypes('G-Problem');
    expect(evidence).not.toContain('Vision');
    expect(evidence.length).toBeGreaterThan(0);
    for (const run of problems) {
      for (const type of evidence) {
        expect(run.upstreamTypes.has(type), `${type} is not produced before problem-gate`).toBe(
          true,
        );
      }
    }
  });

  it('the success-metrics wording of the G-Problem critique brief matches where metrics live (KB entries, not NFRs)', () => {
    const text = readFileSync(
      path.join(templatesRoot, 'templates', 'briefs', 'critique-problem-framing.md'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(text).toContain('`product/metrics.md`, which are not NFRs');
  });

  /**
   * Evidence types with no producing step upstream of the gate, pinned so the list can only shrink (each entry is a
   * gate whose approval page promises an artifact no run makes). They are NOT fixed here: `10` §10.3's own `G-Design`
   * example names `ArchitectureSpec` and `ThreatModel` (types the registry never had; `10`'s header shows the
   * precedent of correcting such an example), and the rest name registers no step declares. Nothing reads `evidence:`
   * (`GateDefinition` models only id, checks and open-questions policy), so this is documentation drift, not a
   * runtime hole. `SPEC-QUESTIONS.md` Q224 lists them for the orchestrator.
   */
  const KNOWN_UNPRODUCED_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
    // `build-stage` re-runs G-Design over the design `shape-solution` made in an EARLIER workflow (legitimate
    // cross-workflow evidence, so ADR and DataModel show up); the two unregistered types are the drift.
    'build-stage:G-Design': ['ArchitectureSpec', 'ADR', 'DataModel', 'ThreatModel'],
    'shape-solution:G-Design': ['ArchitectureSpec', 'ThreatModel'],
    'deliver-stage:G-Deliver': ['Environment', 'Runbook'],
    'fm-mobile/store-release.workflow.yaml:G-Deliver': ['Environment', 'Runbook'],
    'initialize-project:G-Foundation': ['Environment'],
    'build-stage:G-Verify': ['GateReport'],
    'verify-stage:G-Verify': ['GateReport'],
    'fm-mobile/store-release.workflow.yaml:G-Verify': ['GateReport'],
    'fm-service/contract-test-cycle.workflow.yaml:G-Verify': ['GateReport'],
    'harden:G-Stable': ['RCA'],
  };

  it('every gate lists as evidence only artifacts a step upstream of it declares, except the pinned known drift', () => {
    const found: Record<string, string[]> = {};
    for (const run of runs) {
      const missing = evidenceTypes(run.gate).filter((type) => !run.upstreamTypes.has(type));
      if (missing.length > 0) found[`${run.workflow}:${run.gate}`] = missing;
    }
    expect(found).toEqual(KNOWN_UNPRODUCED_EVIDENCE);
  });
});

describe('the deliver-stage diagrams live where 08 §8.11.3 puts them (P18, Q216 open item)', () => {
  const spec = readFileSync(path.join(repoRoot, 'specs', '08-knowledge-body.md'), 'utf8');
  const briefsDir = path.join(templatesRoot, 'templates', 'briefs');
  const brief = (name: string): string =>
    readFileSync(path.join(briefsDir, name), 'utf8').replace(/\s+/g, ' ');
  const sre = copies.find((copy) => copy.module === 'fm-core' && copy.agent.id === 'sre')?.agent;

  it('the spec table gives the pipeline and deployment diagrams delivery/views', () => {
    expect(spec).toMatch(/`delivery\/views\/deployment-<env>\.mmd`/);
    expect(spec).toMatch(/`delivery\/views\/pipeline\.mmd`/);
  });

  it('the two briefs name exactly those locations, and neither still sends the diagram to delivery/pipeline/', () => {
    expect(brief('design-cicd-pipeline.md')).toContain(
      '`docs/forge/kb/delivery/views/pipeline.mmd`',
    );
    expect(brief('design-deployment-strategy.md')).toContain(
      '`docs/forge/kb/delivery/views/deployment-<env>.mmd`',
    );
    for (const name of ['design-cicd-pipeline.md', 'design-deployment-strategy.md']) {
      expect(brief(name), name).not.toContain('delivery/pipeline/`');
    }
  });

  it('the sre role owns and may write the views directory, and both steps claim the diagrams and their sidecars', () => {
    expect(sre?.parallel_safety.file_ownership).toContain('docs/forge/kb/delivery/views/**');
    expect(sre?.kb_write).toContain('delivery/views/**');
    const owned = sre?.parallel_safety.file_ownership ?? [];
    for (const sample of [
      'docs/forge/kb/delivery/views/pipeline.mmd',
      'docs/forge/kb/delivery/views/deployment-staging.mmd.yaml',
    ]) {
      expect(
        owned.some((glob) => minimatch(sample, glob, { dot: true })),
        sample,
      ).toBe(true);
    }
    const workflow = readFileSync(
      path.join(templatesRoot, 'templates', 'workflows', 'deliver-stage.workflow.yaml'),
      'utf8',
    );
    for (const claimed of [
      "'docs/forge/kb/delivery/views/pipeline.mmd'",
      "'docs/forge/kb/delivery/views/pipeline.mmd.yaml'",
      "'docs/forge/kb/delivery/views/deployment-*.mmd'",
      "'docs/forge/kb/delivery/views/deployment-*.mmd.yaml'",
    ]) {
      expect(workflow).toContain(claimed);
    }
  });
});

describe('every ADR output template carries the sections the registry requires (P18, C6)', () => {
  const required = artifactTypeById('ADR')?.requiredSections ?? [];
  const templateFiles: { label: string; file: string }[] = [];
  const core = path.join(templatesRoot, 'templates');
  for (const name of readdirSync(core).filter((entry) => /^adr-.*\.md\.hbs$/.test(entry))) {
    templateFiles.push({ label: name, file: path.join(core, name) });
  }
  for (const module of readdirSync(modulesDir).sort()) {
    const dir = path.join(modulesDir, module, 'templates');
    let names: string[];
    try {
      names = readdirSync(dir).filter((entry) => /^adr-.*\.md\.hbs$/.test(entry));
    } catch {
      continue;
    }
    for (const name of names)
      templateFiles.push({ label: `${module}/${name}`, file: path.join(dir, name) });
  }

  const populated = {
    seq: '0001',
    title: 'A representative decision title',
    status: 'accepted',
    deciders: ['architect'],
    date: '2026-01-15',
    author: 'architect',
    reversibility: 'medium',
    blastRadius: ['delivery/build.md'],
    revisitTrigger: 'the team doubles in size',
    supersedes: [],
    related: [],
    diagrams: ['DIAG-001'],
    changelogSummary: 'Initial decision.',
    context: 'A context paragraph.',
    chosenOption: 'the-chosen-option',
    criteria: [{ id: 'fit', weight: 1 }],
    scoreTable: '| Option | fit |\n|---|---|\n| the-chosen-option | 5 |',
    killerRisk: 'A killer risk.',
    reversalPlan: 'A representative reversal plan.',
    consequences: 'A consequences paragraph.',
    alternativesConsidered: 'An alternatives paragraph.',
  };
  const bare = {
    ...populated,
    reversalPlan: undefined,
    diagrams: [],
    criteria: undefined,
    alternativesConsidered: undefined,
  };

  it('enumerates the 43 framework templates and the fm-service one (a floor against a vacuous pass)', () => {
    expect(required).toEqual([
      'Context',
      'Options considered',
      'Decision',
      'Diagram',
      'Consequences',
      'Reversal plan',
    ]);
    expect(templateFiles.length).toBe(44);
  });

  it.each(
    templateFiles.flatMap(({ label, file }) => [
      [label, 'populated', file, populated] as const,
      [label, 'bare', file, bare] as const,
    ]),
  )(
    '%s (%s fixture) renders an ADR that the real validateArtifact accepts, sections included',
    (label, _name, file, fixture) => {
      const rendered = Handlebars.compile(readFileSync(file, 'utf8'))(fixture);
      // Both branches of the new Reversal plan section are reached: a supplied plan, else the record's own
      // reversibility and revisit trigger.
      expect(rendered).toContain(
        fixture.reversalPlan === undefined
          ? 'Reversibility: medium. Revisit when: the team doubles in size.'
          : 'A representative reversal plan.',
      );
      const document = ArtifactDocument.parse(rendered, 'docs/forge/kb/decisions/ADR-0001-x.md');
      const outcome = validateArtifact(document);
      expect(
        outcome.valid ? [] : outcome.errors.map((error) => error.message),
        `${label} failed validateArtifact`,
      ).toEqual([]);
    },
  );
});
