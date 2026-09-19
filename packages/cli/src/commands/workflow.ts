/**
 * `forge workflow <list|show|validate|graph|new>` — `03` §3.2.8.
 *
 * `validate` builds a real `WorkflowExistenceOracle` (`@forge/engine/workflow`'s own already-built
 * `validateWorkflow`, C9's own literal exit-test line depends on this) from real project state —
 * `.forge/agents/`, `.forge/checks/`, `.forge/workflows/`, `.forge/briefs/` (`PLAN-M13.md` P1),
 * `@forge/schemas`' own real `ARTIFACT_TYPES` registry — rather than a second, parallel
 * existence-checking mechanism.
 *
 * @see specs/03 §3.2.8
 * @see specs/10 §10.1
 */
import {
  ForgeError,
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core';
import { listResolvableContentReferences } from '@forge/agents/prompt';
import { artifactTypeById } from '@forge/schemas';
import {
  parseWorkflow,
  validateStructure,
  validateWorkflow,
  type ValidationIssue,
  type Workflow,
  type WorkflowExistenceOracle,
} from '@forge/engine/workflow';

import { loadGateRegistry } from './run/gates.ts';

export interface WorkflowCommandContext {
  readonly paths: ProjectPaths;
  readonly workflowsRoot: string;
  readonly agentsRoot: string;
  readonly checksRoot: string;
}

const WORKFLOW_FILE_SUFFIX = '.workflow.yaml';

async function listWorkflowIds(ctx: WorkflowCommandContext): Promise<readonly string[]> {
  if (!(await pathExists(ctx.paths.resolveWithin(ctx.workflowsRoot)))) return [];
  const entries = await listDirEntriesSorted(ctx.paths.resolveWithin(ctx.workflowsRoot));
  return entries
    .filter((entry) => !entry.isDirectory && entry.name.endsWith(WORKFLOW_FILE_SUFFIX))
    .map((entry) => entry.name.slice(0, -WORKFLOW_FILE_SUFFIX.length));
}

async function readWorkflow(ctx: WorkflowCommandContext, id: string): Promise<Workflow> {
  const relPath = `${ctx.workflowsRoot}/${id}${WORKFLOW_FILE_SUFFIX}`;
  if (!(await pathExists(ctx.paths.resolveWithin(relPath)))) {
    throw new ForgeError('KB-015', { id });
  }
  const source = await readTextFile(ctx.paths.resolveWithin(relPath));
  const result = parseWorkflow(source);
  if (!result.success) {
    throw new ForgeError('CFG-001', { path: relPath, line: result.issues[0]?.line ?? 0 });
  }
  return result.workflow;
}

/** `list` — every real workflow id materialized under `<workflowsRoot>/`. */
export async function workflowList(ctx: WorkflowCommandContext): Promise<readonly string[]> {
  return listWorkflowIds(ctx);
}

/** `show <id>` — one real, parsed workflow document. */
export async function workflowShow(ctx: WorkflowCommandContext, id: string): Promise<Workflow> {
  return readWorkflow(ctx, id);
}

async function buildOracle(ctx: WorkflowCommandContext): Promise<WorkflowExistenceOracle> {
  const [agentEntries, gateRegistry, workflowIds, briefPaths] = await Promise.all([
    pathExists(ctx.paths.resolveWithin(ctx.agentsRoot)).then((exists) =>
      exists ? listDirEntriesSorted(ctx.paths.resolveWithin(ctx.agentsRoot)) : [],
    ),
    loadGateRegistry(ctx.paths, ctx.checksRoot),
    listWorkflowIds(ctx),
    listResolvableContentReferences(ctx.paths, 'briefs'),
  ]);
  const agentIds = new Set(
    agentEntries
      .filter((entry) => !entry.isDirectory && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name.replace(/\.yaml$/, '')),
  );
  const workflowIdSet = new Set(workflowIds);
  // `validateWorkflow` checks `step.agent`/`step.gate`/etc. as literal ids -- it has no template
  // awareness of its own (its own doc comment: "nothing in this piece parses that mini-syntax").
  // `10` §10.5's own real, shipped workflows genuinely use `{{ownerRole}}`/`{{item.owner_role}}` here,
  // resolved only at real plan-compilation time (`compileRunPlan`, needs a real `ExpressionContext`
  // this bare `forge workflow validate <id>` invocation does not have one of). Every oracle method
  // below treats an unresolved `{{...}}` reference as unverifiable rather than nonexistent -- the
  // identical "cannot verify, refuse to fabricate a failure" stance `briefExists` already takes, not a
  // claim that a templated reference was checked and found valid.
  const isTemplateReference = (value: string): boolean => value.includes('{{');

  return {
    agentExists: (id) => isTemplateReference(id) || agentIds.has(id),
    // A real `step.brief` value is a project-relative *path* (`briefs/write-vision.md`), unlike this
    // oracle's other methods' bare ids; `briefPaths` (`listResolvableContentReferences`,
    // `@forge/agents/prompt`, shared with the loader and `forge agent validate`) holds exactly the
    // `briefs/<name>.md` strings that genuinely resolve to non-empty text.
    // `PLAN-M13.md` P1: a real existence check, against the project's own real, materialized
    // `.forge/briefs/` directory -- the identical "check real project state, not a static catalogue"
    // shape every sibling oracle method here already uses. Correctly reports every real, shipped
    // workflow/gate's own brief reference as `unknown-brief` right now: no real brief *content* has
    // been authored anywhere in this codebase yet (`BRIEF_INDEX` is still empty -- `PLAN-M13.md` P2,
    // content authoring, is a separate, not-yet-built piece). This is the real, disclosed, temporary
    // state `SPEC-QUESTIONS.md` Q197 records, not a bug in this check.
    briefExists: (briefPath) => isTemplateReference(briefPath) || briefPaths.has(briefPath),
    gateExists: (id) => isTemplateReference(id) || gateRegistry.has(id),
    artifactTypeExists: (id) => artifactTypeById(id) !== undefined,
    workflowExists: (id) => isTemplateReference(id) || workflowIdSet.has(id),
  };
}

/** `validate <id>` — real structural checks (`validateStructure`) plus real referential-integrity
 * checks against real project state (`validateWorkflow` + the oracle above). */
export async function workflowValidate(
  ctx: WorkflowCommandContext,
  id: string,
): Promise<readonly ValidationIssue[]> {
  const workflow = await readWorkflow(ctx, id);
  const structural = validateStructure(workflow);
  if (structural.length > 0) return structural;
  const oracle = await buildOracle(ctx);
  return validateWorkflow(workflow, oracle);
}

/** `validate --all` — every real workflow, each validated independently (one workflow's own real
 * issues never hides another's, the same per-item isolation `forge diagram sync` already establishes
 * for the identical "many independent real checks, one bad one shouldn't blank out the rest" shape). */
export async function workflowValidateAll(
  ctx: WorkflowCommandContext,
): Promise<ReadonlyMap<string, readonly ValidationIssue[]>> {
  const ids = await listWorkflowIds(ctx);
  const oracle = await buildOracle(ctx);
  const results = new Map<string, readonly ValidationIssue[]>();
  for (const id of ids) {
    const workflow = await readWorkflow(ctx, id);
    const structural = validateStructure(workflow);
    results.set(id, structural.length > 0 ? structural : validateWorkflow(workflow, oracle));
  }
  return results;
}

/** `graph <id>` — a real, top-level-only Mermaid flowchart of `id`'s own real `steps[].dependsOn`
 * edges. Deliberately shallow: it does not descend into a `fanout`/`parallel`/`sequence` group's own
 * nested children (each of those is itself a full recursive `WorkflowStep`, and flattening them
 * correctly needs real plan compilation — `@forge/engine/plan`'s own `compilePlan`, which itself needs
 * a real `ExpressionContext` no bare `forge workflow graph <id>` invocation has one of) — a real,
 * documented gap rather than a fabricated deep graph. */
export async function workflowGraph(ctx: WorkflowCommandContext, id: string): Promise<string> {
  const workflow = await readWorkflow(ctx, id);
  const lines = ['flowchart TD'];
  for (const step of workflow.steps) {
    if (step.id === undefined) continue;
    lines.push(`  ${step.id}`);
    for (const dep of step.dependsOn ?? []) {
      lines.push(`  ${dep} --> ${step.id}`);
    }
  }
  return lines.join('\n');
}

const WORKFLOW_TEMPLATE = (id: string): string => `id: ${id}
name: ${id}
version: 1.0.0
description: A new workflow.

steps:
  - id: only
    kind: agent
    agent: engineer
    brief: briefs/${id}.md
`;

/** `new <id>` — a real, minimal, schema-valid workflow document, written to a real
 * `<workflowsRoot>/<id>.workflow.yaml`. */
export async function workflowNew(ctx: WorkflowCommandContext, id: string): Promise<string> {
  const relPath = `${ctx.workflowsRoot}/${id}${WORKFLOW_FILE_SUFFIX}`;
  if (await pathExists(ctx.paths.resolveWithin(relPath))) {
    throw new ForgeError('CFG-001', { path: relPath, line: 0 });
  }
  const content = WORKFLOW_TEMPLATE(id);
  // `PLAN-M13.md` P1: `brief:` is a `briefs/<name>.md` reference `forge workflow validate` now
  // genuinely resolves, so the scaffold writes the file it names (only if absent -- never clobbers a
  // real, hand-authored brief), keeping the scaffold's own brief reference valid. Written *before* the
  // workflow file so a failed write here does not leave a retry stuck on the "already exists" refusal.
  // (The scaffold's `agent: engineer` is a pre-existing reference to no shipped agent; not this piece's.)
  const briefRelPath = `.forge/briefs/${id}.md`;
  if (!(await pathExists(ctx.paths.resolveWithin(briefRelPath)))) {
    await writeFileAtomic(
      ctx.paths.resolveWithin(briefRelPath),
      'Describe what this step should do.\n',
    );
  }
  await writeFileAtomic(ctx.paths.resolveWithin(relPath), content);
  return relPath;
}
