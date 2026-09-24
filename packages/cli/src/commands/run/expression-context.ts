/**
 * The expression context `forge run <workflow> [--stage <id>] [--epic <id>] [--story <id>] [--input <name>=<value>]...`
 * compiles and runs a workflow against (`03` §3.2.4, `06` §6.2, `10` §10.1). Before `PLAN-M13.md` P21 this was
 * `{stage: '<id>', vars: {epic, story}}`, which five shipped workflows cannot compile against (`plan-stage`,
 * `build-stage`, `implement-story`, `quick-fix`, `debug`: `stageId`, `ownerRole`, `defectId` and
 * `vars.integration_branch` had no way to be supplied, and `build-stage`'s `stage.stories` was a string's
 * property), and `PLAN-M13.md` P13 found `forge run build-stage --stage X` could not start (Q211 open item 1).
 *
 * What it builds, from the workflow's own declaration of what it needs:
 *
 * - `--input <name>=<value>` (repeatable) lands at the root of the context under its own name, typed by the
 *   workflow's declared `inputs:` type: that is where `{{stageId}}` and its kin resolve.
 * - `--stage S` also supplies `stageId`, and `--story S` also `storyId`, unless `--input` gives the same input
 *   (two different values is refused, not resolved by precedence). `--epic` and `--story` still fill
 *   `vars.epic` / `vars.story` as before.
 * - A workflow that fans out over `stage.stories` (`build-stage`) gets the stage's ordered stories, built from the
 *   project's Epics and Stories by the reader `forge plan run-plan` uses (`readStageStories`), never a second
 *   one. A workflow that does not (`plan-stage`, which is what writes the Epics) is not refused for their absence.
 * - The workflow's own `vars:` block (`integration_branch: 'forge/integration/{{stageId}}'`) is resolved over the
 *   inputs into `vars`, which nothing else in the run path did.
 * - `ownerRole` is read from the Story document when `--story` names one (the identical read `forge implement`
 *   makes, `09` §9.3); no ownership rule is invented, and `--input ownerRole=` still wins. A workflow that
 *   claims the story's paths (`implement-story`'s `produces: '{{run.filesExpected}}'`) gets them as `run`, from
 *   the same document.
 *
 * A workflow that cannot be planned for want of an input is refused with the input named and the flag that
 * supplies it (`RUN-089`), before any lane exists, not with the compiler's list of unresolved placeholders.
 *
 * - `config.paths.release` (`PLAN-M14.md` P12, `SPEC-QUESTIONS.md` Q216 / Q232 decision 4): the one leaf of
 *   the project's config exposed at the expression language's `config` root, and only when it is non-empty —
 *   nothing else of the config object is exposed this way. A workflow that reads it while the project has not
 *   set it (`store-release`'s `prepare-release-build`, claiming the app's own release-build paths) is refused
 *   (`RUN-106`) before `compileRunPlan` runs at all, naming the key and the `forge config set` line, rather
 *   than silently compiling a narrower claim than the workflow author wrote.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.1
 * @see PLAN-M13.md P21
 * @see PLAN-M14.md P12
 */
import { ForgeError } from '@forge/core/errors';
import type { ExpressionContext } from '@forge/engine/expr';
import {
  buildStageRunContext,
  compileRunPlan,
  orderedStageStories,
  resolveWorkflowVars,
  SEPARATED_ROLES,
  workflowReadsStageCollections,
} from '@forge/engine/plan';
import { parseWorkflow, type Workflow } from '@forge/engine/workflow';

import {
  assertShellSafe,
  coerceInput,
  inputRefusal,
  parseInputPairs,
  readsRunValues,
  referencedRunInputs,
  shellFacingInputs,
} from './inputs.ts';
import { ownerRoleProblem, readImplementationRoles } from '../implementation-roles.ts';
import { collectExternalKbIds } from './external-kb-ids.ts';
import { planStageForRun } from './run-plan.ts';
import { readStoryRunInputs } from './story-inputs.ts';
import { readWorkflowSource, type RunDeps } from './run.ts';
import { sanitizeRefusalText } from './vcs-refusal.ts';

/** What the command line said about a run's inputs. */
export interface RunInputFlags {
  readonly stage?: string | undefined;
  readonly epic?: string | undefined;
  readonly story?: string | undefined;
  /** The raw `--input` values, `name=value`, in the order given. */
  readonly inputs?: readonly string[] | undefined;
}

/** `ExpressionContext` is a closed set of the language's helper roots, but a workflow's run inputs
 * (`{{stageId}}`) resolve at the root too (`@forge/engine/expr`'s `resolvePath` walks the context itself), the
 * same narrow extension `forge implement` and `forge plan` declare for their own inputs. */
export type RunExpressionContext = ExpressionContext & Readonly<Record<string, unknown>>;

export interface BuiltRunContext {
  readonly context: RunExpressionContext;
  /** Non-fatal things about the stage's documents (a story already delivered, one already in progress), for the
   * caller to print; never `error` findings, which are refused. */
  readonly warnings: readonly string[];
}

/** How many finding messages a refusal spells out before summarising the rest. */
const MAX_FINDINGS_LISTED = 5;

function oneLine(text: string): string {
  return sanitizeRefusalText(text);
}

function refuseMissing(workflowId: string, missing: readonly string[]): never {
  throw new ForgeError('RUN-089', { workflowId, missing: missing.join(', ') });
}

/** Every string scalar anywhere in a parsed value — the identical small walk `./inputs.ts`'s own
 * `collectStrings` runs for `referencedRunInputs` (duplicated rather than imported: that function is not
 * exported, and this is six lines). A comment is not part of the parsed document, so a placeholder
 * mentioned only in one is not something the workflow reads — the same reasoning that walk documents. */
function collectWorkflowStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value as readonly unknown[]) collectWorkflowStrings(entry, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) collectWorkflowStrings(entry, into);
  }
}

/** Whether the parsed workflow reads `config.paths.release` anywhere — as the whole of a placeholder
 * (`resolveClaimEntry`'s own whole-placeholder splice, `plan/compile.ts:150-173`, the shape
 * `store-release.workflow.yaml`'s `produces` uses) or embedded in longer text. The one config leaf
 * `buildRunExpressionContext` ever exposes (below); nothing else under `config` is real yet, so nothing
 * else needs a name here.
 *
 * Scoped to `{{...}}`-wrapped text, the same shape `resolveClaimEntry`/`resolveTemplate` themselves ever
 * substitute into: `SessionStep.when`/`OnFailureEscalation.when` carry a bare expression (no `{{}}`), so a
 * reference to `config.paths.release` written only there would not be found here. Not a live gap today —
 * neither field is evaluated by any shipped code yet (`plan/compile.ts`'s own doc comment defers both to
 * "whichever later piece actually implements" that) — but whoever wires one up should extend this check
 * (or drop the `{{}}` requirement) at the same time, not discover the silent miss later. */
function referencesConfigPathsRelease(workflow: unknown): boolean {
  const strings: string[] = [];
  collectWorkflowStrings(workflow, strings);
  return strings.some((text) =>
    [...text.matchAll(/\{\{(.*?)\}\}/g)].some((match) =>
      /(?<![\w.])config\.paths\.release(?![\w.])/.test(match[1] ?? ''),
    ),
  );
}

/**
 * Builds the run's expression context.
 *
 * @throws {ForgeError} `RUN-088` (a malformed, contradictory or shell-unsafe `--input`), `RUN-089` (an input the
 * workflow needs was not supplied), `RUN-082` (the stage is declared by no Epic), `RUN-090` (the stage cannot be run
 * as it stands: contradicting documents, a blocked story, nothing left to build), `RUN-091` (the story's owner role
 * would break `10` §10.6's separations), `SPEC-024`/`SPEC-025` (`--story` names no Story, or one with no owner role),
 * `RUN-053` (no such workflow), `RUN-106` (the workflow reads `config.paths.release` and the project has not set
 * it), and the reader's own `CFG-006`/`CFG-007` for a corrupt specs document. A workflow that does not parse is not
 * diagnosed here: it gets the legacy context and the run's own `RUN-045` says why.
 */
export async function buildRunExpressionContext(
  deps: RunDeps,
  workflowId: string,
  flags: RunInputFlags,
  specsRoot: string,
): Promise<BuiltRunContext> {
  const source = await readWorkflowSource(deps, workflowId);
  // Pairs are judged before the workflow is: a malformed `--input` is the same refusal whatever it is given to.
  const supplied = parseInputPairs(flags.inputs ?? []);
  const parsed = parseWorkflow(source);
  if (!parsed.success) return { context: legacyContext(flags), warnings: [] };
  const workflow = parsed.workflow;
  // `PLAN-M14.md` P30: read once here and handed to both `planStageForRun` (the stage's own nested
  // compile, below) and `assertPlannable`'s own compile, so a step tags identically in this pre-flight
  // check as it will in the real run that follows it (`runWorkflow`'s own identical, independent read of
  // the same project KB, `run.ts`'s own doc comment on why "dry run and real run agree" means one shared
  // computation per invocation, not that every caller must read the KB in lockstep with every other).
  const externalKbIds = await collectExternalKbIds(deps.paths, deps.config.paths.kb);

  const declared = new Map((workflow.inputs ?? []).map((input) => [input.name, input]));
  const values = new Map<string, unknown>();
  for (const [name, raw] of supplied)
    values.set(name, coerceInput(name, raw, declared.get(name)?.type));

  // `--stage`/`--story` are the same inputs under their spec names (`03` §3.2.4), not a second source of truth.
  alias(values, supplied, 'stageId', flags.stage, '--stage');
  alias(values, supplied, 'storyId', flags.story, '--story');
  if (flags.epic?.trim() === '') {
    throw inputRefusal(`--epic ${flags.epic}`, '--epic needs a value');
  }

  const warnings: string[] = [];
  const referenced = new Set(referencedRunInputs(workflow));
  for (const name of supplied.keys()) {
    if (declared.has(name) || referenced.has(name)) continue;
    warnings.push(
      `--input ${name} is not declared by workflow ${workflowId} and nothing in it reads {{${name}}}, so it is ignored.`,
    );
  }

  // Command steps run through a shell: a value that can reach one may only be a plain token. Checked before any
  // document is read (a hostile id is refused, not looked up) and again once `ownerRole` has been derived.
  const shellFacing = shellFacingInputs(workflow);
  const assertShellValues = (): void => {
    for (const name of shellFacing.inputs) {
      const value = values.get(name);
      if (typeof value === 'string') assertShellSafe(name, value, workflowId);
    }
    // `--stage`, `--epic` and `--story` are also readable as `{{stage}}`, `{{vars.epic}}` and `{{vars.story}}`.
    const flagValues: readonly [string, string | undefined, boolean][] = [
      ['--stage', flags.stage, shellFacing.stage],
      ['--epic', flags.epic, shellFacing.epic],
      ['--story', flags.story, shellFacing.story],
    ];
    for (const [flag, value, reaches] of flagValues) {
      if (reaches && value !== undefined) assertShellSafe(flag, value, workflowId);
    }
  };
  assertShellValues();

  // A Story document is read when the workflow needs what only it says: who implements it (`ownerRole`, an
  // input it declares) or the paths it claims (`{{run.filesExpected}}`, `{{run.testPaths}}`).
  const storyId = values.get('storyId');
  const needsClaim = readsRunValues(workflow);
  const needsOwner = declared.has('ownerRole') || referenced.has('ownerRole');
  let runValues: Record<string, unknown> | undefined;
  if (typeof storyId === 'string' && (needsOwner || needsClaim)) {
    const story = await readStoryRunInputs(deps, specsRoot, storyId);
    const state =
      story.status === 'done' || story.status === 'verified'
        ? `already ${story.status}`
        : story.status === 'blocked' || story.blockedBy.length > 0
          ? `blocked${story.blockedBy.length > 0 ? ` by ${story.blockedBy.join(', ')}` : ''}`
          : undefined;
    if (state !== undefined) {
      throw new ForgeError('RUN-092', { storyId: oneLine(storyId), state: oneLine(state) });
    }
    const given = values.get('ownerRole');
    if (given !== undefined && given !== story.ownerRole) {
      throw inputRefusal(
        `ownerRole=${JSON.stringify(given)}`,
        `the Story document ${storyId} says owner_role is ${JSON.stringify(story.ownerRole)}, and the Story decides who implements it (09 §9.3): change its owner_role, do not override it here`,
      );
    }
    if (needsOwner) values.set('ownerRole', story.ownerRole);
    assertShellValues();
    if (needsClaim) runValues = { filesExpected: story.filesExpected, testPaths: story.testPaths };
  }

  // The stage id may have been typed as a number for a workflow that declares it so; the stage is looked up by text.
  const rawStageId = values.get('stageId');
  const stageId =
    typeof rawStageId === 'string'
      ? rawStageId
      : typeof rawStageId === 'number'
        ? String(rawStageId)
        : undefined;
  const readsStage = workflowReadsStageCollections(workflow);
  const missing = [...declared.values()]
    .filter((input) => input.required && !values.has(input.name))
    .map((input) => input.name);
  if (readsStage && stageId === undefined && !missing.includes('stageId')) {
    missing.unshift('stageId');
  }
  if (missing.length > 0) refuseMissing(workflowId, missing);

  const root: Record<string, unknown> = {};
  let vars: Record<string, unknown> = {};
  if (flags.epic !== undefined) vars['epic'] = flags.epic;
  if (flags.story !== undefined) vars['story'] = flags.story;
  const inputValues: Record<string, unknown> = {};
  for (const name of [...values.keys()].sort()) inputValues[name] = values.get(name);

  if (readsStage && stageId !== undefined) {
    const plan = await planStageForRun(
      {
        paths: deps.paths,
        workflowsRoot: deps.workflowsRoot,
        specsRoot,
        agentsRoot: deps.agentsRoot,
      },
      stageId,
      workflow,
      { ...inputValues, ...(runValues === undefined ? {} : { run: runValues }), vars },
      { externalKbIds },
    );
    const refusals = plan.findings
      .filter((f) => f.severity === 'error' || RUN_REFUSED_WARNINGS.has(f.code))
      .map((f) => oneLine(`${f.code}: ${f.message}`));
    if (plan.stories.length === 0 && refusals.length === 0) {
      refusals.push(
        'no-story-to-build: no story of this stage is left to build (none exists, or all are delivered).',
        ...plan.findings
          .filter((f) => f.severity === 'warning')
          .map((f) => oneLine(`${f.code}: ${f.message}`)),
      );
    }
    if (refusals.length > 0) {
      const listed = refusals.slice(0, MAX_FINDINGS_LISTED);
      const more = refusals.length - listed.length;
      const text =
        more > 0 ? `${listed.join(' | ')} | and ${String(more)} more` : listed.join(' | ');
      throw new ForgeError('RUN-090', {
        stageId,
        findings: /[.!?]$/.test(text) ? text : `${text}.`,
      });
    }
    for (const finding of plan.findings) {
      if (finding.severity === 'warning') {
        warnings.push(oneLine(`${finding.code}: ${finding.message}`));
      }
    }
    const stageContext = buildStageRunContext(
      workflow,
      stageId,
      orderedStageStories(plan),
      new Map(Object.entries(plan.runsAfter)),
    );
    root['stage'] = stageContext.stage;
    vars = { ...vars, ...stageContext.vars };
  } else if (flags.stage !== undefined) {
    root['stage'] = flags.stage;
  }

  if (runValues !== undefined) root['run'] = runValues;
  // `config.paths.release` (`PLAN-M14.md` P12): the one leaf of the project's config exposed at the
  // expression language's `config` root, and only when it is non-empty — a workflow that reads it while
  // the project has not set it is refused below (`RUN-106`), not handed an empty claim silently. The
  // field is optional in the schema (a `.forge/config.yaml` written before this piece has no such key,
  // `@forge/schemas/config`'s own `pathsSchema`), and absent carries the identical meaning "unset" that
  // an explicit `[]` does — both refuse the identical way, so `?? []` is not a guess at a default, it is
  // the one real meaning the missing key has.
  const releaseGlobs = deps.config.paths.release ?? [];
  if (releaseGlobs.length > 0) root['config'] = { paths: { release: releaseGlobs } };
  Object.assign(root, inputValues);

  // The workflow's own `vars:` last, over the inputs above; a var it cannot resolve is left out and, if a step
  // reads it, the compile check below names the input that was missing.
  vars = { ...vars, ...resolveWorkflowVars(workflow, { ...root, vars }) };
  if (Object.keys(vars).length > 0) root['vars'] = vars;

  const context: RunExpressionContext = root;

  // Before anything compiles (`RUN-106`): the project has not set `paths.release`, and the workflow reads
  // it. Left unchecked, `resolveClaimEntry`'s own whole-placeholder splice would resolve the reference to
  // zero claim entries with no message at all — `assertPlannable`'s own missing-input check does not cover
  // this either, since `config.paths.release` is not a run input (`evaluate.ts` resolves a missing/empty
  // path to `undefined`/`[]`, not an unsupplied-input finding).
  if (releaseGlobs.length === 0 && referencesConfigPathsRelease(workflow)) {
    throw new ForgeError('RUN-106', { workflowId });
  }

  const ownerForRoles = context['ownerRole'];
  const roles =
    typeof ownerForRoles === 'string'
      ? await readImplementationRoles(deps.paths, deps.agentsRoot)
      : undefined;
  assertPlannable(workflow, workflowId, context, roles, values.get('storyId'), externalKbIds);
  return { context, warnings };
}

/** Findings the stage plan reports as warnings (it can still plan around them) that a run must not start on: a
 * blocked story would be scheduled and run, and so would one waiting on an undelivered story of another stage; and
 * a workflow that does not compile to steps for the stage (or has no steps keyed by story id) would run with the
 * stories' ordering and the `10` §10.6 separations silently not applied. */
const RUN_REFUSED_WARNINGS: ReadonlySet<string> = new Set([
  'story-blocked',
  'dependency-outside-stage',
  'step-plan-unavailable',
]);

/** The context `forge run` built before run inputs existed: `stage` as the given string, `epic`/`story` in `vars`. */
function legacyContext(flags: RunInputFlags): RunExpressionContext {
  const vars: Record<string, string> = {};
  if (flags.epic !== undefined) vars['epic'] = flags.epic;
  if (flags.story !== undefined) vars['story'] = flags.story;
  return {
    ...(flags.stage !== undefined ? { stage: flags.stage } : {}),
    ...(Object.keys(vars).length > 0 ? { vars } : {}),
  };
}

function alias(
  values: Map<string, unknown>,
  supplied: ReadonlyMap<string, string>,
  name: string,
  flagValue: string | undefined,
  flag: string,
): void {
  if (flagValue === undefined) return;
  if (flagValue.trim() === '') {
    throw inputRefusal(`${flag} ${flagValue}`, `${flag} needs a value`);
  }
  const explicit = supplied.get(name);
  if (explicit !== undefined && explicit !== flagValue) {
    throw inputRefusal(
      `${name}=${explicit}`,
      `${flag} ${flagValue} also supplies ${name}, and the two disagree; pass only one`,
    );
  }
  values.set(name, flagValue);
}

/** A workflow that still does not compile because a placeholder at the root of the context has no value is refused
 * naming those placeholders. Any other compile failure is left alone: the run's own `RUN-045` (or `--dry-run`'s
 * printed issues) reports it, as before, since a broken workflow is not a missing input. A workflow that does
 * compile is checked for `10` §10.6's separations: a story owned by `sdet` or `reviewer` would run its tests, or
 * its review, and its implementation under one role (`RUN-091`; the stage plan says the same for `build-stage`), and
 * that the owner is an implementation role at all (`RUN-097`, `PLAN-M13.md` P36). */
function assertPlannable(
  workflow: Workflow,
  workflowId: string,
  context: RunExpressionContext,
  implementationRoles: readonly string[] | undefined,
  storyId: unknown,
  externalKbIds: ReadonlySet<string> | undefined,
): void {
  const compiled = compileRunPlan(workflow, context, { taint: { externalKbIds } });
  if (!compiled.success) {
    const unsupplied = referencedRunInputs(workflow).filter(
      (name) => !Object.hasOwn(context, name),
    );
    if (unsupplied.length > 0) refuseMissing(workflowId, unsupplied);
    return;
  }
  const owner = context['ownerRole'];
  if (typeof owner !== 'string') return;
  const role = owner.trim().toLowerCase();
  if (SEPARATED_ROLES.has(role)) {
    const running = compiled.nodes.filter(
      (node) => node.kind === 'agent' && String(node.agent).trim().toLowerCase() === role,
    );
    if (running.length >= 2) {
      throw new ForgeError('RUN-091', {
        workflowId,
        role: owner,
        steps: running.map((node) => node.id).join(', '),
      });
    }
  }
  // Every owner must be an implementation role (`PLAN-M13.md` P36): the steps that run as it write the story's source.
  const problem = ownerRoleProblem(owner, implementationRoles);
  if (problem !== undefined) {
    throw new ForgeError('RUN-097', {
      storyId: oneLine(typeof storyId === 'string' ? storyId : workflowId),
      detail: oneLine(problem),
    });
  }
}
