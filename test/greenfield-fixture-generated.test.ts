/**
 * `fixtures/greenfield-service/.forge` is a snapshot of what `forge init` generates, and it must not go stale
 * (`PLAN-M13.md` P18, `P11-TRIAGE.md` F3; `SPEC-QUESTIONS.md` Q205 limit 7, Q220, Q224).
 *
 * The snapshot used to be frozen at the M6 exit test: agents with `write: false`, `write-prd` on `po`, old
 * `prompt.briefs` keys, a G-Problem that listed a Vision nothing had written yet. Nothing loads those files as
 * agents, so nothing noticed for seven milestones; it was found by reading. This guard derives what the
 * snapshot must say from the shipped source, so the next definition edit that forgets the fixture fails here:
 *
 *  1. every generated file carries a `forge:generated` header whose hash still matches its body (nobody
 *     hand-edited it; `03` §3.3);
 *  2. every fixture agent is, field for field, the agent `forge init` resolves from every module's agents directory (`extends`
 *     flattened, a module's own copy of a role winning over the core one);
 *  3. every step of every fixture workflow names the same agent, brief and declared outputs as the shipped
 *     workflow (the fields P18 keeps coherent; other fields, such as `produces`, are not compared, and a step
 *     added to the shipped workflow after the snapshot is tolerated, so that a piece which only edits a claim or
 *     adds a step does not have to regenerate the snapshot);
 *  4. every fixture gate lists the same evidence as the shipped gate.
 *
 * Regenerate the snapshot with `forge init` into a scratch directory and copy `.forge/{agents,checks,
 * frameworks,skills,templates,workflows,briefs,prompts}` and `manifest.yaml` over it (never edit a hash-headed file by hand).
 *
 * @see specs/03 §3.3
 * @see PLAN-M13.md P18
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { GATE_INDEX, WORKFLOW_INDEX } from '@forge/templates';

import type { AbsolutePath } from '@forge/core';

import { hasGeneratedFileDrifted } from '../packages/cli/src/generated-header.ts';
import { loadAgentRegistry, resolveExtends } from '../packages/agents/src/registry/index.ts';
import { loadAgentDefinition } from '../packages/agents/src/schema/load.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureForge = path.join(repoRoot, 'fixtures', 'greenfield-service', '.forge');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');
const GENERATED_DIRS = [
  'agents',
  'checks',
  'frameworks',
  'skills',
  'templates',
  'workflows',
  'briefs',
  'prompts',
  // `PLAN-M14.md` P29: `.forge/techniques/`, the flat, materialised technique library.
  'techniques',
] as const;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortKeys(child)]),
  );
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

/** The step facts P18 keeps coherent, keyed by step id (fanout children by their fanout's id). */
function stepFacts(
  steps: readonly WorkflowStep[],
  into: Record<string, unknown>,
  inherited?: string,
): void {
  for (const step of steps) {
    if (step.kind === 'fanout') stepFacts([step.step], into, step.id);
    else if (step.kind === 'parallel' || step.kind === 'sequence') stepFacts(step.steps, into);
    else if (step.kind === 'agent') {
      into[step.id ?? inherited ?? step.agent] = {
        agent: step.agent,
        brief: step.brief,
        outputs: step.outputs ?? [],
      };
    }
  }
}

function workflowFacts(text: string, label: string): Record<string, unknown> {
  const parsed = parseWorkflow(text);
  if (!parsed.success) throw new Error(`${label} does not parse`);
  const facts: Record<string, unknown> = {};
  stepFacts(parsed.workflow.steps, facts);
  stepFacts(
    [
      ...(parsed.workflow.onComplete ?? []),
      ...(parsed.workflow.onFailure?.escalations ?? []).map((escalation) => escalation.do),
    ],
    facts,
  );
  return facts;
}

describe('fixtures/greenfield-service/.forge is what forge init generates today (P18, F3)', () => {
  const generated = GENERATED_DIRS.flatMap((dir) => filesUnder(path.join(fixtureForge, dir)));

  it('has the generated tree at all (a floor against a vacuous pass)', () => {
    expect(generated.length).toBeGreaterThan(100);
    expect(readdirSync(path.join(fixtureForge, 'agents')).length).toBeGreaterThanOrEqual(29);
    // `PLAN-M14.md` P29: `16` §16.4's own 25 real technique files (`@forge/sessions/technique/load.ts`'s
    // own header has the identical count and reasoning).
    expect(readdirSync(path.join(fixtureForge, 'techniques')).length).toBe(25);
  });

  it('no generated file was hand-edited: each header hash matches its body', () => {
    const edited = generated.filter((file) => hasGeneratedFileDrifted(readFileSync(file, 'utf8')));
    expect(edited.map((file) => path.relative(fixtureForge, file))).toEqual([]);
  });

  it('every fixture agent is the agent forge init resolves from the shipped modules, field for field', async () => {
    // `forge init` writes each agent with `extends` flattened, and a module's own copy of a role (fm-service's
    // integration-architect, fm-mobile's mobile) wins over the fm-core one: `resolveExtends` over the registry of
    // every module is that same resolution.
    const registry = await loadAgentRegistry(path.join(repoRoot, 'modules') as AbsolutePath);
    const problems: string[] = [];
    for (const file of readdirSync(path.join(fixtureForge, 'agents')).sort()) {
      const id = file.replace(/\.yaml$/, '');
      const fixture = loadAgentDefinition(
        readFileSync(path.join(fixtureForge, 'agents', file), 'utf8'),
        file,
      );
      if (!fixture.success) {
        problems.push(`${id}: does not load`);
        continue;
      }
      const shipped = resolveExtends(id, registry);
      // Compared through JSON: key order is not part of a definition.
      if (JSON.stringify(sortKeys(fixture.agent)) !== JSON.stringify(sortKeys(shipped))) {
        problems.push(`${id}: differs from what forge init resolves from modules/*/agents`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every fixture technique is the shipped modules/fm-core/techniques file, verbatim (its own generated header aside) (PLAN-M14.md P29)', () => {
    const problems: string[] = [];
    const files = readdirSync(path.join(fixtureForge, 'techniques')).filter((file) =>
      file.endsWith('.technique.yaml'),
    );
    expect(files.length).toBe(25);
    for (const file of files) {
      const fixtureContent = readFileSync(path.join(fixtureForge, 'techniques', file), 'utf8');
      // No front matter in a `.technique.yaml` file: the header is one prepended `# ...\n` line
      // (`withGeneratedHeader`'s own doc comment, `@forge/cli/init`), so the real body starts right
      // after the first newline.
      const body = fixtureContent.slice(fixtureContent.indexOf('\n') + 1);
      const shippedPath = path.join(repoRoot, 'modules', 'fm-core', 'techniques', file);
      let shipped: string;
      try {
        shipped = readFileSync(shippedPath, 'utf8');
      } catch {
        problems.push(`${file}: no shipped modules/fm-core/techniques file`);
        continue;
      }
      if (body !== shipped) problems.push(`${file}: differs from the shipped file`);
    }
    expect(problems).toEqual([]);
  });

  it('every fixture workflow names the same agent, brief and outputs for each step as the shipped workflow', () => {
    const problems: string[] = [];
    const files = readdirSync(path.join(fixtureForge, 'workflows')).filter((file) =>
      file.endsWith('.workflow.yaml'),
    );
    expect(files.sort()).toEqual(
      Object.keys(WORKFLOW_INDEX)
        .map((id) => `${id}.workflow.yaml`)
        .sort(),
    );
    for (const file of files) {
      const id = file.replace(/\.workflow\.yaml$/, '');
      const relative = (WORKFLOW_INDEX as Readonly<Record<string, string>>)[id];
      if (relative === undefined) continue;
      const fixture = workflowFacts(
        readFileSync(path.join(fixtureForge, 'workflows', file), 'utf8'),
        file,
      );
      const shipped = workflowFacts(
        readFileSync(path.join(templatesRoot, relative), 'utf8'),
        relative,
      );
      // A step the snapshot has must still say what the shipped step says (or no longer exist in the shipped
      // workflow). A step ADDED to the shipped workflow after the snapshot was taken makes the snapshot
      // incomplete, not wrong: it is tolerated so that a piece that adds a step does not fail this test for a
      // fixture it has no reason to touch (regenerate the snapshot when convenient).
      for (const step of Object.keys(fixture)) {
        if (JSON.stringify(fixture[step]) !== JSON.stringify(shipped[step])) {
          problems.push(`${id}:${step}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every brief and prompt a fixture agent or workflow references exists in the snapshot (a run over it would die on RUN-079 otherwise)', () => {
    const missing: string[] = [];
    const referenced = new Set<string>();
    for (const file of readdirSync(path.join(fixtureForge, 'agents'))) {
      const agent = YAML.parse(readFileSync(path.join(fixtureForge, 'agents', file), 'utf8')) as {
        prompt?: { system?: string; briefs?: Record<string, string> };
      };
      if (agent.prompt?.system !== undefined) referenced.add(agent.prompt.system);
      for (const briefPath of Object.values(agent.prompt?.briefs ?? {})) referenced.add(briefPath);
    }
    for (const file of readdirSync(path.join(fixtureForge, 'workflows'))) {
      for (const match of readFileSync(path.join(fixtureForge, 'workflows', file), 'utf8').matchAll(
        /^\s*brief:\s*(briefs\/[\w.-]+\.md)\s*$/gm,
      )) {
        referenced.add(match[1] ?? '');
      }
    }
    expect(referenced.size).toBeGreaterThan(100);
    for (const reference of referenced) {
      try {
        statSync(path.join(fixtureForge, reference));
      } catch {
        missing.push(reference);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every fixture gate lists the evidence the shipped gate lists', () => {
    const problems: string[] = [];
    for (const [id, relative] of Object.entries(GATE_INDEX)) {
      const fixture = YAML.parse(
        readFileSync(path.join(fixtureForge, 'checks', `${id}.gate.yaml`), 'utf8'),
      ) as { evidence?: unknown };
      const shipped = YAML.parse(readFileSync(path.join(templatesRoot, relative), 'utf8')) as {
        evidence?: unknown;
      };
      if (JSON.stringify(fixture.evidence) !== JSON.stringify(shipped.evidence)) problems.push(id);
    }
    expect(problems).toEqual([]);
  });
});
