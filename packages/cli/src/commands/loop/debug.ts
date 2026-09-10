/**
 * `forge debug <symptom|--from-failure <runId>>` — `03` §3.2.5's autonomous RCA loop: real, thin
 * dispatch to `debug` (`10` §10.5, `13` §13). `debug.workflow.yaml`'s own one required input is
 * `defectId`, not a bare symptom string — `13` §13's own intake step ("Normalise the symptom into a
 * `DefectRecord`") is exactly what this command performs before dispatching, the identical
 * "real artifact, real id, template-scaffolded placeholders for what free text alone cannot supply"
 * pattern `forge adr new`/`forge spec new` (`PLAN-M6.md` C3) already establish, reusing the real,
 * shipped `Defect.md` template rather than hand-building front matter here.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.5
 * @see specs/13 §13
 */
import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import type { ExpressionContext } from '@forge/engine/expr';
import { readEvents } from '@forge/telemetry/events';
import { renderArtifactPath } from '@forge/schemas/registry';

import { getSharedIdAllocator, readArtifactTemplate } from '../shared.ts';
import { runWorkflow, type DryRunResult, type RealRunResult, type RunDeps } from '../run/run.ts';

const DEBUG_WORKFLOW_ID = 'debug';

/** The same narrow, honest `ExpressionContext` extension `implement.ts`'s own
 * `ImplementStoryExpressionContext` documents — `{{defectId}}` resolves against the top level. */
interface DebugExpressionContext extends ExpressionContext {
  readonly defectId: string;
}

export interface DebugOptions {
  readonly reportsRoot: string;
  readonly dryRun?: boolean;
  readonly host: string;
  readonly clock?: Clock;
}

async function scaffoldDefect(
  paths: ProjectPaths,
  reportsRoot: string,
  clock: Clock,
  observed: string,
  affected: readonly string[],
): Promise<ArtifactDocument> {
  const allocator = getSharedIdAllocator(paths, clock);
  const id = await allocator.allocate('Defect');
  const pathResult = renderArtifactPath('Defect', { id });
  if (!pathResult.success) {
    throw new ForgeError('CFG-001', { path: 'Defect', line: 0 });
  }
  // `Defect`'s own registered `pathTemplate` ('reports/defects/{id}.md') names a literal `reports/`
  // top-level segment matching `ForgeConfig.paths.reports`'s own namespace label — the identical
  // "strip the registered top-level label, reroot under the real configured path" `forge adr new`
  // already does for `kb/`.
  const relativePath = `${reportsRoot}/${pathResult.path.replace(/^reports\//, '')}`;

  const templateText = await readArtifactTemplate('Defect');
  const today = clock.now().slice(0, 10);
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['title'], observed.slice(0, 80));
  doc.set(['created'], today);
  doc.set(['updated'], today);
  doc.set(['first_seen'], today);
  doc.set(['observed'], observed);
  if (affected.length > 0) doc.set(['affected'], affected);

  await writeArtifact(paths, doc);
  return doc;
}

/** `13` §13's own real intake normalisation, for a bare symptom string alone: everything
 * `Defect.md`'s own template does not already default (`expected`/`frequency`/`environment`/
 * `severity`/`evidence`) has no real source in a bare symptom string — left as the template's own
 * placeholder text/defaults, exactly as `forge adr new` leaves every ADR template field it has no
 * real input for. */
export async function debugSymptom(
  deps: RunDeps,
  symptom: string,
  options: DebugOptions,
): Promise<DryRunResult | RealRunResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const defect = await scaffoldDefect(deps.paths, options.reportsRoot, clock, symptom, []);
  const defectId = defect.get(['id']) as string;
  const expressionContext: DebugExpressionContext = { defectId };
  return runWorkflow(deps, {
    workflowId: DEBUG_WORKFLOW_ID,
    expressionContext,
    dryRun: options.dryRun ?? false,
    host: options.host,
    clock,
  });
}

/** The real, chronologically *first* `StepFailed` event in the log — not derived from
 * `RunState.stepStatuses`' own map (whose iteration order is scheduling order, not failure order): a
 * critic round caught the original version picking "whichever failed step this run's plan happened to
 * schedule first," an arbitrary, scheduling-order-dependent choice on a run where more than one
 * concurrent step genuinely failed, not necessarily the one that actually failed first or is the real
 * root cause. Scanning the append-only log itself in its own real, durable order (`18` §18.4) is what
 * makes "the first one to fail" an honest claim about what happened, not an accident of plan shape. */
async function findFailedStep(
  projectRoot: string,
  runId: string,
): Promise<{ readonly stepId: string; readonly message: string }> {
  for await (const event of readEvents(projectRoot, runId)) {
    if (event.type !== 'StepFailed' || event.stepId === undefined) continue;
    const payload = event.payload as { readonly message?: unknown } | undefined;
    const message =
      typeof payload?.message === 'string' ? payload.message : `step ${event.stepId} failed`;
    return { stepId: event.stepId, message };
  }
  throw new ForgeError('RUN-057', { runId });
}

/** `--from-failure <runId>`: the real `observed` text and `affected` step come from the run's own
 * durable event log — the same `readEvents` replay `forge status`/`forge lanes` (`PLAN-M6.md` C4)
 * already use, for the identical "real state, not a second tracking mechanism" reason. */
export async function debugFromFailure(
  deps: RunDeps,
  runId: string,
  options: DebugOptions,
): Promise<DryRunResult | RealRunResult> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const { stepId, message } = await findFailedStep(deps.projectRoot, runId);
  const defect = await scaffoldDefect(deps.paths, options.reportsRoot, clock, message, [stepId]);
  const defectId = defect.get(['id']) as string;
  const expressionContext: DebugExpressionContext = { defectId };
  return runWorkflow(deps, {
    workflowId: DEBUG_WORKFLOW_ID,
    expressionContext,
    dryRun: options.dryRun ?? false,
    host: options.host,
    clock,
  });
}
