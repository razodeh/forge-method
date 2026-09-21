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
  isForgeError,
  listDirEntriesSorted,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type ProjectPaths,
} from '@forge/core';
import { listResolvableContentReferences, resolveContentReference } from '@forge/agents/prompt';
import { artifactTypeById } from '@forge/schemas';
import { validateGateDocument } from '@forge/engine/gates';
import {
  parseWorkflow,
  validateStructure,
  validateWorkflow,
  type ValidationIssue,
  type Workflow,
  type WorkflowExistenceOracle,
} from '@forge/engine/workflow';

import * as YAML from 'yaml';

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

/** Every real agent id materialized under `<agentsRoot>/` -- one shared definition for the workflow
 * oracle's `agentExists` and `gateValidateAll`'s advisory-check `agent`. */
async function listAgentIds(
  ctx: Pick<WorkflowCommandContext, 'paths' | 'agentsRoot'>,
): Promise<ReadonlySet<string>> {
  if (!(await pathExists(ctx.paths.resolveWithin(ctx.agentsRoot)))) return new Set();
  const entries = await listDirEntriesSorted(ctx.paths.resolveWithin(ctx.agentsRoot));
  return new Set(
    entries
      .filter((entry) => !entry.isDirectory && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name.replace(/\.yaml$/, '')),
  );
}

/** Every gate id defined under `<checksRoot>/`, read tolerantly: a gate file that is unparseable or has no
 * string `id` is simply not a known gate here. It is `gateValidateAll` that reports it, so one malformed
 * gate cannot crash `forge workflow validate --all` before that report is ever produced (the strict,
 * throwing `loadGateRegistry` is for gate *evaluation*, where a broken gate must stop the run). */
async function listGateIds(
  ctx: Pick<WorkflowCommandContext, 'paths' | 'checksRoot'>,
): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  const dir = ctx.paths.resolveWithin(ctx.checksRoot);
  if (!(await pathExists(dir))) return ids;
  for (const entry of await listDirEntriesSorted(dir)) {
    if (entry.isDirectory || !entry.name.endsWith(GATE_FILE_SUFFIX)) continue;
    try {
      const parsed: unknown = YAML.parse(
        await readTextFile(ctx.paths.resolveWithin(`${ctx.checksRoot}/${entry.name}`)),
      );
      if (isRecord(parsed) && typeof parsed['id'] === 'string' && parsed['id'] !== '') {
        ids.add(parsed['id']);
      }
    } catch {
      // Reported by `gateValidateAll`; not a known gate here.
    }
  }
  return ids;
}

async function buildOracle(ctx: WorkflowCommandContext): Promise<WorkflowExistenceOracle> {
  const [agentIds, gateIds, workflowIds, briefPaths] = await Promise.all([
    listAgentIds(ctx),
    listGateIds(ctx),
    listWorkflowIds(ctx),
    listResolvableContentReferences(ctx.paths, 'briefs'),
  ]);
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
    gateExists: (id) => isTemplateReference(id) || gateIds.has(id),
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

/**
 * One real, itemized defect in a gate definition, found by {@link gateValidateAll}.
 *
 * `checkId` is the advisory check's own `id` (for example `architect-review`), so a finding names the
 * exact `checks.advisory[]` entry to fix, the way a workflow issue names its `stepId`; it is absent for
 * a finding about the gate file as a whole.
 */
export interface GateValidationIssue {
  readonly code:
    | 'invalid-gate-file'
    | 'duplicate-gate-id'
    | 'duplicate-check-id'
    | 'missing-brief'
    | 'malformed-brief-reference'
    | 'unknown-brief'
    | 'unknown-agent'
    // The strict gate-document validator's findings (`validateGateDocument`, `PLAN-M13.md` P41): the same ones
    // `loadGateRegistry` refuses a gate for (`GATE-506`), reported here for every gate at once.
    | 'unknown-gate-key'
    | 'invalid-gate-value'
    | 'no-deterministic-checks';
  readonly severity: 'error';
  readonly message: string;
  readonly checkId?: string | undefined;
}

const GATE_FILE_SUFFIX = '.gate.yaml';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `validate --all`'s gate half -- `specs/22` M13 acceptance ("every workflow/gate `brief:` reference ...
 * resolves to real, non-empty content; `forge workflow validate --all` fails with a named `unknown-brief`
 * finding ... never a silent pass"). A gate's `checks.advisory[].brief` is a `briefs/<name>.md` reference
 * exactly like a workflow step's, but nothing validated it before this (`SPEC-QUESTIONS.md` Q197 item 2):
 * `briefExists` only ever sees workflow steps. Each reference goes through the very loader dispatch will
 * use (`resolveContentReference`), so this validator can never pass a reference the loader refuses.
 *
 * What it does *not* judge is a brief's content beyond "non-blank": whether a resolvable brief is any
 * good is the content tests' job (`packages/agents/test/prompt/briefs-*-content.test.ts`), which run
 * against the shipped files, not against a project's own edits.
 *
 * It reads the gate files itself rather than through `loadGateRegistry`: that registry keys by gate id
 * (a second file with the same id silently replaces the first) and assumes well-formed YAML, so a
 * validator built on it could skip a gate or crash on the very malformed input it exists to report.
 * A file it cannot interpret is an `invalid-gate-file` finding; the advisory check's `agent` must be a
 * real `.forge/agents/` id, as a workflow step's is.
 *
 * Findings are keyed by gate id (the file's stem when the id itself is unreadable); a gate with no
 * findings is absent from the map. Deliberately *not* folded into `workflowValidateAll`'s own result
 * map: that map is keyed by workflow id and its callers treat every key as one.
 *
 * @see specs/22 M13
 * @see specs/10 §10.3
 */
export async function gateValidateAll(
  ctx: Pick<WorkflowCommandContext, 'paths' | 'checksRoot' | 'agentsRoot'>,
): Promise<ReadonlyMap<string, readonly GateValidationIssue[]>> {
  const results = new Map<string, GateValidationIssue[]>();
  const report = (gateId: string, issue: GateValidationIssue): void => {
    const existing = results.get(gateId);
    if (existing === undefined) results.set(gateId, [issue]);
    else existing.push(issue);
  };

  const checksDir = ctx.paths.resolveWithin(ctx.checksRoot);
  if (!(await pathExists(checksDir))) return results;
  const gateFiles = (await listDirEntriesSorted(checksDir)).filter(
    (entry) => !entry.isDirectory && entry.name.endsWith(GATE_FILE_SUFFIX),
  );
  const agentIds = await listAgentIds(ctx);
  const gateFileById = new Map<string, string>();

  for (const entry of gateFiles) {
    const stem = entry.name.slice(0, -GATE_FILE_SUFFIX.length);
    const invalid = (reason: string): void => {
      report(stem, {
        code: 'invalid-gate-file',
        severity: 'error',
        message: `Gate file "${entry.name}" ${reason}.`,
      });
    };
    let parsed: unknown;
    try {
      parsed = YAML.parse(
        await readTextFile(ctx.paths.resolveWithin(`${ctx.checksRoot}/${entry.name}`)),
      );
    } catch {
      invalid('is not parseable YAML');
      continue;
    }
    if (!isRecord(parsed) || typeof parsed['id'] !== 'string' || parsed['id'] === '') {
      invalid('has no string "id"');
      continue;
    }
    const gateId = parsed['id'];
    const firstFile = gateFileById.get(gateId);
    if (firstFile !== undefined) {
      report(gateId, {
        code: 'duplicate-gate-id',
        severity: 'error',
        message: `Gate id "${gateId}" is defined by both "${firstFile}" and "${entry.name}"; only one definition can take effect.`,
      });
    } else {
      gateFileById.set(gateId, entry.name);
    }

    // The strict document validator `loadGateRegistry` refuses a gate with: an unknown key (a misspelled
    // `checks:`), a wrong-typed value, a gate with no deterministic check, a duplicate deterministic check id.
    // The advisory checks' own structure is reported below with its own codes, so those findings are skipped
    // here (an unknown key inside an advisory check is not reported below, and is kept).
    for (const problem of validateGateDocument(parsed).problems) {
      if (problem.advisoryShape === true && problem.code !== 'unknown-key') continue;
      report(gateId, {
        code:
          problem.code === 'unknown-key'
            ? 'unknown-gate-key'
            : problem.code === 'no-deterministic-checks'
              ? 'no-deterministic-checks'
              : problem.code === 'duplicate-check-id'
                ? 'duplicate-check-id'
                : 'invalid-gate-value',
        severity: 'error',
        message: `Gate file "${entry.name}" is invalid at "${problem.key}": ${problem.message}.`,
      });
    }

    const checks = parsed['checks'];
    if (checks !== undefined && checks !== null && !isRecord(checks)) {
      report(gateId, {
        code: 'invalid-gate-file',
        severity: 'error',
        message: `Gate "${gateId}" has a "checks" that is not a mapping.`,
      });
      continue;
    }
    const advisory = isRecord(checks) ? checks['advisory'] : undefined;
    if (advisory === undefined || advisory === null) continue;
    if (!Array.isArray(advisory)) {
      report(gateId, {
        code: 'invalid-gate-file',
        severity: 'error',
        message: `Gate "${gateId}" has a "checks.advisory" that is not a list.`,
      });
      continue;
    }
    const seenCheckIds = new Set<string>();
    for (const check of advisory as readonly unknown[]) {
      if (!isRecord(check) || typeof check['id'] !== 'string' || check['id'] === '') {
        report(gateId, {
          code: 'invalid-gate-file',
          severity: 'error',
          message: `Gate "${gateId}" has an advisory check with no string "id".`,
        });
        continue;
      }
      const checkId = check['id'];
      const where = `Advisory check "${checkId}" of gate "${gateId}"`;
      if (seenCheckIds.has(checkId)) {
        report(gateId, {
          code: 'duplicate-check-id',
          severity: 'error',
          message: `${where} is declared more than once.`,
          checkId,
        });
      }
      seenCheckIds.add(checkId);

      const agent = check['agent'];
      if (typeof agent !== 'string' || !agentIds.has(agent)) {
        report(gateId, {
          code: 'unknown-agent',
          severity: 'error',
          message:
            typeof agent === 'string'
              ? `${where} references unknown agent "${agent}".`
              : `${where} declares no agent.`,
          checkId,
        });
      }

      const brief = check['brief'];
      if (typeof brief !== 'string' || brief.trim() === '') {
        report(gateId, {
          code: 'missing-brief',
          severity: 'error',
          message: `${where} declares no brief.`,
          checkId,
        });
        continue;
      }
      const malformed = (): GateValidationIssue => ({
        code: 'malformed-brief-reference',
        severity: 'error',
        message: `${where} has malformed brief reference ${JSON.stringify(brief)}; expected "briefs/<name>.md".`,
        checkId,
      });
      // `resolveContentReference` also accepts `prompts/<name>.md`; a gate's `brief:` is a brief, so a
      // prompt reference is the wrong kind of content even though it would resolve.
      if (!brief.startsWith('briefs/')) {
        report(gateId, malformed());
        continue;
      }
      try {
        await resolveContentReference(ctx.paths, brief);
      } catch (error) {
        if (!isForgeError(error)) throw error;
        report(
          gateId,
          error.code === 'CFG-053'
            ? malformed()
            : {
                code: 'unknown-brief',
                severity: 'error',
                message: `${where} references unknown brief "${brief}" (${error.code}: the loader cannot resolve it to non-blank text).`,
                checkId,
              },
        );
      }
    }
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
