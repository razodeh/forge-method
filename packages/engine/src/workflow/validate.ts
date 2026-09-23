/**
 * `validateStructure`/`validateWorkflow` — `10` §10.1's own "Validation" subsection, the subset
 * `PLAN-M5.md` P8 curates for this piece: unique step ids, static-`dependsOn` cycle detection,
 * well-formed `produces` globs (`validateStructure`, no external knowledge needed); referenced agents,
 * briefs, gates, artifacts and workflows exist, per a caller-supplied oracle (`validateWorkflow`,
 * `SPEC-QUESTIONS.md` Q62's forward-dependency shape — no real registry to check against yet). Neither
 * function throws; both return every issue found in one pass, the same "collect, don't fail fast"
 * convention `@forge/extensions`'s own preset/workflow-guardrail validators already use — including for
 * a workflow nested absurdly deep (`MAX_TRAVERSAL_DEPTH` below), which becomes one more issue in the
 * list rather than an uncaught `RangeError` blowing past this file's own "never throws" claim.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P8
 */
import { minimatch } from 'minimatch';

import type { Workflow, WorkflowExistenceOracle, WorkflowStep, ValidationIssue } from './types.ts';

/** Confirmed empirically that every recursive walker in this file, called directly on a hand-built
 * `Workflow` object (bypassing `parseWorkflow`'s own YAML-text entry point, whose own `yaml`-package
 * parser hits *its* stack limit first and reports a clean, positioned issue rather than crashing —
 * `parse.ts`'s own doc comment), throws a raw `RangeError` past several thousand levels of nested
 * `fanout`/`parallel`/`sequence` or a several-thousand-step-long `dependsOn` chain. No realistic
 * workflow — the spec's own one worked example has 9 steps and 2 levels of nesting — comes remotely
 * close to this; the guard exists so a pathological input becomes one more reported issue, honestly,
 * rather than a crash that contradicts this module's own stated contract. Chosen with a wide safety
 * margin under typical JS engine stack limits (tens of thousands of frames), not tuned to any real
 * workflow's own actual depth. */
const MAX_TRAVERSAL_DEPTH = 2000;

function excessiveDepthIssue(code: string): ValidationIssue {
  return {
    code,
    severity: 'error',
    message: `Workflow structure nests or chains more than ${String(MAX_TRAVERSAL_DEPTH)} levels deep; refusing to traverse further.`,
  };
}

/** `fanout`'s own singular `step` has no `id` of its own by design (`types.ts`'s own `WorkflowStepBase`
 * doc comment), so it is never itself pushed as an *addressable* step (`collectAddressableSteps`) — but
 * every check in this file, including the addressable-step walk, still needs to descend *through* it:
 * a `parallel`/`sequence` group nested inside a fanout's own template is real, individually-addressable
 * structure that reproduces identically for every expanded item, and a duplicate id or a cycle entirely
 * inside one is a genuine static defect, not a premature check waiting on plan-compilation-time
 * expansion. Confirmed empirically that treating a fanout's child as opaque here let a real duplicate-id
 * and a real cycle *entirely inside* a `parallel`/`sequence` nested inside a `fanout`'s own `step` go
 * completely undetected, even though the identical nesting depth was already correctly reached by this
 * file's other checks (`checkProducesGlobs`, `validateWorkflow`) via `childFrames`/`walkAllSteps` below.
 *
 * `collect: false` on a fanout's own immediate child is *only* about whether that one step itself gets
 * added to a caller's result — `walkWithDepthGuard` still unconditionally descends into every frame
 * regardless of its own `collect` flag, which is what lets a `parallel`/`sequence` nested *inside* that
 * same fanout child still have its own children correctly marked `collect: true`, one level further in. */
function childFrames(
  step: WorkflowStep,
): readonly { readonly step: WorkflowStep; readonly collect: boolean }[] {
  if (step.kind === 'fanout') return [{ step: step.step, collect: false }];
  if (step.kind === 'parallel' || step.kind === 'sequence') {
    return step.steps.map((child) => ({ step: child, collect: true }));
  }
  return [];
}

interface DepthLimitedWalkResult {
  readonly visited: readonly WorkflowStep[];
  readonly exceededDepth: boolean;
}

/** Shared depth-guarded pre-order walk: pushes every `root` (always collected), then every step
 * `childFrames` reaches from each, collected only when its own frame says so — breadth order between
 * roots but depth order within one root's own subtree (the specific order does not matter to any caller
 * here, all of which either count occurrences or search the whole list). Iterative (an explicit stack,
 * not real recursion) specifically so the depth counter is a plain local variable rather than something
 * that has to ride along on every stack frame — confirmed empirically that a naive recursive version of
 * this walk (and of `checkNoCycles`'s own DFS below) throws a raw `RangeError` past a few thousand levels
 * of nesting, contradicting this whole file's own "never throws" contract; `parseWorkflow`'s own real
 * YAML-text entry point is not vulnerable to this (the `yaml` package's own parser hits *its* stack limit
 * first and reports a clean, positioned issue), but a `Workflow` object assembled some other way could
 * reach this function directly.
 *
 * The `frame === undefined` check just inside the loop below (and its counterpart in `checkNoCycles`'s
 * own iterative DFS) is required by `noUncheckedIndexedAccess` — `Array.prototype.pop`/index access is
 * always typed `T | undefined` — but is provably unreachable by construction: the enclosing `while
 * (stack.length > 0)` already guarantees an element is there. Left as a real runtime check (TypeScript
 * gives no way to satisfy the type without one, short of a non-null assertion this codebase's own
 * `src/**` lint config forbids) rather than exercised by a test, which would mean fabricating an
 * internal state that cannot actually occur — the same "don't validate what can't happen" reasoning
 * this project already applies elsewhere, just encountered here as a type-level rather than a
 * behavioural constraint. */
function walkWithDepthGuard(
  roots: readonly { readonly step: WorkflowStep; readonly collect: boolean }[],
  collectFilter: (collect: boolean) => boolean,
): DepthLimitedWalkResult {
  const visited: WorkflowStep[] = [];
  const stack: {
    readonly step: WorkflowStep;
    readonly depth: number;
    readonly collect: boolean;
  }[] = roots.map((root) => ({ step: root.step, depth: 0, collect: root.collect })).reverse();
  let exceededDepth = false;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    if (frame.depth > MAX_TRAVERSAL_DEPTH) {
      exceededDepth = true;
      continue;
    }
    if (collectFilter(frame.collect)) visited.push(frame.step);
    const children = childFrames(frame.step)
      .map((child) => ({ step: child.step, depth: frame.depth + 1, collect: child.collect }))
      .reverse();
    stack.push(...children);
  }

  return { visited, exceededDepth };
}

/** Every step reachable from `workflow`, at any depth, in encounter order — `workflow.steps`,
 * `onComplete`, and `onFailure.escalations[].do`, each walked through `fanout`/`parallel`/`sequence`
 * children via `childFrames`, collecting every one regardless of its own `collect` flag: a malformed
 * glob or a dangling gate reference is exactly as real a problem inside a `fanout`'s own templated child
 * as it is at the top level. */
function walkAllSteps(workflow: Workflow): DepthLimitedWalkResult {
  const roots = [
    ...workflow.steps.map((step) => ({ step, collect: true })),
    ...(workflow.onComplete ?? []).map((step) => ({ step, collect: true })),
    ...(workflow.onFailure?.escalations?.map((escalation) => ({
      step: escalation.do,
      collect: true,
    })) ?? []),
  ];
  return walkWithDepthGuard(roots, () => true);
}

/** The narrower set of positions where a step's `id` is meaningful and must be unique: `workflow.steps`
 * itself, plus any nested `parallel`/`sequence` children (each individually addressable, `types.ts`'s
 * own `ParallelStep`/`SequenceStep` doc comment) — including ones reached *through* a `fanout`'s own
 * template, or through `onComplete`/an escalation's own `do` step, per `childFrames`'s own doc comment
 * above. A `fanout`'s immediate templated child, `onComplete`'s own top-level steps, and an escalation's
 * own `do` step are all still excluded from addressability *themselves* (no `id` of theirs is required —
 * `10` §10.1's own worked example gives none of them one) by rooting them with `collect: false`, exactly
 * like a fanout's own child — but confirmed empirically that this must be a per-root *flag*, not a
 * whole-subtree exclusion: excluding `onComplete`/escalation-`do` roots from this walk *entirely* (the
 * original, narrower version of this function) let a real duplicate id or cycle *nested inside* a
 * `parallel`/`sequence` that happens to be one of those root steps go completely undetected, the exact
 * same bug class the fanout fix above already closed one level up. `collect: false` on a root still lets
 * `walkWithDepthGuard` descend into it via `childFrames`, so a `parallel`/`sequence` nested inside any of
 * these three root shapes still has its own children correctly marked `collect: true`. */
function collectAddressableSteps(workflow: Workflow): DepthLimitedWalkResult {
  const roots = [
    ...workflow.steps.map((step) => ({ step, collect: true })),
    ...(workflow.onComplete ?? []).map((step) => ({ step, collect: false })),
    ...(workflow.onFailure?.escalations?.map((escalation) => ({
      step: escalation.do,
      collect: false,
    })) ?? []),
  ];
  return walkWithDepthGuard(roots, (collect) => collect);
}

/** Confirmed a step with no `id` at all — legitimate at the type level (`WorkflowStepBase.id` is
 * optional) for a `fanout`'s own templated child, but not for anything `collectAddressableSteps` treats
 * as addressable — is otherwise silently accepted: nothing can ever `dependsOn` it, and no issue this
 * file produces could ever name it via `stepId`. A workflow author who simply forgot an `id` on a
 * top-level or grouped step gets no signal at all that the step is now structurally inert — the same
 * "meaningless value silently accepted" shape this milestone has repeatedly treated as worth catching
 * (`SPEC-QUESTIONS.md` Q69's own blank-string findings), not a hypothetical concern. */
function checkStepsHaveIds(addressable: readonly WorkflowStep[]): readonly ValidationIssue[] {
  return addressable
    .filter((step) => step.id === undefined)
    .map((step): ValidationIssue => ({
      code: 'missing-step-id',
      severity: 'error',
      // `step.kind` -- the one piece of distinguishing information an id-less step actually has --
      // confirmed empirically that without it, several simultaneously-offending steps produce
      // byte-for-byte identical issue objects, giving a caller no way to tell "N real problems" from
      // an accidental duplicate.
      message: `A "${step.kind}" step in workflow.steps (or a nested parallel/sequence group) has no id.`,
    }));
}

function checkUniqueStepIds(addressable: readonly WorkflowStep[]): readonly ValidationIssue[] {
  const seen = new Map<string, number>();
  for (const step of addressable) {
    if (step.id === undefined) continue;
    seen.set(step.id, (seen.get(step.id) ?? 0) + 1);
  }
  const issues: ValidationIssue[] = [];
  for (const [id, count] of seen) {
    if (count > 1) {
      issues.push({
        code: 'duplicate-step-id',
        severity: 'error',
        message: `Step id "${id}" is used ${String(count)} times; step ids must be unique.`,
        stepId: id,
      });
    }
  }
  return issues;
}

/** An `elicit` question's name is its answer's name in the run's `answers` (`PLAN-M13.md` P20), so two questions
 * of one workflow may not share one: the later answer would silently replace the earlier for every step that reads
 * it. */
function checkUniqueElicitQuestions(steps: readonly WorkflowStep[]): readonly ValidationIssue[] {
  const owners = new Map<string, string[]>();
  for (const step of steps) {
    if (step.kind !== 'elicit') continue;
    for (const question of step.questions) {
      owners.set(question.name, [
        ...(owners.get(question.name) ?? []),
        step.id ?? '(unidentified)',
      ]);
    }
  }
  const issues: ValidationIssue[] = [];
  for (const [name, stepIds] of owners) {
    if (stepIds.length > 1) {
      issues.push({
        code: 'duplicate-elicit-question',
        severity: 'error',
        message: `Elicit question "${name}" is asked ${String(stepIds.length)} times (${stepIds.join(', ')}); question names must be unique across a workflow.`,
      });
    }
  }
  return issues;
}

/** Cycle detection over the *static*, unexpanded graph only (`PLAN-M5.md` P8's own mandate, verbatim):
 * a `dependsOn` entry that does not exactly match a known step id — the shape `10` §10.1's own worked
 * example uses for a per-item fanout dependency (`"generate-tests:{{item.id}}"`) always takes — is
 * silently not an edge in this graph, not a separate "dangling dependsOn" finding. `PLAN-M5.md` P8's own
 * curated checklist names cycle detection specifically, not dangling-reference detection generally (that
 * broader question — a plain, non-templated typo in a `dependsOn` value — is deliberately left out of
 * this piece's own scope rather than invented on top of what was asked).
 *
 * Iterative (an explicit stack of `{ step, dependsOnIndex }` frames, not real recursion), for the same
 * `MAX_TRAVERSAL_DEPTH` reason `walkWithDepthGuard` is: a several-thousand-step-long `dependsOn` chain
 * confirmed empirically to blow the real call stack in a naive recursive version.
 *
 * The depth guard below returns immediately with a single `excessive-dependency-depth` issue, discarding
 * every issue already found in this call, rather than `break`-ing out of just the one over-deep DFS and
 * continuing with the next unvisited `start`. Confirmed empirically that the latter is a real, serious
 * bug, not a hypothetical: breaking out of the `while` loop abandons the stack without ever resetting the
 * `'visiting'` state of the steps still on it, so a *later* `start`'s own fresh DFS can reach one of those
 * stale-`'visiting'` steps (nothing distinguishes "genuinely on the current path" from "abandoned mid-walk
 * by an earlier, over-deep pass" in `state` alone) and misreport it as a live cycle — and since that step
 * is not actually on the *current* stack, `stack.findIndex` returns `-1`, which the original code silently
 * treated as "start the reported cycle from the beginning of the stack," fabricating a `dependency-cycle`
 * issue whose own first and last step do not even match. Reproduced with a genuinely ordinary (not
 * pathologically nested) flat list of a few thousand steps closing into one ring: past the depth guard,
 * every remaining unvisited step produced its own fabricated, non-closing "cycle." Discarding the whole
 * result and reporting only that traversal was too deep to complete is honest about what actually
 * happened; a caller already has to treat `excessive-dependency-depth` as "this result is incomplete," so
 * mixing in issues that range from merely incomplete to actively fabricated is strictly worse than not
 * reporting them at all. */
function checkNoCycles(addressable: readonly WorkflowStep[]): readonly ValidationIssue[] {
  const byId = new Map<string, WorkflowStep>();
  for (const step of addressable) {
    if (step.id !== undefined) byId.set(step.id, step);
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const issues: ValidationIssue[] = [];

  for (const start of addressable) {
    if (start.id === undefined || state.get(start.id) === 'done') continue;

    const stack: { readonly step: WorkflowStep; dependsOnIndex: number }[] = [
      { step: start, dependsOnIndex: 0 },
    ];
    state.set(start.id, 'visiting');

    while (stack.length > 0) {
      if (stack.length > MAX_TRAVERSAL_DEPTH) {
        return [excessiveDepthIssue('excessive-dependency-depth')];
      }
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const dependsOn = frame.step.dependsOn ?? [];
      if (frame.dependsOnIndex >= dependsOn.length) {
        if (frame.step.id !== undefined) state.set(frame.step.id, 'done');
        stack.pop();
        continue;
      }
      const dependsOnId = dependsOn[frame.dependsOnIndex];
      frame.dependsOnIndex += 1;
      if (dependsOnId === undefined) continue;
      const target = byId.get(dependsOnId);
      if (target?.id === undefined) continue;
      const targetState = state.get(target.id);
      if (targetState === 'done') continue;
      if (targetState === 'visiting') {
        // `target` is guaranteed to genuinely be on `stack` right now, not merely stale-'visiting' from
        // an abandoned walk: the depth guard above returns immediately rather than `break`-ing out and
        // leaving 'visiting' markers behind for a later start's own DFS to misread, which is exactly
        // the invariant that makes `cycleStartIndex` always a real index here, never `-1` (confirmed:
        // the fallback this once needed is unreachable now). Silently mis-slicing instead of relying on
        // that invariant would risk repeating the same class of bug the depth-guard fix above closes.
        const cycleStartIndex = stack.findIndex((candidate) => candidate.step.id === target.id);
        const cycle = [
          ...stack.slice(cycleStartIndex).map((candidate) => candidate.step.id),
          target.id,
        ];
        issues.push({
          code: 'dependency-cycle',
          severity: 'error',
          message: `Dependency cycle: ${cycle.join(' -> ')}.`,
          stepId: target.id,
        });
        continue;
      }
      state.set(target.id, 'visiting');
      stack.push({ step: target, dependsOnIndex: 0 });
    }
  }

  return issues;
}

/** `minimatch.makeRe` is confirmed empirically to be lenient about almost every glob-syntax shape
 * (unbalanced brackets/parens are treated as literal characters, not rejected) — the one thing it does
 * reject is the empty string. "Well-formed" here means exactly what `minimatch` (the same library
 * `@forge/vcs`'s own claim enforcement already matches `produces` globs with) will actually accept,
 * not a stricter, independently-invented glob grammar this piece would have to keep in sync with it by
 * hand. */
function isWellFormedGlob(glob: string): boolean {
  return minimatch.makeRe(glob) !== false;
}

/** Normalises `AgentStep`/`CommandStep`'s shared `produces` field (`string | readonly string[] |
 * undefined`, `types.ts:82`) to a plain array — the one shape every check in this file that reads
 * `produces` needs, `checkProducesGlobs` and the `write-without-claim` check in `validateWorkflow`
 * alike. A still-templated entry (`"{{run.filesExpected}}"`) normalises the same as any other string:
 * this function only counts entries, it does not resolve them. */
function producesEntries(produces: string | readonly string[] | undefined): readonly string[] {
  if (produces === undefined) return [];
  return typeof produces === 'string' ? [produces] : produces;
}

function checkProducesGlobs(steps: readonly WorkflowStep[]): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const step of steps) {
    // `06` §6.2's `StepNode.produces` is shared by every kind; `agent` and `command` are the two that
    // author it (`PLAN-M14.md` P2) — both narrow to the same optional `string | readonly string[]` shape.
    if ((step.kind !== 'agent' && step.kind !== 'command') || step.produces === undefined) continue;
    const globs = producesEntries(step.produces);
    for (const glob of globs) {
      if (!isWellFormedGlob(glob)) {
        issues.push({
          code: 'malformed-produces-glob',
          severity: 'error',
          message: `produces glob "${glob}" on step "${step.id ?? '(unidentified)'}" is not well-formed.`,
          ...(step.id === undefined ? {} : { stepId: step.id }),
        });
      }
    }
  }
  return issues;
}

/** `10` §10.1's own "Validation" subsection: unique step ids; no dependency cycles; `produces` globs
 * well-formed. "Fanout `over` resolves against a schema, not executed" is deliberately not a fourth
 * check here — `schema.ts`'s own `nonBlank()` constraint on `FanoutStep.over` already guarantees this
 * by the time any `Workflow` reaches this function; a workflow that fails to parse never reaches
 * `validateStructure` at all, so there is nothing left to independently re-check here. */
export function validateStructure(workflow: Workflow): readonly ValidationIssue[] {
  const { visited: addressable, exceededDepth: addressableExceeded } =
    collectAddressableSteps(workflow);
  const { visited: allSteps, exceededDepth: allExceeded } = walkAllSteps(workflow);
  return [
    ...checkStepsHaveIds(addressable),
    ...checkUniqueStepIds(addressable),
    ...checkNoCycles(addressable),
    ...checkProducesGlobs(allSteps),
    ...checkUniqueElicitQuestions(allSteps),
    ...(addressableExceeded || allExceeded ? [excessiveDepthIssue('excessive-nesting-depth')] : []),
  ];
}

/** Referential integrity against a caller-supplied `WorkflowExistenceOracle` — `workflow.requires`'s own
 * `gates_passed`/`artifacts` (`10` §10.1's own worked example populates both), plus every reachable
 * step's `agent`, `brief`, `gate`/`gateEvidence`, `outputs[].type` and `subworkflow.workflow` field, each
 * checked against the oracle method that owns that kind of existence question. Deliberately does not
 * check `inputs` entries (`artifact:X`/`kb:Y`/`diff:Z`-shaped free-form strings): nothing in this piece
 * parses that mini-syntax, and building a parser for it just to validate here would be scope this piece
 * does not own — the same "a capability this package cannot reach yet" shape `SPEC-QUESTIONS.md` Q62
 * uses throughout, most likely `@forge/engine`'s own expression-evaluator piece's job once it exists. */
export function validateWorkflow(
  workflow: Workflow,
  oracle: WorkflowExistenceOracle,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  function report(code: string, message: string, stepId: string | undefined): void {
    issues.push({ code, severity: 'error', message, ...(stepId === undefined ? {} : { stepId }) });
  }

  for (const gateId of workflow.requires?.gates_passed ?? []) {
    if (!oracle.gateExists(gateId)) {
      report(
        'unknown-gate',
        `workflow.requires.gates_passed names unknown gate "${gateId}".`,
        undefined,
      );
    }
  }
  for (const artifactType of workflow.requires?.artifacts ?? []) {
    if (!oracle.artifactTypeExists(artifactType)) {
      report(
        'unknown-artifact-type',
        `workflow.requires.artifacts names unknown artifact type "${artifactType}".`,
        undefined,
      );
    }
  }

  const { visited: steps, exceededDepth } = walkAllSteps(workflow);
  for (const step of steps) {
    if (step.kind === 'agent') {
      if (!oracle.agentExists(step.agent)) {
        report(
          'unknown-agent',
          `Step "${step.id ?? '(unidentified)'}" references unknown agent "${step.agent}".`,
          step.id,
        );
      }
      if (step.brief !== undefined && !oracle.briefExists(step.brief)) {
        report(
          'unknown-brief',
          `Step "${step.id ?? '(unidentified)'}" references unknown brief "${step.brief}".`,
          step.id,
        );
      }
      for (const gateId of step.gateEvidence ?? []) {
        if (!oracle.gateExists(gateId)) {
          report(
            'unknown-gate',
            `Step "${step.id ?? '(unidentified)'}" names unknown gate "${gateId}" in gateEvidence.`,
            step.id,
          );
        }
      }
      for (const output of step.outputs ?? []) {
        if (!oracle.artifactTypeExists(output.type)) {
          report(
            'unknown-artifact-type',
            `Step "${step.id ?? '(unidentified)'}" declares unknown artifact type "${output.type}" in outputs.`,
            step.id,
          );
        }
      }
      // `06` §6.7's own "an empty claim means no write" rule, made visible before a run
      // (`SPEC-QUESTIONS.md` Q225/Q232 decision 6): a step whose agent holds `tools.write: true` but
      // declares neither `outputs` nor a non-`!` `produces` entry gets no write grant at all
      // (`assemble.ts`, `PLAN-M13.md` P36) — it runs and can change nothing, a silent no-op the run
      // itself never surfaces as a failure. A `!`-only `produces` (e.g. `['!src/x']`) is still an empty
      // claim: an exclusion subtracts from the claim, it never contributes to it.
      if (oracle.agentWrites(step.agent)) {
        const hasOutputs = (step.outputs?.length ?? 0) > 0;
        const hasProducesClaim = producesEntries(step.produces).some(
          (glob) => !glob.startsWith('!'),
        );
        if (!hasOutputs && !hasProducesClaim) {
          report(
            'write-without-claim',
            `Step "${step.id ?? '(unidentified)'}" runs a write-capable agent ("${step.agent}") with an empty claim: no outputs and no produces glob. 06 §6.7 gives it no write grant at all, so it will run and change nothing. Add outputs or a produces glob naming what it writes.`,
            step.id,
          );
        }
      }
    } else if (step.kind === 'gate') {
      if (!oracle.gateExists(step.gate)) {
        report(
          'unknown-gate',
          `Step "${step.id ?? '(unidentified)'}" references unknown gate "${step.gate}".`,
          step.id,
        );
      }
    } else if (step.kind === 'subworkflow') {
      if (!oracle.workflowExists(step.workflow)) {
        report(
          'unknown-workflow',
          `Step "${step.id ?? '(unidentified)'}" references unknown workflow "${step.workflow}".`,
          step.id,
        );
      }
    }
  }
  if (exceededDepth) issues.push(excessiveDepthIssue('excessive-nesting-depth'));
  return issues;
}
