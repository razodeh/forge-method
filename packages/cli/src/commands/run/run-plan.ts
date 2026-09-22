/**
 * `forge plan run-plan <stageId> [--json]` — the engine-compiled run plan for one stage (`03` §3.2.3 "produce
 * the run plan DAG", `06` §6.2, `10` §10.2 P5). `plan-stage.workflow.yaml`'s `derive-run-plan` step runs
 * exactly this command line; the orchestrator role (`05`'s roster: run planning, sequencing) is what should audit
 * its output, though no shipped workflow dispatches that role today.
 *
 * `03` names no `run-plan` subcommand; it says `forge plan stage <id>` produces the run plan. The shipped
 * workflow splits that in two: `plan stage` runs the planning agents, then a *command* step derives the plan
 * deterministically from what they wrote. This is that command step. It is read-only: it prints, and writes
 * no file (recording the plan under `docs/forge/plans/` is left to whoever consumes it, `10` §10.2 P5).
 *
 * The plan is the stage's stories ordered into waves (declared dependencies plus serialised file-claim
 * overlaps), and, when it compiles, `build-stage` (whose fanouts run once per story) compiled against them,
 * by `@forge/engine/plan`'s `compileStageRunPlan`. This file only does the I/O: find the stage's Epics and
 * Stories, read the workflow, and shape the result.
 *
 * @see specs/03 §3.2.3
 * @see specs/06 §6.2
 * @see PLAN-M13.md P10
 */
import { ForgeError } from '@forge/core';
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import { isTestPath } from '@forge/engine/dispatch';
import {
  compileStageRunPlan,
  type OutsideStageStatus,
  type StageRunPlan,
  type StageRunPlanFinding,
  type StageStory,
} from '@forge/engine/plan';
import type { ExpressionContext } from '@forge/engine/expr';
import { parseWorkflow, type Workflow } from '@forge/engine/workflow';
import { epicSchema, storySchema } from '@forge/schemas';

import { sanitizeForTerminal } from '../../generated-header.ts';
import { ownerRoleProblem, readImplementationRoles } from '../implementation-roles.ts';
import { listSpecArtifacts } from '../shared.ts';

/** The workflow whose fanouts define a stage's run plan (`06` §6.2's own worked example is this workflow). */
export const RUN_PLAN_WORKFLOW_ID = 'build-stage';

export interface RunPlanContext {
  readonly paths: ProjectPaths;
  /** Project-relative directory of materialised workflows (`.forge/workflows`). */
  readonly workflowsRoot: string;
  /** Project-relative directory of Epic/Story documents (`docs/forge/specs`). */
  readonly specsRoot: string;
  /** Project-relative directory of materialised agents (`.forge/agents`). When present, a story whose `owner_role` is
   * not an implementation role is an error finding (`PLAN-M13.md` P36); absent, owners are not judged. */
  readonly agentsRoot?: string | undefined;
}

export type StageRunPlanReport = StageRunPlan;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A story in one of these states has been delivered: it is not work to schedule, and a dependency on it is
 * already met. */
function isDelivered(status: unknown): boolean {
  return status === 'done' || status === 'verified';
}

async function loadWorkflow(ctx: RunPlanContext) {
  const relPath = `${ctx.workflowsRoot}/${RUN_PLAN_WORKFLOW_ID}.workflow.yaml`;
  if (!(await pathExists(ctx.paths.resolveWithin(relPath)))) {
    throw new ForgeError('RUN-053', { workflowId: RUN_PLAN_WORKFLOW_ID, path: relPath });
  }
  const parsed = parseWorkflow(await readTextFile(ctx.paths.resolveWithin(relPath)));
  if (!parsed.success) {
    throw new ForgeError('RUN-045', {
      issues: parsed.issues.map((issue) => issue.message).join('; '),
    });
  }
  return parsed.workflow;
}

/**
 * Compiles the run plan for `stageId`.
 *
 * @throws {ForgeError} `RUN-082` when no Epic declares the stage; `RUN-053`/`RUN-045` when the project's
 * `build-stage` workflow is missing or does not parse; `CFG-006`/`CFG-007` when *any* document under the
 * specs root has broken front matter (the same all-or-nothing read `forge spec validate` and `spec matrix`
 * make, so a corrupt file is named rather than skipped). A stage whose stories are merely inconsistent (a
 * cycle, an unknown dependency, a story an Epic lists that does not exist, a story that fails its schema)
 * is *not* an exception: it comes back with `ok: false` and the findings, so every problem shows at once.
 * Stories already `done`/`verified` are reported and left out of the schedule; a dependency on one is met.
 */
export async function planRunPlan(
  ctx: RunPlanContext,
  stageId: string,
): Promise<StageRunPlanReport> {
  const workflow = await loadWorkflow(ctx);
  const { stories, outsideStage, inputFindings } = await readStageStories(ctx, stageId);
  return compileStageReport(workflow, stageId, stories, outsideStage, inputFindings);
}

/** What the project's own documents say about one stage: the stories to plan, what is known about the stories
 * outside it, and the findings about the inputs themselves (a schema failure, a duplicate id...). */
export interface StageInputs {
  readonly stories: readonly StageStory[];
  readonly outsideStage: ReadonlyMap<string, OutsideStageStatus>;
  readonly inputFindings: readonly StageRunPlanFinding[];
}

function compileStageReport(
  workflow: Workflow,
  stageId: string,
  stories: readonly StageStory[],
  outsideStage: ReadonlyMap<string, OutsideStageStatus>,
  inputFindings: readonly StageRunPlanFinding[],
  extraContext?: ExpressionContext,
): StageRunPlanReport {
  const plan = compileStageRunPlan(workflow, stageId, stories, { outsideStage, extraContext });
  const findings = [...inputFindings, ...plan.findings];
  return { ...plan, findings, ok: !findings.some((f) => f.severity === 'error') };
}

/**
 * Reads a stage's Epics and Stories from the specs root: the one reader behind `forge plan run-plan` and
 * `forge run <workflow> --stage` (`PLAN-M13.md` P21), so the plan a user is shown and the run that starts are
 * built from the same documents by the same code. Same failure modes as `planRunPlan` (`RUN-082`, `CFG-006/007`).
 */
export async function readStageStories(ctx: RunPlanContext, stageId: string): Promise<StageInputs> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const implementationRoles =
    ctx.agentsRoot === undefined
      ? undefined
      : await readImplementationRoles(ctx.paths, ctx.agentsRoot);

  // Everything below reads raw front matter first, so a document that fails its schema is reported rather
  // than dropped, and nothing depends on the order files were walked in (the inputs are grouped by id, and
  // the findings sorted, before anything is decided).
  const epicStage = new Map<string, unknown>();
  const epicCopies = new Map<string, number>();
  const stageEpicIds = new Set<string>();
  const epicStoryIds = new Set<string>();
  const invalidEpics = new Set<string>();
  const storyDocs = new Map<string, Readonly<Record<string, unknown>>[]>();
  const unidentified: { readonly path: string; readonly epic: unknown }[] = [];
  for (const doc of docs) {
    const fm = asRecord(doc.frontMatter);
    const id = fm['id'];
    const type = fm['type'];
    const looksLikeStory = typeof type === 'string' && type.toLowerCase() === 'story';
    if (typeof id !== 'string') {
      if (looksLikeStory) unidentified.push({ path: doc.path, epic: fm['epic'] });
      continue;
    }
    if (type === 'Epic') {
      // A numeric stage (`stage: 1`) is matched by its text, so the Epic is found and reported invalid
      // rather than the stage being reported unknown.
      const stage = fm['stage'];
      const stageText =
        typeof stage === 'string' || typeof stage === 'number' ? String(stage) : undefined;
      epicStage.set(id, stageText);
      epicCopies.set(id, (epicCopies.get(id) ?? 0) + 1);
      if (stageText !== stageId) continue;
      stageEpicIds.add(id);
      for (const storyId of stringList(fm['stories'])) epicStoryIds.add(storyId);
      if (!epicSchema.safeParse(fm).success) invalidEpics.add(id);
    } else if (type === 'Story') {
      storyDocs.set(id, [...(storyDocs.get(id) ?? []), fm]);
    } else if (looksLikeStory) {
      unidentified.push({ path: doc.path, epic: fm['epic'] });
    }
  }
  if (stageEpicIds.size === 0) throw new ForgeError('RUN-082', { stageId });

  const stories: StageStory[] = [];
  const inputFindings: StageRunPlanFinding[] = [];
  const outsideStage = new Map<string, OutsideStageStatus>();
  const delivered: string[] = [];
  const found = new Set<string>();
  for (const id of invalidEpics) {
    inputFindings.push({
      code: 'epic-invalid',
      severity: 'error',
      message: `Epic ${id} does not match its schema; run \`forge spec validate\` for the details.`,
      subjects: [id],
    });
  }
  for (const id of stageEpicIds) {
    if ((epicCopies.get(id) ?? 0) > 1) {
      inputFindings.push({
        code: 'duplicate-epic-id',
        severity: 'error',
        message: `Epic id ${id} is declared by more than one document, so which stories belong to stage ${stageId} is ambiguous.`,
        subjects: [id],
      });
    }
  }
  for (const doc of unidentified) {
    if (typeof doc.epic === 'string' && stageEpicIds.has(doc.epic)) {
      inputFindings.push({
        code: 'story-invalid',
        severity: 'error',
        message: `${doc.path} looks like a Story of stage ${stageId} but has no valid id or a wrong type, so it cannot be planned; run \`forge spec validate\`.`,
        subjects: [doc.path],
      });
    }
  }

  /** Whether a story belongs to this stage: its own `epic` field names one of the stage's Epics, or (when it
   * names no known Epic) a stage Epic lists it. A story that names an Epic of another stage while a stage
   * Epic lists it is a contradiction, reported rather than planned twice. */
  const membership = (fm: Readonly<Record<string, unknown>>): 'in' | 'out' | 'conflict' => {
    const epic = typeof fm['epic'] === 'string' ? fm['epic'] : '';
    if (stageEpicIds.has(epic)) return 'in';
    const listed = epicStoryIds.has(String(fm['id']));
    if (!listed) return 'out';
    return epicStage.has(epic) ? 'conflict' : 'in';
  };

  for (const [id, copies] of storyDocs) {
    const memberships = copies.map(membership);
    if (memberships.every((m) => m === 'out')) {
      // Another stage's story. A dependency on it is met once it is delivered; among copies, "not
      // delivered" wins, so the answer never depends on which file was read last.
      const allDelivered = copies.every((fm) => isDelivered(fm['status']));
      outsideStage.set(id, allDelivered ? 'satisfied' : 'pending');
      continue;
    }
    found.add(id);
    if (copies.length > 1) {
      inputFindings.push({
        code: 'duplicate-story-id',
        severity: 'error',
        message: `Story id ${id} is declared by ${String(copies.length)} documents; none of them is planned until that is fixed.`,
        subjects: [id],
      });
      outsideStage.set(id, 'pending');
      continue;
    }
    const [fm] = copies;
    if (fm === undefined) continue;
    if (memberships[0] === 'conflict') {
      inputFindings.push({
        code: 'story-epic-mismatch',
        severity: 'error',
        message: `Story ${id} is listed by an Epic of stage ${stageId} but names ${String(fm['epic'])}, an Epic of another stage; it is not planned.`,
        subjects: [id],
      });
      outsideStage.set(id, 'pending');
      continue;
    }
    const parsed = storySchema.safeParse(fm);
    if (!parsed.success) {
      inputFindings.push({
        code: 'story-invalid',
        severity: 'error',
        message: `Story ${id} does not match its schema and cannot be planned; run \`forge spec validate\` for the details.`,
        subjects: [id],
      });
      outsideStage.set(id, 'pending');
      continue;
    }
    const story = parsed.data;
    if (isDelivered(story.status)) {
      delivered.push(story.id);
      outsideStage.set(story.id, 'satisfied');
      continue;
    }
    if (story.status === 'in-progress' || story.status === 'in-review') {
      inputFindings.push({
        code: 'story-in-progress',
        severity: 'warning',
        message: `${story.id} is already ${story.status}; it is planned as fresh work, so check it is not being done twice.`,
        subjects: [story.id],
      });
    }
    if (!epicStoryIds.has(story.id)) {
      inputFindings.push({
        code: 'story-not-listed',
        severity: 'warning',
        message: `${story.id} names ${story.epic}, but that Epic's stories list does not include it.`,
        subjects: [story.id],
      });
    }
    // A story an authoring or judging role owns would have that role write its source (`PLAN-M13.md` P36).
    const ownerProblem = ownerRoleProblem(story.owner_role, implementationRoles);
    if (ownerProblem !== undefined) {
      inputFindings.push({
        code: 'owner-role-not-implementation',
        severity: 'error',
        message: `Story ${story.id}: ${ownerProblem}`,
        subjects: [story.id],
      });
    }
    stories.push({
      id: story.id,
      ownerRole: story.owner_role,
      dependsOn: [...story.depends_on],
      // `status: blocked` with nothing named is still blocked; say what blocks it.
      blockedBy:
        story.status === 'blocked' && story.blocked_by.length === 0
          ? ['its status (blocked)']
          : [...story.blocked_by],
      filesExpected: [...story.files_expected],
      testPaths: story.files_expected.filter(isTestPath),
    });
  }
  for (const id of [...epicStoryIds]) {
    if (found.has(id)) continue;
    inputFindings.push({
      code: 'story-missing',
      severity: 'error',
      message: `An Epic of this stage lists ${id}, but no Story document with that id exists.`,
      subjects: [id],
    });
  }
  if (delivered.length > 0) {
    const ids = [...delivered].sort(compareIds);
    inputFindings.push({
      code: 'story-already-delivered',
      severity: 'warning',
      message: `${ids.join(', ')} already done or verified: not scheduled, and dependencies on them are met.`,
      subjects: ids,
    });
  }
  if (stories.length === 0 && delivered.length === 0) {
    inputFindings.push({
      code: 'stage-has-no-stories',
      severity: 'warning',
      message: `No story of stage ${stageId} could be planned (its Epics list none, or none is plannable: see the other findings), so there is nothing to schedule.`,
      subjects: [],
    });
  }
  inputFindings.sort(
    (x, y) => compareIds(x.code, y.code) || compareIds(x.subjects.join(','), y.subjects.join(',')),
  );

  return { stories, outsideStage, inputFindings };
}

/** The stage's run plan against an arbitrary workflow (the one being run, which need not be `build-stage`):
 * the same story graph and findings `planRunPlan` reports, and the context the run compiles against. */
export async function planStageForRun(
  ctx: RunPlanContext,
  stageId: string,
  workflow: Workflow,
  extraContext?: ExpressionContext,
): Promise<StageRunPlanReport> {
  const { stories, outsideStage, inputFindings } = await readStageStories(ctx, stageId);
  return compileStageReport(workflow, stageId, stories, outsideStage, inputFindings, extraContext);
}

/** The `--json` body: the report under the standard `{ v: 1 }` envelope, with the numeric `errors`/`warnings`
 * a gate's `failOn: 'errors > 0'` reads (as `spec validate --rule` does). `criticalPath` is `null` when there
 * is no step-level plan (`stepPlan: "unavailable"`): its cost is unknown, not zero. Key order is fixed here,
 * so two runs over the same inputs print byte-identical text. */
export function runPlanJson(report: StageRunPlanReport): string {
  const count = (severity: string): number =>
    report.findings.filter((f) => f.severity === severity).length;
  // `JSON.stringify` escapes control bytes below U+0020 but writes DEL and C1 (U+007F-U+009F) raw, and story
  // files are the source of most strings here, so the text goes through the same terminal scrub the human
  // rendering uses.
  return sanitizeForTerminal(
    JSON.stringify({
      v: 1,
      ok: report.ok,
      errors: count('error'),
      warnings: count('warning'),
      stageId: report.stageId,
      workflowId: report.workflowId,
      stories: report.stories,
      waves: report.waves,
      storyCriticalPath: report.storyCriticalPath,
      overlapCount: report.overlapCount,
      blocked: report.blocked,
      storyOverlaps: report.storyOverlaps,
      stepPlan: report.stepPlan,
      criticalPath: report.stepPlan === 'compiled' ? report.criticalPath : null,
      stepOverlaps: report.stepOverlaps,
      findings: report.findings,
      nodes: report.nodes,
    }),
  );
}

/** The default, human rendering: waves, the critical paths, then every finding. Story ids, globs and
 * dependency names come from files in the repository, so control and escape bytes are stripped before they
 * reach a terminal (newlines and tabs kept). */
export function formatRunPlan(report: StageRunPlanReport): string {
  const lines: string[] = [];
  lines.push(
    `Run plan for stage ${report.stageId} (${report.workflowId}): ${String(report.stories.length)} stories, ` +
      (report.stepPlan === 'compiled'
        ? `${String(report.nodes.length)} steps.`
        : 'no step-level plan (see findings).'),
  );
  if (report.waves.length > 0) {
    lines.push('', 'Waves (stories within a wave may run in parallel):');
    report.waves.forEach((wave, index) => {
      lines.push(`  ${String(index + 1)}. ${wave.join(', ')}`);
    });
  }
  if (report.storyCriticalPath.length > 0) {
    lines.push('', `Longest story chain: ${report.storyCriticalPath.join(' -> ')}`);
  }
  if (report.stepPlan === 'compiled' && report.criticalPath.path.length > 0) {
    lines.push(
      '',
      `Step critical path (estimated cost $${report.criticalPath.estimatedCost.toFixed(2)}):`,
      `  ${report.criticalPath.path.join(' -> ')}`,
    );
  }
  if (report.blocked.length > 0) {
    lines.push('', `Planned but not startable yet (blocked): ${report.blocked.join(', ')}`);
  }
  if (report.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const f of report.findings) {
      // Finding text can quote story files, so it is printed as one line. The one exception is the cycle
      // findings, whose text after a blank line is the engine's own rendered graph (synthetic node names).
      const isCycle = f.code === 'dependency-cycle' || f.code === 'plan-dependency-cycle';
      const [head = '', ...rest] = isCycle ? f.message.split('\n\n') : [f.message];
      lines.push(`  ${f.severity} ${f.code}: ${head.replace(/[\r\n]+/g, ' ')}`);
      for (const block of rest) lines.push(...block.split('\n').map((line) => `    ${line}`));
    }
  }
  const hasWarnings = report.findings.some((f) => f.severity === 'warning');
  lines.push(
    '',
    !report.ok
      ? 'Plan has errors and is not schedulable.'
      : hasWarnings
        ? 'No blocking findings; read the warnings above before scheduling.'
        : 'Plan is schedulable.',
  );
  return sanitizeForTerminal(lines.join('\n'));
}
