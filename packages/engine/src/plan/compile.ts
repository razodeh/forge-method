/**
 * `06` §6.2's plan-compilation rule 1: expand every `fanout` node over its collection, using the item's
 * own id in the expanded step id so resume stays stable across a re-compile. This piece stops at that —
 * rules 2–6 (implicit dependencies from contract freeze/resource claims, gate-node insertion, cycle
 * rejection, critical path) are `PLAN-M5.md` P11's own job, against the `StepNode[]` this module produces.
 *
 * `parallel`/`sequence` steps never become a `StepNode` of their own: `10` §10.1's own step-kind table
 * describes them as "explicit grouping when dependencies alone are insufficient," and `06` §6.2's own
 * closed `StepNode.kind` union has no `'parallel'`/`'sequence'` literal to give one anyway. A group's
 * own job is *entirely* discharged by folding its grouping semantics into its children's `dependsOn`
 * edges — a `sequence`'s children chain in array order (each depending on the previous, per
 * `@forge/engine/workflow`'s own `SequenceStep` doc comment: "forces array-order execution among its own
 * children"); a `parallel`'s children each independently inherit the group's own incoming dependency,
 * with no ordering between siblings ("no ordering constraint *relative to each other*"). A dependency
 * declared directly on a `parallel`/`sequence` step's own id (rather than on one of its children) is not
 * resolved by this piece — nothing in `10` §10.1's own worked example exercises it, and rewriting such a
 * reference into the real, expanded child id(s) it should mean is exactly the class of graph-wide
 * dependency rewriting `06` §6.2's own rule 2/3 already assigns to P11, not rule 1's own narrower scope.
 *
 * A `fanout` is always treated as needing its own `id` (`missing-step-id` otherwise) — never itself
 * nested, id-less, inside another fanout's own templated child. `10` §10.1's worked example never nests a
 * fanout that way, and the id format `06` §6.2 gives (`${workflowId}:${stepId}[:${itemKey}]`) has no
 * provision for the extra nesting level a truly general double-fanout-with-no-id would need anyway.
 *
 * @see specs/06 §6.2, §6.7, §6.8
 * @see specs/10 §10.1
 * @see PLAN-M5.md P10
 */
import { ForgeError } from '@forge/core/errors';
import { artifactTypeById } from '@forge/schemas';

import {
  evaluate,
  parseExpression,
  resolveTemplate,
  shellQuoteValue,
  type ResolveTemplateOptions,
} from '../expr/index.ts';
import type { ExpressionContext } from '../expr/index.ts';
import type { AgentStep, FanoutStep, Workflow, WorkflowStep } from '../workflow/index.ts';
import {
  exactKbIdOf,
  isExternalSchemeInputReference,
  isFetchInputReference,
  isSecureFetchInputReference,
} from './input-refs.ts';
import {
  toAgentId,
  type CompileIssue,
  type CompileResult,
  type RetryableFailureClass,
  type StepNode,
  type StepNodeKind,
  type StepNodeLimits,
  type StepNodeOnFailure,
  type StepNodeRetryPolicy,
} from './types.ts';

/** `compilePlan`'s optional third argument (`PLAN-M14.md` P30): the second of the two taint sources
 * `plan/types.ts`'s own `StepNode.taint` doc comment describes -- an authored `mcp:`/`fetch:` input
 * scheme is always detected from the reference text alone (no option needed for that half), but "a KB
 * entry carrying `external` provenance" can only be recognised by matching a step's declared `kb:`/
 * `artifact:` input id against a set `compilePlan` itself has no way to compute (it never opens the KB).
 * The caller (`@forge/cli`, via `collectExternalKbIds`) supplies that set here. Omitted entirely (every
 * call site before this piece, and any call site with no KB open), no step taints this way -- only the
 * scheme-derived half still applies, unchanged. */
export interface CompilePlanTaintOptions {
  /** KB entry / ADR / Runbook ids whose own `sources` carry `kind: 'external'` provenance (`08` §8.3). */
  readonly externalKbIds?: ReadonlySet<string> | readonly string[] | undefined;
}

export interface CompilePlanOptions {
  readonly taint?: CompilePlanTaintOptions | undefined;
}

/** `06` §6.2's own id format, verbatim: `${workflowId}:${stepId}[:${itemKey}]` — the bracketed segment
 * present only for a fanout-expanded item. The one function every later piece that needs to construct or
 * recognise a compiled step id uses, so the format is never duplicated by hand. */
export function compileStepId(workflowId: string, stepId: string, itemKey?: string): string {
  return itemKey === undefined ? `${workflowId}:${stepId}` : `${workflowId}:${stepId}:${itemKey}`;
}

/** Guards the same class of pathological input `@forge/engine/workflow`'s own `MAX_TRAVERSAL_DEPTH`
 * guards against, for the identical reason: `compilePlan`/`expandFanout` are public functions a caller
 * could reach directly, without having run `validateWorkflow` first (which already rejects excessively
 * deep nesting) — defense in depth, not a duplicate of that check, the same lesson `SPEC-QUESTIONS.md`
 * Q71's own verify round just re-confirmed the hard way (never assume an earlier validation pass is the
 * only path to a piece of code). Wide margin under `validateWorkflow`'s own 2000, since this walk also
 * recurses through `parseExpression`/`evaluate`'s own call frames for every fanout it descends through. */
const MAX_COMPILE_DEPTH = 500;

/** `06` §6.8's own comment: "default 3 for agent steps, 1 for gates." Nothing in `06`/`10` states a
 * default for the other six kinds; `1` (no automatic retry) is this piece's own choice for all of
 * them — most represent either a one-shot mechanical action (`command`, `checkpoint`, `merge`,
 * `subworkflow`) or a human-interaction point (`elicit`, `session`) where silently re-attempting has no
 * obvious meaning the way re-running an agent turn does. */
const AGENT_DEFAULT_MAX_ATTEMPTS = 3;
const NON_AGENT_DEFAULT_MAX_ATTEMPTS = 1;

/** No default numbers anywhere in `06`/`10` for either — this piece's own conservative, explicitly-
 * placeholder choice, not a transcription of anything spec-given (contrast `AGENT_DEFAULT_MAX_ATTEMPTS`
 * above, which *is* spec-given). `10` §10.1's own "limits within module ceilings" validation clause
 * describes a real per-role/per-module ceiling system that is `@forge/agents`' own concern (M6,
 * `SPEC-QUESTIONS.md` Q62) — these numbers exist so a compiled `StepNode` always has *some* usable
 * value, not to anticipate what that real system will eventually decide. */
const DEFAULT_LIMITS: StepNodeLimits = { maxTurns: 20, wallClockMs: 600_000, maxCostUsd: 2.0 };
const DEFAULT_BACKOFF_MS: readonly [number, number] = [1000, 30_000];

const RETRYABLE_CLASSES: ReadonlySet<string> = new Set<RetryableFailureClass>([
  'transient',
  'tool-error',
  'validation',
  'test-failure',
  'timeout',
]);
const ON_FAILURE_VALUES = new Set<StepNodeOnFailure>(['block', 'continue', 'escalate', 'replan']);

function issue(code: string, message: string, stepId?: string): CompileIssue {
  return stepId === undefined ? { code, message } : { code, message, stepId };
}

/** `resolveTemplate` throws a real `ForgeError` (`CFG-014`/`CFG-015`, `SPEC-QUESTIONS.md` Q71) — a
 * deliberate difference from this module's own "never throws, collect issues instead" convention,
 * documented at `resolveTemplate`'s own definition: it runs at *execution* time against a single fully-
 * resolved context, where there is no second problem to keep looking for. `compilePlan`/`expandFanout`
 * are exactly the opposite shape (collect every issue across a whole tree of steps and fanout items), so
 * every call site converts a caught `ForgeError` into an ordinary `CompileIssue` and keeps going with an
 * empty-string placeholder — one bad template in one fanout item must not stop this piece from also
 * reporting a real, independent problem in a sibling item or a different step. Anything that is not a
 * `ForgeError` is rethrown, not swallowed: `resolveTemplate`'s own contract only documents these two
 * codes, so anything else is a genuine bug in this file, not a reachable outcome of any template text. */
function safeResolveTemplate(
  template: string,
  context: ExpressionContext,
  issues: CompileIssue[],
  stepId: string,
  options?: ResolveTemplateOptions,
): string {
  try {
    return resolveTemplate(template, context, options);
  } catch (cause) {
    if (cause instanceof ForgeError) {
      issues.push(issue('template-resolution-failed', cause.message, stepId));
      return '';
    }
    throw cause;
  }
}

function toResourceClaims(
  value: string | readonly string[] | undefined,
  context: ExpressionContext,
  issues: CompileIssue[],
  stepId: string,
): readonly string[] {
  if (value === undefined) return [];
  const list = typeof value === 'string' ? [value] : value;
  return list.flatMap((glob) => resolveClaimEntry(glob, context, issues, stepId));
}

/** A `produces` entry that is exactly one placeholder (`"{{item.files_expected}}"`), as `10` §10.1's own
 * worked example writes it, may name a *list* of globs: `09` §9.3's `files_expected` is an array, and
 * `resolveTemplate` (which only ever substitutes a scalar into a larger string) would refuse it with
 * `CFG-015`, leaving the shipped `build-stage` unable to compile for any story with a real claim list. A
 * whole-entry placeholder that evaluates to an array of strings is therefore spliced in as that many
 * claims; anything else (a scalar, a placeholder embedded in longer text, an unresolved path) goes through
 * `safeResolveTemplate` exactly as before, so every existing error path is unchanged. */
const WHOLE_PLACEHOLDER = /^(!?)\{\{([^{}]*)\}\}$/;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function resolveClaimEntry(
  glob: string,
  context: ExpressionContext,
  issues: CompileIssue[],
  stepId: string,
): readonly string[] {
  const whole = WHOLE_PLACEHOLDER.exec(glob.trim());
  const inner = whole?.[2];
  if (inner !== undefined) {
    const parsed = parseExpression(inner);
    if (parsed.success) {
      let value: unknown;
      try {
        value = evaluate(parsed.expr, context);
      } catch (cause) {
        // Not swallowed: the ordinary path below re-evaluates the same text and reports it as an issue.
        if (!(cause instanceof ForgeError)) throw cause;
      }
      // `!{{run.testPaths}}` (`PLAN-M13.md` P36): an exclusion entry (`06` §6.7) spliced from a list, each path negated.
      if (isStringArray(value)) return whole?.[1] === '!' ? value.map((path) => `!${path}`) : value;
    }
  }
  return [safeResolveTemplate(glob, context, issues, stepId)];
}

/** `10` §10.1's own worked example writes every `dependsOn` entry bare — `[ freeze-contracts ]`,
 * `[ "generate-tests:{{item.id}}" ]`, `[ "implement:{{item.id}}" ]` — never prefixed with the workflow's
 * own id, even though a compiled `StepNode.id`/`dependsOn` always is (`06` §6.2's own `${workflowId}:
 * ${stepId}[:${itemKey}]`). An author names a step (or a fanout's own per-item expansion) *within their
 * own workflow*; qualifying with `env.workflowId` is this piece's own job, done once here rather than
 * asking every call site to remember it. Always `env.workflowId`, never the current `baseId` a nested
 * fanout/parallel/sequence happens to be compiling under: a dependency is a reference to *any* other node
 * in the same workflow's own compiled graph, not scoped to whatever container the referencing step
 * happens to sit inside (`@forge/engine/workflow`'s own `SequenceStep` doc comment: "a child may
 * legitimately still depend on a step outside its own group"). */
function qualifyDependsOn(
  raw: readonly string[] | undefined,
  context: ExpressionContext,
  env: CompileEnv,
  issues: CompileIssue[],
  stepId: string,
): readonly string[] {
  return (raw ?? []).map(
    (dep) => `${env.workflowId}:${safeResolveTemplate(dep, context, issues, stepId)}`,
  );
}

function compileRetry(
  step: AgentStep | undefined,
  kind: WorkflowStep['kind'],
  issues: CompileIssue[],
  stepId: string,
): StepNodeRetryPolicy {
  const defaultMaxAttempts =
    kind === 'agent' ? AGENT_DEFAULT_MAX_ATTEMPTS : NON_AGENT_DEFAULT_MAX_ATTEMPTS;
  const authored = step?.retry;
  const retryOn: RetryableFailureClass[] = [];
  for (const candidate of authored?.retryOn ?? [...RETRYABLE_CLASSES]) {
    if (RETRYABLE_CLASSES.has(candidate)) {
      retryOn.push(candidate as RetryableFailureClass);
    } else {
      issues.push(
        issue(
          'invalid-retry-on-value',
          `retryOn value "${candidate}" is not one of: ${[...RETRYABLE_CLASSES].join(', ')}.`,
          stepId,
        ),
      );
    }
  }
  return {
    maxAttempts: authored?.maxAttempts ?? defaultMaxAttempts,
    backoffMs: DEFAULT_BACKOFF_MS,
    retryOn,
  };
}

/** The step kinds that start a model session and so can spend money. Everything else (`command`, `gate`,
 * `merge`, `checkpoint`, `elicit`, `subworkflow`) runs no model: it spends nothing, so it reserves
 * nothing (`PLAN-M13.md` P12, `Q208` finding 2). A `gate`'s advisory critique checks are never dispatched
 * as sessions today (`gates/types.ts`), so they need no reservation either; if a later piece dispatches
 * them, the reservation belongs on the session it starts, not on the gate step. */
const MODEL_STEP_KINDS: ReadonlySet<StepNodeKind> = new Set<StepNodeKind>(['agent', 'session']);

/** The compile-time half of the per-step cost ceiling. A model step's own declared
 * `limits.maxCostUsd` wins and is marked `'step'`; otherwise the placeholder default is used and marked
 * `'default'`, which `resolveStepCostCeilings` (`../run/cost-ceilings.ts`) later replaces with the
 * agent's own `limits.max_cost_usd` or the project's `budget.perStepUsdDefault`, neither of which
 * compilation can see. A step that runs no model reserves `0`. */
function compileLimits(
  kind: StepNodeKind,
  step: AgentStep | undefined,
): { readonly limits: StepNodeLimits; readonly maxCostSource?: 'step' | 'default' } {
  const models = MODEL_STEP_KINDS.has(kind);
  const declared = step?.limits?.maxCostUsd;
  return {
    limits: {
      maxTurns: step?.limits?.maxTurns ?? DEFAULT_LIMITS.maxTurns,
      wallClockMs: DEFAULT_LIMITS.wallClockMs,
      maxCostUsd: models ? (declared ?? DEFAULT_LIMITS.maxCostUsd) : 0,
    },
    ...(models
      ? { maxCostSource: declared === undefined ? ('default' as const) : ('step' as const) }
      : {}),
  };
}

/** The step's own `onFailure` (if a valid one of `06` §6.2's own four values) wins; otherwise the
 * workflow's own `onFailure.default` (if valid); otherwise `'block'` — `06`'s own worked example uses
 * exactly that value as its workflow-wide default, and "block" is the conservative reading of this
 * milestone's repeated "never silently continue" theme (`06` §6.9's own budget-breach handling states the
 * identical preference explicitly). A non-blank value that matches none of the four is a real,
 * `invalid-on-failure-value` compile issue, never silently replaced — `@forge/engine/workflow`'s own P8
 * left this exact validation as "a later piece's own concern to define and enforce," not something to
 * leave unenforced now that this is that piece. */
function compileOnFailure(
  stepOnFailure: string | undefined,
  workflowDefault: string | undefined,
  issues: CompileIssue[],
  stepId: string,
): StepNodeOnFailure {
  if (stepOnFailure !== undefined) {
    if (ON_FAILURE_VALUES.has(stepOnFailure as StepNodeOnFailure))
      return stepOnFailure as StepNodeOnFailure;
    issues.push(
      issue(
        'invalid-on-failure-value',
        `onFailure value "${stepOnFailure}" is not one of: block, continue, escalate, replan.`,
        stepId,
      ),
    );
  }
  if (workflowDefault !== undefined) {
    if (ON_FAILURE_VALUES.has(workflowDefault as StepNodeOnFailure))
      return workflowDefault as StepNodeOnFailure;
    issues.push(
      issue(
        'invalid-on-failure-value',
        `workflow onFailure.default "${workflowDefault}" is not one of: block, continue, escalate, replan.`,
        stepId,
      ),
    );
  }
  return 'block';
}

interface CompileEnv {
  /** The workflow's own declared `inputs:`; see `StepNode.runInputs`. */
  readonly inputs: readonly { readonly name: string; readonly required: boolean }[];
  readonly workflowId: string;
  readonly workflowOnFailureDefault: string | undefined;
  readonly depth: number;
  /** The workflow's top-level `fanout` steps by id: what a `merge` over an *empty* collection needs to know
   * about the fanout it would have waited for (see `mergeDependsOn`). Empty for a standalone `expandFanout`. */
  readonly fanouts?: ReadonlyMap<string, FanoutStep>;
  /** `PLAN-M14.md` P30: `CompilePlanOptions.taint.externalKbIds`, normalised to a `Set` once per
   * `compilePlan` call rather than re-built per step. Empty for `expandFanout`'s own standalone entry
   * point, which takes no taint option (nothing this milestone calls it for declares an external input). */
  readonly externalKbIds: ReadonlySet<string>;
}

interface StepCompileOutcome {
  readonly nodes: readonly StepNode[];
  /** The compiled id(s) nothing further downstream in this same subtree should be considered "done"
   * without — a `sequence`'s own next child, and (per this module's own top-of-file comment) nothing
   * else, since a dependency on the *group's own* id is out of this piece's scope. */
  readonly exitIds: readonly string[];
  readonly issues: readonly CompileIssue[];
  /** The compiled id of every `parallel`/`sequence` step reached in this subtree that declared its own
   * `id` — never a real `StepNode.id` (these groups produce no node of their own), but a real, addressable
   * id per `@forge/engine/workflow`'s own `validateStructure` (`collectAddressableSteps` treats a
   * `parallel`/`sequence`'s own id as a first-class, cycle-checked graph node). A verify round found
   * `checkPlanConsistency`'s own dangling-dependency check (below) initially had no way to tell "this id
   * was never meant to exist" (a typo, or a fanout cross-reference whose itemKey scheme doesn't match its
   * target) apart from "this id names a real group this piece intentionally never expands into its own
   * node" — silently *rejecting* the second case outright, directly contradicting this module's own
   * documented design (a dependency on a group's own id is meant to survive compilation, deferred to
   * P11) and disagreeing with `validateStructure`, which already accepts the identical construct. Threaded
   * up from wherever a group is actually reached, rather than re-derived from the original `Workflow` in
   * a second pass, since re-deriving a fanout-nested group's own real compiled-position id would mean
   * re-evaluating that fanout's own `over` expression a second time, redundantly and with its own chance
   * of disagreeing with what the real compile pass already computed. */
  readonly groupIds: readonly string[];
}

/** `10` §10.1's own `merge` step is `over: "stage.stories"` with `dependsOn: [ "review:{{item.id}}" ]`: one
 * merge-queue node (`10` §10.1's step-kind table, "merge-queue processing for a set of lanes"; `06` §6.2's
 * `StepNode` has no repeating shape for it) that must wait for *every* item's review. A `merge` therefore
 * gets no `item` binding of its own (it is one node), but its `dependsOn` is resolved once per item of its
 * own `over` collection and the results are folded, first occurrence wins, into that one node's
 * `dependsOn`: `[review:s1, review:s2, review:s3]`, in collection order. Q211 (`M13 P13`) is the record.
 *
 * Deliberately conservative:
 * - an `over` that is not a collection (`implement-story`'s `over: 'storyId'`, a step id in `fm-mobile`)
 *   keeps the single-resolution behaviour it always had, so an `{{item...}}` reference there is still
 *   refused rather than guessed;
 * - an *empty* collection must not turn the merge into an unordered root (it would then let the gate after
 *   it, and everything after that, start before the plan's own first step): a per-item entry
 *   `<fanout>:{{item...}}` names a fanout with no instances, so the merge waits for whatever that fanout
 *   itself would have waited for, followed back through any chain of such fanouts (the same "an empty child
 *   is transparent to the chain" rule a `sequence` applies). Entries that are not per-item resolve as usual,
 *   and an entry that names no known fanout, or fails for any other reason, is reported, never dropped;
 * - a per-item reference whose target fanout is not keyed to match is still a `dangling-dependency`
 *   (`checkPlanConsistency`), not a silent no-op;
 * - the same problem in the same entry is reported once, not once per item. */
function mergeDependsOn(
  step: Extract<WorkflowStep, { kind: 'merge' }>,
  context: ExpressionContext,
  env: CompileEnv,
  issues: CompileIssue[],
  stepId: string,
): readonly string[] {
  const raw = step.dependsOn ?? [];
  const collection = evaluateCollection(step.over, context);
  // Anything that is not a collection (a run input, a step id, prose that is not an expression: `over` was
  // never read at compile time before) keeps the single resolution a `merge` always had.
  if (!Array.isArray(collection)) return qualifyDependsOn(raw, context, env, issues, stepId);

  const folded: string[] = [];
  const add = (deps: readonly string[]): void => {
    for (const dep of deps) if (!folded.includes(dep)) folded.push(dep);
  };
  const report = (found: readonly CompileIssue[]): void => {
    for (const problem of found) {
      if (
        !issues.some((known) => known.code === problem.code && known.message === problem.message)
      ) {
        issues.push(problem);
      }
    }
  };

  // Each entry that names a known fanout per item must name one with as many instances as this merge has
  // items, or the merge would skip (or wait on missing) instances.
  for (const entry of raw) {
    const scratch: CompileIssue[] = [];
    const fanout = namedFanout(entry, env);
    if (fanout !== undefined) {
      const named = evaluateCollection(fanout.over, context);
      if (!Array.isArray(named) || named.length !== collection.length) {
        scratch.push(
          issue(
            'merge-over-mismatch',
            `merge over "${step.over}" (${String(collection.length)} items) waits on "${entry}", but that ` +
              `fanout ("${fanout.id ?? entry}", over "${fanout.over}") ` +
              (Array.isArray(named)
                ? `has ${String(named.length)} items`
                : 'did not evaluate to a collection') +
              ': the merge would skip or wait on the wrong instances.',
            stepId,
          ),
        );
      }
    }
    report(scratch);
  }

  if (collection.length === 0) {
    for (const entry of raw) {
      const scratch: CompileIssue[] = [];
      add(emptyCollectionWaits(entry, context, env, scratch, stepId, new Set()));
      report(scratch);
    }
    return folded;
  }
  for (const item of collection as readonly unknown[]) {
    const scratch: CompileIssue[] = [];
    add(qualifyDependsOn(raw, { ...context, item }, env, scratch, stepId));
    report(scratch);
  }
  return folded;
}

/** Evaluates a `merge`'s or fanout's `over` to a value, or `undefined` when it cannot (unparseable, or the
 * evaluator refuses): the caller treats that as "not a collection". */
function evaluateCollection(over: string, context: ExpressionContext): unknown {
  const parsed = parseExpression(over);
  if (!parsed.success) return undefined;
  try {
    return evaluate(parsed.expr, context);
  } catch (cause) {
    if (!(cause instanceof ForgeError)) throw cause;
    return undefined;
  }
}

/** A per-item placeholder: `{{item.id}}`, `{{ item.id }}`, `{{item}}`. */
const ITEM_PLACEHOLDER = /\{\{\s*item\b/;

/** The known fanout a per-item `dependsOn` entry (`<fanout>:...{{item...}}`) names, if any. */
function namedFanout(entry: string, env: CompileEnv): FanoutStep | undefined {
  const at = entry.indexOf(':');
  if (at === -1 || !ITEM_PLACEHOLDER.test(entry.slice(at + 1))) return undefined;
  return env.fanouts?.get(entry.slice(0, at));
}

/** What one `dependsOn` entry of a merge over an empty collection waits for: a per-item entry naming a known
 * fanout waits for that fanout's own `dependsOn` (an empty fanout is transparent, as an empty child is to a
 * `sequence`), followed back through any chain of such fanouts; `path` guards a cycle the validator would
 * already have refused, and is per path so two routes to one fanout (a diamond) both resolve. That the named
 * fanout really is empty is checked by the caller (`merge-over-mismatch`). Anything else resolves normally
 * against the item-less context, so a real error in it is reported. */
function emptyCollectionWaits(
  entry: string,
  context: ExpressionContext,
  env: CompileEnv,
  issues: CompileIssue[],
  stepId: string,
  path: Set<string>,
): readonly string[] {
  const fanout = namedFanout(entry, env);
  if (fanout?.id !== undefined && !path.has(fanout.id)) {
    path.add(fanout.id);
    const waits = (fanout.dependsOn ?? []).flatMap((inner) =>
      emptyCollectionWaits(inner, context, env, issues, stepId, path),
    );
    path.delete(fanout.id);
    return waits;
  }
  return qualifyDependsOn([entry], context, env, issues, stepId);
}

/** `StepNode.runInputs` / `missingRunInputs` for one agent step: each declared workflow input the context
 * supplies (looked up by name at the context root, then in `vars`, where `forge run --epic/--story` puts
 * its values), the fanout `item` when there is one, and the *required* declared inputs it does not supply.
 * Both keys are omitted when there is nothing to carry. */
function runInputsField(
  env: CompileEnv,
  context: ExpressionContext,
): {
  readonly runInputs?: Readonly<Record<string, unknown>>;
  readonly missingRunInputs?: readonly string[];
} {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  const root: Readonly<Record<string, unknown>> = { ...context };
  const vars: Readonly<Record<string, unknown>> =
    typeof context.vars === 'object' && context.vars !== null ? { ...context.vars } : {};
  for (const input of env.inputs) {
    const found = Object.hasOwn(root, input.name)
      ? root[input.name]
      : Object.hasOwn(vars, input.name)
        ? vars[input.name]
        : undefined;
    if (found !== undefined) values[input.name] = found;
    else if (input.required) missing.push(input.name);
  }
  if (context.item !== undefined) values['item'] = context.item;
  return {
    ...(Object.keys(values).length === 0 ? {} : { runInputs: values }),
    ...(missing.length === 0 ? {} : { missingRunInputs: missing }),
  };
}

function buildLeafNode(
  step: Exclude<WorkflowStep, { kind: 'fanout' | 'parallel' | 'sequence' }>,
  compiledId: string,
  env: CompileEnv,
  context: ExpressionContext,
  dependsOn: readonly string[],
): StepCompileOutcome {
  const issues: CompileIssue[] = [];
  const agentStep = step.kind === 'agent' ? step : undefined;
  const sessionStep = step.kind === 'session' ? step : undefined;
  const commandStep = step.kind === 'command' ? step : undefined;

  // What a human answers is not known until the `elicit` step has run, and a plan is compiled before that: a
  // placeholder cannot carry it. A `command` step reads an answer from its environment instead, where it is data
  // however it is spelled (`PLAN-M13.md` P20, `FORGE_ANSWER_<name>`), so the placeholder is refused, saying so.
  if (step.kind === 'command' && /\{\{\s*answers\b/.test(step.run)) {
    issues.push(
      issue(
        'answers-not-known-at-plan-time',
        `Step "${compiledId}" reads an elicit answer with a {{answers...}} placeholder, but answers do not exist until the run asks for them. ` +
          'Read the answer from the environment inside the command instead: "$FORGE_ANSWER_<question name>" (quoted).',
        compiledId,
      ),
    );
  }

  // `PLAN-M14.md` P30: resolved once, ahead of the node literal below, so both the insecure-`fetch:`
  // refusal and the derived-taint check (immediately below) read the same, already-template-resolved
  // strings the node itself carries as `inputs` -- never re-resolving the raw `agentStep.inputs` a
  // second time, which could in principle disagree with what actually landed on the node (it cannot,
  // `resolveTemplate` is pure over the same `context`, but computing it twice would still be two
  // opportunities for the two computations to silently drift apart).
  const resolvedInputs = (agentStep?.inputs ?? []).map((ref) =>
    safeResolveTemplate(ref, context, issues, compiledId),
  );
  // `10` §10.1: `fetch:` accepts only an `https:` URL. A `fetch:http://...` (or any other non-`https:`
  // scheme) reference is refused outright, not silently treated as non-external and packed anyway --
  // `20` §20.6's own "no plaintext secrets in flight" posture extends naturally to "no plaintext fetch
  // of untrusted external content either." Checked against every agent step's `inputs`, not only a
  // step that ends up tainted for some other reason: an insecure scheme is a real authoring mistake
  // regardless of what else the step declares.
  for (const ref of resolvedInputs) {
    if (isFetchInputReference(ref) && !isSecureFetchInputReference(ref)) {
      issues.push(
        issue(
          'insecure-fetch-input-scheme',
          `Step "${compiledId}" declares input "${ref}", which uses "fetch:" with a scheme other than ` +
            'https:; only fetch:<https-url> is allowed (10 §10.1, 20 §20.5/§20.6).',
          compiledId,
        ),
      );
    }
  }
  // `20` §20.5 point 3 / `15` §15.5.4, `PLAN-M14.md` P30: the second of the two taint sources
  // `plan/types.ts`'s own `StepNode.taint` doc comment describes -- present when this agent step's own
  // (resolved) `inputs:` names an external scheme directly (`mcp:`/`fetch:https:`), or names a KB id the
  // caller's own `externalKbIds` set marks as carrying `external` provenance (`08` §8.3). `agentStep`
  // guards this the same way the authored-taint spread below already does: only an `'agent'`-kind step
  // ever has real `inputs:` to derive this from (every other kind's `inputs` field is always `[]`, so
  // `resolvedInputs` is empty and this is trivially `false`).
  const derivedTaint =
    agentStep !== undefined &&
    resolvedInputs.some((ref) => {
      if (isExternalSchemeInputReference(ref)) return true;
      const id = exactKbIdOf(ref);
      return id !== undefined && env.externalKbIds.has(id);
    });

  const node: StepNode = {
    id: compiledId,
    kind: step.kind,
    agent:
      agentStep !== undefined
        ? toAgentId(safeResolveTemplate(agentStep.agent, context, issues, compiledId))
        : undefined,
    // `AgentStep.brief` is a `briefs/*.md` file path; `SessionStep.question` is the literal, already-
    // framed question text `runSessionStep`'s own FRAME phase reads straight off this same compiled
    // field (`SessionStep`'s own doc comment has the full reasoning) — two different authored fields,
    // one shared, kind-overloaded compiled field, matching `06` §6.2's own `StepNode` shape exactly.
    brief: agentStep?.brief ?? sessionStep?.question,
    inputs: resolvedInputs,
    outputs: agentStep?.outputs ?? [],
    dependsOn,
    // `06` §6.2's `StepNode.produces` is shared by every kind; only `agent` and `command` steps author it
    // today (`PLAN-M14.md` P2) — the two are mutually exclusive (`step.kind` narrows both to `undefined`
    // together), so there is nothing to union.
    produces: toResourceClaims(
      agentStep?.produces ?? commandStep?.produces,
      context,
      issues,
      compiledId,
    ),
    consumes: [],
    laneAffinity: step.kind === 'command' && step.inline === true ? 'inline' : undefined,
    retry: compileRetry(agentStep, step.kind, issues, compiledId),
    ...compileLimits(step.kind, agentStep),
    autonomy: undefined,
    idempotencyKey: compiledId,
    onFailure: compileOnFailure(
      agentStep?.onFailure,
      env.workflowOnFailureDefault,
      issues,
      compiledId,
    ),
    ...(agentStep === undefined ? {} : runInputsField(env, context)),
    ...(agentStep?.gateEvidence !== undefined && agentStep.gateEvidence.length > 0
      ? { gateEvidence: agentStep.gateEvidence }
      : {}),
    ...(agentStep?.mode === undefined ? {} : { interactionMode: agentStep.mode }),
    ...(agentStep?.perspectives === undefined || agentStep.perspectives.length === 0
      ? {}
      : { perspectives: agentStep.perspectives }),
    // `20` §20.5 point 3 / `15` §15.5.4, `PLAN-M14.md` P27/P30: the workflow author's own
    // `AgentStep.taint` OR this step's own derived taint (computed just above), present only when at
    // least one of the two holds -- matching `gateEvidence`/`interactionMode`/`perspectives` immediately
    // above. No other step kind ever reaches here with one: `agentStep` is `undefined` for every other
    // kind, and `workflowStepSchema`'s own per-kind schemas make `taint:` unauthorable on them in real
    // YAML; `derivedTaint` is likewise structurally `false` for every non-agent kind (see its own
    // comment above).
    ...(agentStep?.taint === 'external' || derivedTaint ? { taint: 'external' as const } : {}),
    run:
      step.kind === 'command'
        ? // A `command` step's `run` is shell text: every substituted value (a run input, a story or epic field, a
          // fanout item) is quoted so it can only be data, never code (`PLAN-M13.md` P28, `20` §20.5).
          safeResolveTemplate(step.run, context, issues, compiledId, {
            escapeValue: shellQuoteValue,
          })
        : undefined,
    gate: step.kind === 'gate' ? step.gate : undefined,
    workflow: step.kind === 'subworkflow' ? step.workflow : undefined,
    mergePolicy: step.kind === 'merge' ? step.policy : undefined,
    questions: step.kind === 'elicit' ? step.questions : undefined,
    sessionType: sessionStep?.sessionType,
    when: sessionStep?.when,
  };

  return { nodes: [node], exitIds: [compiledId], issues, groupIds: [] };
}

function compileFanout(
  step: FanoutStep,
  baseId: string,
  env: CompileEnv,
  context: ExpressionContext,
  inheritedDependsOn: readonly string[],
): StepCompileOutcome {
  if (step.id === undefined) {
    return {
      nodes: [],
      exitIds: [],
      issues: [issue('missing-step-id', 'A fanout step must declare its own "id".')],
      groupIds: [],
    };
  }
  // Hoisted into a plain `string` binding rather than referencing `step.id` from inside the `forEach`
  // callback below: TS does not carry the `=== undefined` narrowing above across a closure boundary, even
  // though `step` itself is never reassigned.
  const fanoutStepId = step.id;
  const fanoutId = compileStepId(baseId, fanoutStepId);

  const parsed = parseExpression(step.over);
  if (!parsed.success) {
    return {
      nodes: [],
      exitIds: [],
      issues: [
        issue(
          'fanout-over-invalid-expression',
          `fanout "over" ("${step.over}") failed to parse: ${parsed.error.message}`,
          fanoutId,
        ),
      ],
      groupIds: [],
    };
  }
  // A critic round found this call unwrapped: a syntactically ordinary, non-nested-looking flat `&&`/`||`
  // chain in `over` parses cleanly (`parseExpression`'s own recursion guard never sees this shape) but
  // still throws a real `ForgeError` (`CFG-016`) from `evaluate`'s own *separate* depth guard once the
  // resulting left-deep AST is walked (`SPEC-QUESTIONS.md` Q71's own "two independent guards" design) —
  // the identical class of gap `safeResolveTemplate` already exists to close for template placeholders,
  // just reached through `over` instead.
  let collection: unknown;
  try {
    collection = evaluate(parsed.expr, context);
  } catch (cause) {
    if (!(cause instanceof ForgeError)) throw cause;
    return {
      nodes: [],
      exitIds: [],
      issues: [
        issue(
          'fanout-over-evaluation-failed',
          `fanout "over" ("${step.over}") failed to evaluate: ${cause.message}`,
          fanoutId,
        ),
      ],
      groupIds: [],
    };
  }
  if (!Array.isArray(collection)) {
    return {
      nodes: [],
      exitIds: [],
      issues: [
        issue(
          'fanout-over-not-array',
          `fanout "over" ("${step.over}") did not resolve to an array.`,
          fanoutId,
        ),
      ],
      groupIds: [],
    };
  }

  const nodes: StepNode[] = [];
  const exitIds: string[] = [];
  const issues: CompileIssue[] = [];
  const groupIds: string[] = [];

  // `.forEach` silently skips a hole in a sparse array (`[a, , c]`) rather than visiting it as an
  // `undefined`-valued item — a verify round confirmed this, but also confirmed there is no realistic path
  // to it: `collection` here always comes from parsed YAML/JSON (which cannot represent a sparse array at
  // all) or a caller hand-constructing an `ExpressionContext` in TypeScript with a deliberately sparse
  // array literal, neither of which this piece needs to guard against.
  collection.forEach((item: unknown, index) => {
    const itemContext: ExpressionContext = { ...context, item };
    // A bare positional index when itemKey is omitted (P8's own FanoutStep.itemKey is optional, and
    // `10` §10.1's own worked "review" fanout never declared one; the shipped build-stage now does, Q211) --
    // forfeits `06` §6.2's own "resume stays stable across a re-compile *of the same collection order*"
    // guarantee for exactly this
    // fanout, but guarantees uniqueness, which an omitted itemKey would otherwise not: every expanded
    // item still needs a *distinct* compiled id regardless of whether the author gave this fanout a
    // stable natural key to use for it.
    const itemKey =
      step.itemKey !== undefined
        ? safeResolveTemplate(step.itemKey, itemContext, issues, fanoutId)
        : String(index);
    const itemBaseId = compileStepId(baseId, fanoutStepId, itemKey);
    const ownDependsOn = qualifyDependsOn(step.dependsOn, itemContext, env, issues, itemBaseId);
    const combinedDependsOn = [...inheritedDependsOn, ...ownDependsOn];

    const childOutcome = compileStepAtDepth(
      step.step,
      itemBaseId,
      false,
      { ...env, depth: env.depth + 1 },
      itemContext,
      combinedDependsOn,
    );
    nodes.push(...childOutcome.nodes);
    exitIds.push(...childOutcome.exitIds);
    issues.push(...childOutcome.issues);
    groupIds.push(...childOutcome.groupIds);
  });

  return { nodes, exitIds, issues, groupIds };
}

function compileStepAtDepth(
  step: WorkflowStep,
  baseId: string,
  requiresOwnId: boolean,
  env: CompileEnv,
  context: ExpressionContext,
  inheritedDependsOn: readonly string[],
): StepCompileOutcome {
  if (env.depth > MAX_COMPILE_DEPTH) {
    return {
      nodes: [],
      exitIds: [],
      issues: [
        issue(
          'excessive-compile-depth',
          `Workflow step nesting exceeds ${String(MAX_COMPILE_DEPTH)} levels; refusing to compile further.`,
        ),
      ],
      groupIds: [],
    };
  }

  if (step.kind === 'fanout') {
    return compileFanout(step, baseId, env, context, inheritedDependsOn);
  }

  if (step.kind === 'parallel' || step.kind === 'sequence') {
    const nodes: StepNode[] = [];
    const issues: CompileIssue[] = [];
    let exitIds: readonly string[] = [];
    // Recorded even though this group produces no StepNode of its own: `requiresOwnId` mirrors
    // `@forge/engine/workflow`'s own `validateStructure`, which treats a `parallel`/`sequence`'s own id
    // as a real, addressable position (`collectAddressableSteps`) -- something else in this same workflow
    // is allowed to `dependsOn` it directly, per this module's own top-of-file comment, even though
    // resolving *what that means* is explicitly left to P11. `checkPlanConsistency` (called from
    // `compilePlan`) needs this list to tell that deferred, legitimate reference apart from a genuine typo.
    const groupIds: string[] =
      requiresOwnId && step.id !== undefined ? [compileStepId(baseId, step.id)] : [];
    // The group's own `dependsOn` (WorkflowStepBase gives every kind, including parallel/sequence
    // themselves, one) composes with whatever this group's own caller already inherited -- easy to
    // miss, since the group produces no StepNode of its own to visibly carry it.
    const groupOwnDependsOn = qualifyDependsOn(step.dependsOn, context, env, issues, baseId);
    let nextDependsOn: readonly string[] = [...inheritedDependsOn, ...groupOwnDependsOn];

    for (const child of step.steps) {
      const outcome = compileStepAtDepth(
        child,
        baseId,
        true,
        { ...env, depth: env.depth + 1 },
        context,
        nextDependsOn,
      );
      nodes.push(...outcome.nodes);
      issues.push(...outcome.issues);
      groupIds.push(...outcome.groupIds);
      if (step.kind === 'sequence') {
        // Array-order chaining: each child depends on the previous child's own sinks, composed with
        // (not replacing) whatever this child already declares for itself -- a sequence child "may
        // legitimately still depend on a step outside its own group" (SequenceStep's own doc comment),
        // so the chain-derived dependency is additive, never exclusive.
        //
        // A critic round found that a child compiling to zero nodes (an empty nested group, or a fanout
        // whose "over" resolves to an empty array) has empty `exitIds` by construction -- unconditionally
        // advancing the chain to that empty set silently erased everything accumulated so far, so the
        // *next* sibling ended up depending on nothing at all instead of on whatever the sequence had
        // already reached. A child that produced no nodes is transparent to the chain: it is skipped,
        // never made into a dead end for what comes after it.
        if (outcome.exitIds.length > 0) {
          nextDependsOn = outcome.exitIds;
          exitIds = outcome.exitIds;
        }
      } else {
        // parallel: every child starts from the same incoming dependency, independent of its siblings;
        // the group is not "done" until every child's own sinks are.
        exitIds = [...exitIds, ...outcome.exitIds];
      }
    }
    return { nodes, exitIds, issues, groupIds };
  }

  if (requiresOwnId && step.id === undefined) {
    return {
      nodes: [],
      exitIds: [],
      issues: [
        issue(
          'missing-step-id',
          `A "${step.kind}" step in this position must declare its own "id".`,
        ),
      ],
      groupIds: [],
    };
  }
  const compiledId =
    requiresOwnId && step.id !== undefined ? compileStepId(baseId, step.id) : baseId;
  const dependsOnIssues: CompileIssue[] = [];
  const ownDependsOn =
    step.kind === 'merge'
      ? mergeDependsOn(step, context, env, dependsOnIssues, compiledId)
      : qualifyDependsOn(step.dependsOn, context, env, dependsOnIssues, compiledId);
  // A merge folds many dependencies into one node, so one an enclosing group also names is listed once.
  const combined = [...inheritedDependsOn, ...ownDependsOn];
  const outcome = buildLeafNode(
    step,
    compiledId,
    env,
    context,
    step.kind === 'merge' ? [...new Set(combined)] : combined,
  );
  return dependsOnIssues.length > 0
    ? { ...outcome, issues: [...dependsOnIssues, ...outcome.issues] }
    : outcome;
}

/** `10` §10.1's own "fanout `over` resolves to an array" validation clause, actually enforced here (not
 * merely checked for presence, the way `@forge/engine/workflow`'s own P8 already does — that piece checks
 * `over` is present and non-blank "against a schema, not executed," deliberately deferring the real
 * evaluation to this piece, which alone has `@forge/engine/expr` available to do it). Treats `step` as a
 * *top-level* standalone entry point: its own id is required (`missing-step-id` otherwise), it starts
 * with no inherited dependency of its own, and its compiled ids are `${workflowId}:${step.id}[:itemKey]`
 * — exactly what `compilePlan` would produce for this same fanout *if it sat directly under
 * `workflow.steps`*. For a fanout actually nested inside a `parallel`/`sequence`/another `fanout`, this
 * function cannot reproduce what `compilePlan` would compute on its own (the real `baseId` prefix and
 * recursion depth both depend on where the fanout actually sits, which this function — by design, for a
 * caller with only the fanout object in hand — has no way to know); a caller in that position must
 * compute and pass the correct prefix itself, or use `compilePlan` directly.
 *
 * `workflowOnFailureDefault` is optional and defaults to `undefined` (matching a fanout with no
 * surrounding workflow to inherit one from) — but a caller who *does* have the enclosing workflow in hand
 * and wants this function to compile a *top-level* fanout exactly the way `compilePlan` would must pass
 * `workflow.onFailure?.default` through explicitly. A critic round found this defaulted silently to
 * `undefined` unconditionally, so calling this function directly on a fanout that sits inside a workflow
 * with its own `onFailure.default` produced a different compiled `onFailure` than `compilePlan` would for
 * the exact same step. */
export function expandFanout(
  step: FanoutStep,
  workflowId: string,
  context: ExpressionContext,
  workflowOnFailureDefault?: string,
): CompileResult {
  const env: CompileEnv = {
    inputs: [],
    workflowId,
    workflowOnFailureDefault,
    depth: 0,
    externalKbIds: new Set(),
  };
  const outcome = compileFanout(step, workflowId, env, context, []);
  return outcome.issues.length > 0
    ? { success: false, issues: outcome.issues }
    : { success: true, nodes: outcome.nodes };
}

/** A critic round found that neither this file nor `@forge/engine/workflow`'s own `validateStructure`
 * (which only reasons about the *static, unexpanded* graph, confirmed by inspection of `checkNoCycles`'s
 * own doc comment) ever checks a `dependsOn` value against the *real, expanded* set of compiled ids —
 * `dependsOn: ['nonexistent']`, or a per-item cross-fanout reference whose `itemKey` scheme doesn't
 * actually match the fanout it points at (`10` §10.1's own worked `review` fanout, which omits
 * `itemKey`, expands to positional-index ids — a sibling fanout templating a reference against `item.id`
 * instead silently produces a dangling, permanently-unsatisfiable dependency, not a wrong-but-honest one
 * and not a caught error), compiled cleanly with `success: true` before this check existed. Two duplicate
 * compiled ids (a `parallel`/`sequence` never folds its own children's ids together with anything that
 * would make two same-named children in two different groups distinguishable, unlike a fanout's own
 * itemKey/index suffix) had the identical silent-`success`-with-wrong-output problem. Both are checked
 * here, once, against the *complete* compiled node list — `expandFanout`'s own narrower, standalone
 * compile of a single fanout deliberately does not run this check, since a real per-item `dependsOn` may
 * legitimately name a sibling step this function alone was never asked to compile (`generate-tests`'s own
 * real cross-reference to `contracts-gate`, for instance) — only `compilePlan`, which sees the whole
 * workflow at once, can tell a genuinely dangling reference apart from an out-of-scope one. Runs only
 * when the tree walk itself found no issues: checking dependency resolution against an already-known-
 * incomplete node list (a `fanout` that failed to expand at all, say) would produce confusing, cascading
 * "dangling" noise on top of the more fundamental problem already reported.
 *
 * `groupIds` (a `parallel`/`sequence` step's own id, wherever one declared one — `StepCompileOutcome`'s
 * own doc comment has the fuller reasoning) are treated as resolvable too, alongside real `StepNode` ids:
 * a verify round found the first version of this check treated a dependency on a group's own bare id
 * exactly like a typo, silently *regressing* behaviour this module's own top-of-file comment already
 * documents as intentional (deferred to P11, not resolved here) and that `validateStructure` already
 * accepts. Not folded into `seenIds`/duplicate-checking, though: a group's own id and a real compiled
 * node's own id are different *kinds* of thing (one names an erased, never-instantiated position; the
 * other names a real, schedulable node), and nothing here needs to detect a group id colliding with a
 * node id — no evidence anywhere this can occur outside of a deliberately-contrived fixture, since a
 * group and a leaf can never occupy the same id-producing position in the tree this module walks. */
/** `PLAN-M14.md` P41: `@forge/engine/workflow`'s own `validateStructure`/`checkElicitShow` fail-closed
 * checks for an `elicit` question's `show`, repeated here over the real, EXPANDED graph -- the identical
 * two-file split `duplicate-elicit-question` already has just above, and for the identical reason
 * (`elicit-questions.test.ts`: "compilePlan refuses it too: forge run does not call validateStructure").
 * Only called once `byId` is unambiguous (`checkPlanConsistency`'s own `duplicateIds.size === 0` gate,
 * matching `dangling-dependency`'s identical precondition): `node.dependsOn` here is already the real,
 * fully-qualified compiled id a fanout/parallel/sequence expansion produced, so this can see a producer
 * `validateStructure`'s own *unexpanded* walk has no way to. */
function elicitShowIssues(
  nodes: readonly StepNode[],
  byId: ReadonlyMap<string, StepNode>,
): readonly CompileIssue[] {
  const issues: CompileIssue[] = [];
  const ancestorsOf = (id: string): ReadonlySet<string> => {
    const seen = new Set<string>();
    const pending = [...(byId.get(id)?.dependsOn ?? [])];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...(byId.get(next)?.dependsOn ?? []));
    }
    return seen;
  };
  for (const node of nodes) {
    for (const question of node.questions ?? []) {
      const { show } = question;
      if (show === undefined) continue;
      const definition = artifactTypeById(show.type);
      if (definition?.collection !== true) {
        issues.push(
          issue(
            'elicit-show-not-a-register',
            `Step "${node.id}"'s question "${question.name}" shows ${JSON.stringify(show.type)}, which is not a collection: true register type (18 §18.7).`,
            node.id,
          ),
        );
        continue;
      }
      const produced = [...ancestorsOf(node.id)].some((id) => {
        const ancestor = byId.get(id);
        return (
          ancestor?.kind === 'agent' &&
          ancestor.outputs.some(
            (output) =>
              output.type === show.type &&
              (show.subtype === undefined || output.subtype === show.subtype),
          )
        );
      });
      if (!produced) {
        const subtypeText =
          show.subtype === undefined ? '' : ` (subtype ${JSON.stringify(show.subtype)})`;
        issues.push(
          issue(
            'elicit-show-not-produced',
            `Step "${node.id}"'s question "${question.name}" shows ${JSON.stringify(show.type)}${subtypeText}, but no step it depends on declares producing it in its own outputs.`,
            node.id,
          ),
        );
      }
    }
  }
  return issues;
}

function checkPlanConsistency(
  nodes: readonly StepNode[],
  groupIds: readonly string[],
): readonly CompileIssue[] {
  const issues: CompileIssue[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) duplicateIds.add(node.id);
    seenIds.add(node.id);
  }
  for (const id of duplicateIds) {
    issues.push(
      issue('duplicate-compiled-step-id', `More than one compiled step has the id "${id}".`, id),
    );
  }
  const questionOwners = new Map<string, string[]>();
  for (const node of nodes) {
    for (const question of node.questions ?? []) {
      questionOwners.set(question.name, [...(questionOwners.get(question.name) ?? []), node.id]);
    }
  }
  for (const [name, owners] of questionOwners) {
    if (owners.length > 1) {
      issues.push(
        issue(
          'duplicate-elicit-question',
          `Elicit question "${name}" is asked by ${owners.join(', ')}; a question name must be unique in a workflow, because it names the answer every later step reads.`,
        ),
      );
    }
  }
  if (duplicateIds.size === 0) {
    const resolvableIds = new Set([...seenIds, ...groupIds]);
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        if (!resolvableIds.has(dep)) {
          issues.push(
            issue(
              'dangling-dependency',
              `Step "${node.id}" depends on "${dep}", which does not match any compiled step's own id.`,
              node.id,
            ),
          );
        }
      }
    }
    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    issues.push(...elicitShowIssues(nodes, byId));
  }
  return issues;
}

/** The workflow's `fanout` steps by id, looking inside `parallel`/`sequence` groups (a dependency names a step by
 * its bare id wherever it sits) but not inside another fanout's per-item child. */
function collectFanouts(steps: readonly WorkflowStep[]): ReadonlyMap<string, FanoutStep> {
  const found = new Map<string, FanoutStep>();
  const walk = (list: readonly WorkflowStep[]): void => {
    for (const step of list) {
      if (step.kind === 'fanout') {
        if (step.id !== undefined) found.set(step.id, step);
      } else if (step.kind === 'parallel' || step.kind === 'sequence') {
        walk(step.steps);
      }
    }
  };
  walk(steps);
  return found;
}

/** `06` §6.2's own plan-compilation rule 1, for a whole workflow's own `steps:` list — `workflow.
 * onComplete`/`workflow.onFailure.escalations[].do` are deliberately not compiled here: both are
 * conditionally-triggered subtrees outside the main DAG proper (one runs only once the whole run
 * finishes, the other only on a specific failure match), not part of "the DAG" `06` §6.1's own execution-
 * model diagram shows compilation producing — whichever later piece actually implements run-completion
 * and failure-escalation behaviour compiles those subtrees against its own, narrower context at the point
 * it needs to, the same "generic mechanism now, real content and remaining behaviour later" split
 * `SPEC-QUESTIONS.md` Q62 already established for this milestone's own scope. */
export function compilePlan(
  workflow: Workflow,
  context: ExpressionContext,
  options: CompilePlanOptions = {},
): CompileResult {
  const env: CompileEnv = {
    inputs: workflow.inputs ?? [],
    workflowId: workflow.id,
    workflowOnFailureDefault: workflow.onFailure?.default,
    depth: 0,
    fanouts: collectFanouts(workflow.steps),
    externalKbIds: new Set(options.taint?.externalKbIds ?? []),
  };
  const nodes: StepNode[] = [];
  const issues: CompileIssue[] = [];
  const groupIds: string[] = [];

  for (const step of workflow.steps) {
    const outcome = compileStepAtDepth(step, workflow.id, true, env, context, []);
    nodes.push(...outcome.nodes);
    issues.push(...outcome.issues);
    groupIds.push(...outcome.groupIds);
  }

  if (issues.length === 0) {
    issues.push(...checkPlanConsistency(nodes, groupIds));
  }

  return issues.length > 0
    ? { success: false, issues }
    : { success: true, nodes: attachDependentGateEvidence(nodes) };
}

/** `05` §5.3 block [7] ("the checks that will be run against this step's output"): an agent step's
 * evidence gates are the ones it names in `gateEvidence:` plus every `gate` step that directly depends on
 * it -- the gate that will actually judge its output whether or not the author repeated the name. Sorted
 * and de-duplicated so the same plan always yields the same list (prompt determinism across resume). */
function attachDependentGateEvidence(nodes: readonly StepNode[]): readonly StepNode[] {
  const dependentGates = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (node.kind !== 'gate' || node.gate === undefined) continue;
    for (const dependencyId of node.dependsOn) {
      const gates = dependentGates.get(dependencyId) ?? new Set<string>();
      gates.add(node.gate);
      dependentGates.set(dependencyId, gates);
    }
  }
  return nodes.map((node) => {
    if (node.kind !== 'agent') return node;
    const merged = new Set<string>([
      ...(node.gateEvidence ?? []),
      ...(dependentGates.get(node.id) ?? []),
    ]);
    if (merged.size === 0) return node;
    return { ...node, gateEvidence: [...merged].sort() };
  });
}
